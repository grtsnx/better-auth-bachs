import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";
import { throwIfUncertain } from "./bachs-sdk.js";
import { BACHS_ERROR_CODES } from "./errors.js";
import type { ResolvedBachsOptions } from "./types.js";
import { BachsWebhookError, constructBachsEvent } from "./webhooks.js";

function findPlan(options: ResolvedBachsOptions, planName: string) {
  return options.subscription?.plans?.find((plan) => plan.name === planName);
}

function findProduct(options: ResolvedBachsOptions, productName: string) {
  return options.products?.products?.find((product) => product.name === productName);
}

function extractCustomerId(data: Record<string, unknown>): string | null {
  if (typeof data.customer_id === "string" && data.customer_id) {
    return data.customer_id;
  }
  const customer = data.customer;
  if (customer && typeof customer === "object") {
    const id =
      (customer as Record<string, unknown>).customer_id ??
      (customer as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

export function createCheckout(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/create-checkout",
    {
      method: "POST",
      body: z.object({
        plan: z.string().optional(),
        product: z.string().optional(),
        productId: z.string().optional(),
        quantity: z.number().int().positive().optional(),
        reference: z.string().optional(),
        successUrl: z.string().url().optional(),
        cancelUrl: z.string().url().nullable().optional(),
        idempotencyKey: z.string().min(1).optional(),
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const session = ctx.context.session;
      const user = session.user;

      let productId = ctx.body.productId;
      let planName: string | undefined;
      let productName: string | undefined;
      let groupId: string | undefined;

      if (ctx.body.plan) {
        const plan = findPlan(options, ctx.body.plan);
        if (!plan) {
          throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.PLAN_NOT_FOUND);
        }
        productId = plan.productId;
        planName = plan.name;
        groupId = plan.group;
      } else if (ctx.body.product) {
        const product = findProduct(options, ctx.body.product);
        if (!product) {
          throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.PRODUCT_NOT_FOUND);
        }
        productId = product.productId;
        productName = product.name;
      }

      if (!productId) {
        throw new APIError("BAD_REQUEST", {
          code: "PRODUCT_REQUIRED",
          message: "Provide plan, product, or productId.",
        });
      }

      if (groupId) {
        const existing = await ctx.context.adapter.findMany({
          model: "bachsSubscription",
          where: [
            { field: "userId", value: user.id },
            { field: "groupId", value: groupId },
          ],
        });
        const active = (existing as Array<{ status: string }>).some((row) =>
          ["trialing", "active", "past_due"].includes(row.status),
        );
        if (active) {
          throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.ALREADY_SUBSCRIBED);
        }
      }

      const successUrl = ctx.body.successUrl ?? options.successUrl;
      if (!successUrl) {
        throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.MISSING_SUCCESS_URL);
      }
      if (!user.email) {
        throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.MISSING_EMAIL);
      }

      const existingCustomer = await ctx.context.adapter.findOne({
        model: "bachsCustomer",
        where: [
          { field: "referenceId", value: user.id },
          { field: "referenceType", value: "user" },
        ],
      });

      const customer =
        existingCustomer &&
        typeof (existingCustomer as { customerId?: string }).customerId === "string"
          ? {
              customer_id: (existingCustomer as { customerId: string }).customerId,
            }
          : {
              email: user.email,
              name: user.name?.trim() || user.email,
            };

      const idempotencyKey =
        ctx.body.idempotencyKey ??
        `checkout-${user.id}-${ctx.body.reference ?? planName ?? productName ?? productId}-${Date.now()}`;

      try {
        const checkout = await options.bachsClient.checkoutSessions.create(
          {
            product_cart: [
              {
                product_id: productId,
                quantity: ctx.body.quantity ?? 1,
              },
            ],
            customer,
            customer_creation: "if_required",
            success_url: successUrl,
            cancel_url: ctx.body.cancelUrl ?? options.cancelUrl ?? null,
            reference: ctx.body.reference ?? null,
            metadata: {
              better_auth_user_id: user.id,
              plan: planName ?? null,
              product: productName ?? null,
              group: groupId ?? null,
            },
          },
          { idempotencyKey },
        );

        await ctx.context.adapter.create({
          model: "bachsCheckout",
          data: {
            checkoutId: checkout.checkout_id,
            referenceId: user.id,
            userId: user.id,
            reference: checkout.reference,
            plan: planName ?? null,
            product: productName ?? null,
            status: checkout.status,
            checkoutUrl: checkout.checkout_url,
            metadata: JSON.stringify({
              plan: planName,
              product: productName,
              group: groupId,
            }),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        return ctx.json({
          checkoutId: checkout.checkout_id,
          checkoutUrl: checkout.checkout_url,
          status: checkout.status,
          expiresAt: checkout.expires_at,
          reference: checkout.reference,
          plan: planName ?? null,
          product: productName ?? null,
        });
      } catch (err) {
        throwIfUncertain(err);
      }
    },
  );
}

export function getCheckout(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/get-checkout",
    {
      method: "GET",
      query: z.object({ checkoutId: z.string().min(1) }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const local = await ctx.context.adapter.findOne({
        model: "bachsCheckout",
        where: [{ field: "checkoutId", value: ctx.query.checkoutId }],
      });
      if (
        local &&
        (local as { userId: string }).userId !== ctx.context.session.user.id
      ) {
        throw new APIError("FORBIDDEN", {
          code: "CHECKOUT_FORBIDDEN",
          message: "Checkout does not belong to this user.",
        });
      }

      const checkout = await options.bachsClient.checkoutSessions.get(
        ctx.query.checkoutId,
      );
      return ctx.json({
        checkoutId: checkout.checkout_id,
        status: checkout.status,
        amount: checkout.amount ?? null,
        currency: checkout.currency ?? null,
        paymentStatus: checkout.payment_status ?? null,
        reference: checkout.reference ?? null,
        customerId:
          checkout.customer?.id ?? checkout.customer_details?.id ?? null,
        plan: (local as { plan?: string } | null)?.plan ?? null,
        product: (local as { product?: string } | null)?.product ?? null,
      });
    },
  );
}

export function createPortalSession(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/create-portal-session",
    {
      method: "POST",
      body: z.object({
        idempotencyKey: z.string().min(1).optional(),
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const customer = await ctx.context.adapter.findOne({
        model: "bachsCustomer",
        where: [
          { field: "referenceId", value: ctx.context.session.user.id },
          { field: "referenceType", value: "user" },
        ],
      });
      const customerId = (customer as { customerId?: string } | null)?.customerId;
      if (!customerId) {
        throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.MISSING_CUSTOMER);
      }

      try {
        const portal = await options.bachsClient.customerPortal.createSession(
          customerId,
          {
            idempotencyKey:
              ctx.body.idempotencyKey ??
              `portal-${ctx.context.session.user.id}-${Date.now()}`,
          },
        );
        return ctx.json({ id: portal.id, portalUrl: portal.url });
      } catch (err) {
        throwIfUncertain(err);
      }
    },
  );
}

export function listPlans(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-plans",
    {
      method: "GET",
      use: [sessionMiddleware],
    },
    async (ctx) => {
      return ctx.json({
        plans: options.subscription?.plans ?? [],
        enabled: options.subscription?.enabled !== false,
      });
    },
  );
}

export function listProducts(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-products",
    {
      method: "GET",
      use: [sessionMiddleware],
    },
    async (ctx) => {
      return ctx.json({
        products: options.products?.products ?? [],
      });
    },
  );
}

export function listSubscriptions(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-subscriptions",
    {
      method: "GET",
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const rows = await ctx.context.adapter.findMany({
        model: "bachsSubscription",
        where: [{ field: "userId", value: ctx.context.session.user.id }],
      });
      return ctx.json({ subscriptions: rows });
    },
  );
}

export function getSubscription(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/get-subscription",
    {
      method: "GET",
      query: z.object({ subscriptionId: z.string().min(1) }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const local = await ctx.context.adapter.findOne({
        model: "bachsSubscription",
        where: [
          { field: "subscriptionId", value: ctx.query.subscriptionId },
          { field: "userId", value: ctx.context.session.user.id },
        ],
      });
      if (!local) {
        throw new APIError("NOT_FOUND", {
          code: "SUBSCRIPTION_NOT_FOUND",
          message: "Subscription not found.",
        });
      }

      const remote = await options.bachsClient.subscriptions.get(
        ctx.query.subscriptionId,
      );
      return ctx.json({
        ...local,
        remote: {
          id: remote.id,
          status: remote.status,
          amount: remote.amount ?? null,
          currency: remote.currency ?? null,
          currentPeriodEnd: remote.current_period_end ?? null,
          cancelAtPeriodEnd: remote.cancel_at_period_end ?? null,
        },
      });
    },
  );
}

export function cancelSubscription(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/cancel-subscription",
    {
      method: "POST",
      body: z.object({
        subscriptionId: z.string().min(1),
        cancelAtPeriodEnd: z.boolean().optional(),
        idempotencyKey: z.string().min(1).optional(),
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const local = await ctx.context.adapter.findOne({
        model: "bachsSubscription",
        where: [
          { field: "subscriptionId", value: ctx.body.subscriptionId },
          { field: "userId", value: ctx.context.session.user.id },
        ],
      });
      if (!local) {
        throw new APIError("FORBIDDEN", BACHS_ERROR_CODES.SUBSCRIPTION_FORBIDDEN);
      }

      try {
        const subscription = await options.bachsClient.subscriptions.cancel(
          ctx.body.subscriptionId,
          { cancel_at_period_end: ctx.body.cancelAtPeriodEnd ?? true },
          {
            idempotencyKey:
              ctx.body.idempotencyKey ??
              `cancel-${ctx.context.session.user.id}-${ctx.body.subscriptionId}`,
          },
        );

        await ctx.context.adapter.update({
          model: "bachsSubscription",
          where: [
            { field: "subscriptionId", value: ctx.body.subscriptionId },
          ],
          update: {
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end)
              : null,
            updatedAt: new Date(),
          },
        });

        return ctx.json({
          subscriptionId: subscription.id,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end ?? null,
        });
      } catch (err) {
        throwIfUncertain(err);
      }
    },
  );
}

export function billingStatus() {
  return createAuthEndpoint(
    "/bachs/billing-status",
    {
      method: "GET",
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const customer = await ctx.context.adapter.findOne({
        model: "bachsCustomer",
        where: [
          { field: "referenceId", value: ctx.context.session.user.id },
          { field: "referenceType", value: "user" },
        ],
      });
      const subscriptions = (await ctx.context.adapter.findMany({
        model: "bachsSubscription",
        where: [{ field: "userId", value: ctx.context.session.user.id }],
      })) as Array<{ status: string; plan?: string | null; groupId?: string | null }>;

      return ctx.json({
        customerId: (customer as { customerId?: string } | null)?.customerId ?? null,
        hasActiveSubscription: subscriptions.some((row) =>
          ["trialing", "active", "past_due"].includes(row.status),
        ),
        subscriptions,
      });
    },
  );
}

export function getConfig(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/config",
    {
      method: "GET",
      use: [sessionMiddleware],
    },
    async (ctx) => {
      return ctx.json({
        subscription: {
          enabled: options.subscription?.enabled !== false,
          plans: (options.subscription?.plans ?? []).map((plan) => ({
            name: plan.name,
            description: plan.description,
            group: plan.group,
            // productId stays server-side; clients use plan name
          })),
        },
        products: {
          products: (options.products?.products ?? []).map((product) => ({
            name: product.name,
            description: product.description,
          })),
        },
      });
    },
  );
}

export function bachsWebhook(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/webhook",
    {
      method: "POST",
    },
    async (ctx) => {
      if (!options.webhookSecret) {
        throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.WEBHOOK_NOT_CONFIGURED);
      }

      const rawBody =
        typeof ctx.request?.text === "function"
          ? await ctx.request.clone().text()
          : typeof ctx.body === "string"
            ? ctx.body
            : JSON.stringify(ctx.body ?? {});

      let event;
      try {
        event = constructBachsEvent(
          rawBody,
          ctx.headers ?? {},
          options.webhookSecret,
        );
      } catch (err) {
        if (err instanceof BachsWebhookError) {
          throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.INVALID_WEBHOOK);
        }
        throw err;
      }

      const existing = await ctx.context.adapter.findOne({
        model: "bachsWebhookEvent",
        where: [{ field: "eventId", value: event.id }],
      });
      if (existing && (existing as { status: string }).status === "processed") {
        return ctx.json({ received: true, duplicate: true, id: event.id });
      }

      if (!existing) {
        await ctx.context.adapter.create({
          model: "bachsWebhookEvent",
          data: {
            eventId: event.id,
            eventType: event.type,
            payload: rawBody,
            status: "received",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      const data = event.data;
      const userId =
        data.metadata && typeof data.metadata === "object"
          ? ((data.metadata as Record<string, unknown>).better_auth_user_id as
              | string
              | undefined)
          : undefined;
      const customerId = extractCustomerId(data);

      if (options.createCustomerOnCheckout && userId && customerId) {
        const existingCustomer = await ctx.context.adapter.findOne({
          model: "bachsCustomer",
          where: [
            { field: "referenceId", value: userId },
            { field: "referenceType", value: "user" },
          ],
        });
        if (!existingCustomer) {
          await ctx.context.adapter.create({
            model: "bachsCustomer",
            data: {
              referenceId: userId,
              referenceType: "user",
              customerId,
              email:
                typeof (data.customer as { email?: string } | undefined)?.email ===
                "string"
                  ? (data.customer as { email: string }).email
                  : null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        } else {
          await ctx.context.adapter.update({
            model: "bachsCustomer",
            where: [
              { field: "referenceId", value: userId },
              { field: "referenceType", value: "user" },
            ],
            update: { customerId, updatedAt: new Date() },
          });
        }
      }

      if (event.type === "checkout.completed" && typeof data.checkout_id === "string") {
        await ctx.context.adapter.update({
          model: "bachsCheckout",
          where: [{ field: "checkoutId", value: data.checkout_id }],
          update: { status: "completed", updatedAt: new Date() },
        });
      }

      if (
        event.type.startsWith("customer.subscription.") &&
        typeof data.id === "string" &&
        userId
      ) {
        const plan =
          data.metadata && typeof data.metadata === "object"
            ? ((data.metadata as Record<string, unknown>).plan as string | undefined)
            : undefined;
        const groupId =
          data.metadata && typeof data.metadata === "object"
            ? ((data.metadata as Record<string, unknown>).group as string | undefined)
            : undefined;

        const existingSub = await ctx.context.adapter.findOne({
          model: "bachsSubscription",
          where: [{ field: "subscriptionId", value: data.id }],
        });

        const payload = {
          subscriptionId: data.id,
          referenceId: userId,
          userId,
          customerId: customerId ?? "",
          plan: plan ?? null,
          productId:
            typeof data.product_id === "string" ? data.product_id : null,
          status: typeof data.status === "string" ? data.status : "unknown",
          groupId: groupId ?? null,
          cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
          currentPeriodEnd:
            typeof data.current_period_end === "string"
              ? new Date(data.current_period_end)
              : null,
          updatedAt: new Date(),
        };

        if (existingSub) {
          await ctx.context.adapter.update({
            model: "bachsSubscription",
            where: [{ field: "subscriptionId", value: data.id }],
            update: payload,
          });
        } else {
          await ctx.context.adapter.create({
            model: "bachsSubscription",
            data: { ...payload, createdAt: new Date() },
          });
        }
      }

      if (options.onEvent) {
        await options.onEvent(event);
      }

      await ctx.context.adapter.update({
        model: "bachsWebhookEvent",
        where: [{ field: "eventId", value: event.id }],
        update: {
          status: "processed",
          processedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return ctx.json({ received: true, id: event.id, type: event.type });
    },
  );
}
