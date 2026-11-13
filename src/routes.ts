import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import type { GenericEndpointContext } from "better-auth";
import * as z from "zod";
import { throwIfUncertain } from "./bachs-sdk.js";
import { BACHS_ERROR_CODES } from "./errors.js";
import {
  authorizeBillingReference,
  resolveCheckoutCustomer,
} from "./reference.js";
import {
  assertMerchantAccess,
  claimWebhookEvent,
  getPublicPlans,
  getPublicProducts,
  requireLocalBillingResource,
  resolveCheckoutProduct,
  resolveTrustedRedirectUrl,
  scopedIdempotencyKey,
} from "./security.js";
import type { BillingReferenceType, ResolvedBachsOptions } from "./types.js";
import { BachsWebhookError, constructBachsEvent } from "./webhooks.js";

const referenceBody = {
  referenceId: z.string().optional(),
  referenceType: z.enum(["user", "organization"]).optional(),
};
const idempotencyKeySchema = z.string().trim().min(1).max(256);

function operationIdempotencyKey(
  operation: string,
  actorId: string,
  requestedKey: string,
  reference?: { id: string; type: BillingReferenceType },
) {
  return scopedIdempotencyKey(operation, actorId, requestedKey, reference);
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

function extractUserId(data: Record<string, unknown>): string | null {
  const metadata = data.metadata;
  if (metadata && typeof metadata === "object") {
    const userId = (metadata as Record<string, unknown>).better_auth_user_id;
    if (typeof userId === "string" && userId) return userId;
  }
  return null;
}

function extractReference(data: Record<string, unknown>): {
  referenceId: string | null;
  referenceType: BillingReferenceType;
} {
  const metadata = data.metadata;
  if (metadata && typeof metadata === "object") {
    const meta = metadata as Record<string, unknown>;
    const referenceId =
      typeof meta.reference_id === "string"
        ? meta.reference_id
        : typeof meta.better_auth_user_id === "string"
          ? meta.better_auth_user_id
          : null;
    const referenceType =
      meta.reference_type === "organization" ? "organization" : "user";
    return { referenceId, referenceType };
  }
  return { referenceId: null, referenceType: "user" };
}

async function requireCustomer(
  ctx: { context: { adapter: { findOne: Function } }; },
  referenceId: string,
  referenceType: BillingReferenceType,
) {
  const customer = await ctx.context.adapter.findOne({
    model: "bachsCustomer",
    where: [
      { field: "referenceId", value: referenceId },
      { field: "referenceType", value: referenceType },
    ],
  });
  const customerId = (customer as { customerId?: string } | null)?.customerId;
  if (!customerId) {
    throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.MISSING_CUSTOMER);
  }
  return customerId;
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
        idempotencyKey: idempotencyKeySchema,
        ...referenceBody,
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const user = ctx.context.session.user;
      const referenceType = (ctx.body.referenceType ?? "user") as BillingReferenceType;
      const referenceId = ctx.body.referenceId ?? user.id;

      await authorizeBillingReference(ctx, options, {
        referenceId,
        referenceType,
        userId: user.id,
      });

      const checkoutProduct = resolveCheckoutProduct(options, ctx.body);
      const { productId, planName, productName, groupId } = checkoutProduct;

      if (groupId) {
        const existing = await ctx.context.adapter.findMany({
          model: "bachsSubscription",
          where: [
            { field: "referenceId", value: referenceId },
            { field: "referenceType", value: referenceType },
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

      const successUrl = resolveTrustedRedirectUrl(
        ctx.body.successUrl,
        options.successUrl,
        options.successUrl,
      );
      if (!successUrl) {
        throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.MISSING_SUCCESS_URL);
      }
      const cancelUrl = resolveTrustedRedirectUrl(
        ctx.body.cancelUrl,
        options.cancelUrl,
        options.cancelUrl ?? options.successUrl,
      );
      if (!user.email) {
        throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.MISSING_EMAIL);
      }

      const customer = await resolveCheckoutCustomer(ctx, options, {
        referenceId,
        referenceType,
        email: user.email,
        name: user.name?.trim() || user.email,
      });

      const idempotencyKey = operationIdempotencyKey(
        "checkout",
        user.id,
        ctx.body.idempotencyKey,
        { id: referenceId, type: referenceType },
      );

      try {
        const checkout = await options.bachsClient.checkoutSessions.create(
          {
            product_cart: [{ product_id: productId, quantity: ctx.body.quantity ?? 1 }],
            customer,
            customer_creation: "if_required",
            success_url: successUrl,
            cancel_url: cancelUrl ?? null,
            reference: ctx.body.reference ?? null,
            metadata: {
              better_auth_user_id: user.id,
              reference_id: referenceId,
              reference_type: referenceType,
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
            referenceId,
            referenceType,
            userId: user.id,
            reference: checkout.reference,
            plan: planName ?? null,
            product: productName ?? null,
            status: checkout.status,
            checkoutUrl: checkout.checkout_url,
            metadata: JSON.stringify({ plan: planName, product: productName, group: groupId }),
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
          referenceId,
          referenceType,
        });
      } catch (err) {
        throwIfUncertain(err);
      }
    },
  );
}

export function upgradeSubscription(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/upgrade-subscription",
    {
      method: "POST",
      body: z.object({
        plan: z.string().min(1),
        subscriptionId: z.string().optional(),
        reference: z.string().optional(),
        successUrl: z.string().url().optional(),
        cancelUrl: z.string().url().nullable().optional(),
        idempotencyKey: idempotencyKeySchema,
        ...referenceBody,
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const plan = resolveCheckoutProduct(options, { plan: ctx.body.plan });

      const user = ctx.context.session.user;
      const referenceType = (ctx.body.referenceType ?? "user") as BillingReferenceType;
      const referenceId = ctx.body.referenceId ?? user.id;

      await authorizeBillingReference(ctx, options, {
        referenceId,
        referenceType,
        userId: user.id,
      });

      if (ctx.body.subscriptionId) {
        const local = await ctx.context.adapter.findOne({
          model: "bachsSubscription",
          where: [{ field: "subscriptionId", value: ctx.body.subscriptionId }],
        });
        if (!local) {
          throw new APIError("NOT_FOUND", BACHS_ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
        }
        await authorizeBillingReference(ctx, options, {
          referenceId: (local as { referenceId: string }).referenceId,
          referenceType: ((local as { referenceType?: string }).referenceType ??
            "user") as BillingReferenceType,
          userId: user.id,
        });
        if (
          (local as { referenceId: string }).referenceId !== referenceId ||
          ((local as { referenceType?: string }).referenceType ?? "user") !== referenceType
        ) {
          throw new APIError("FORBIDDEN", {
            code: "SUBSCRIPTION_REFERENCE_MISMATCH",
            message: "The subscription does not belong to the requested billing reference.",
          });
        }
      }

      const successUrl = resolveTrustedRedirectUrl(
        ctx.body.successUrl,
        options.successUrl,
        options.successUrl,
      );
      if (!successUrl) {
        throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.MISSING_SUCCESS_URL);
      }
      const cancelUrl = resolveTrustedRedirectUrl(
        ctx.body.cancelUrl,
        options.cancelUrl,
        options.cancelUrl ?? options.successUrl,
      );
      if (!user.email) {
        throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.MISSING_EMAIL);
      }

      const customer = await resolveCheckoutCustomer(ctx, options, {
        referenceId,
        referenceType,
        email: user.email,
        name: user.name?.trim() || user.email,
      });

      const idempotencyKey = operationIdempotencyKey(
        "upgrade",
        user.id,
        ctx.body.idempotencyKey,
        { id: referenceId, type: referenceType },
      );

      try {
        const checkout = await options.bachsClient.checkoutSessions.create(
          {
            product_cart: [{ product_id: plan.productId, quantity: 1 }],
            customer,
            customer_creation: "if_required",
            success_url: successUrl,
            cancel_url: cancelUrl ?? null,
            reference: ctx.body.reference ?? null,
            metadata: {
              better_auth_user_id: user.id,
              reference_id: referenceId,
              reference_type: referenceType,
              plan: plan.planName ?? null,
              product: null,
              group: plan.groupId ?? null,
              upgrade_from: ctx.body.subscriptionId ?? null,
            },
          },
          { idempotencyKey },
        );

        await ctx.context.adapter.create({
          model: "bachsCheckout",
          data: {
            checkoutId: checkout.checkout_id,
            referenceId,
            referenceType,
            userId: user.id,
            reference: checkout.reference,
            plan: plan.planName,
            product: null,
            status: checkout.status,
            checkoutUrl: checkout.checkout_url,
            metadata: JSON.stringify({
              plan: plan.planName,
              group: plan.groupId,
              upgradeFrom: ctx.body.subscriptionId ?? null,
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
          plan: plan.planName,
          product: null,
          referenceId,
          referenceType,
          upgradeFrom: ctx.body.subscriptionId ?? null,
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
      const local = requireLocalBillingResource(
        await ctx.context.adapter.findOne({
          model: "bachsCheckout",
          where: [{ field: "checkoutId", value: ctx.query.checkoutId }],
        }),
        BACHS_ERROR_CODES.CHECKOUT_NOT_FOUND,
      );
      await authorizeBillingReference(ctx, options, {
        referenceId: (local as { referenceId: string }).referenceId,
        referenceType: ((local as { referenceType?: string }).referenceType ??
          "user") as BillingReferenceType,
        userId: ctx.context.session.user.id,
      });

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
        customerId: checkout.customer?.id ?? checkout.customer_details?.id ?? null,
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
        idempotencyKey: idempotencyKeySchema,
        ...referenceBody,
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const user = ctx.context.session.user;
      const referenceType = (ctx.body.referenceType ?? "user") as BillingReferenceType;
      const referenceId = ctx.body.referenceId ?? user.id;
      await authorizeBillingReference(ctx, options, {
        referenceId,
        referenceType,
        userId: user.id,
      });
      const customerId = await requireCustomer(ctx, referenceId, referenceType);

      try {
        const portal = await options.bachsClient.customerPortal.createSession(
          customerId,
          {
            idempotencyKey: operationIdempotencyKey(
              "portal",
              user.id,
              ctx.body.idempotencyKey,
              { id: referenceId, type: referenceType },
            ),
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
    { method: "GET", use: [sessionMiddleware] },
    async (ctx) =>
      ctx.json({
        plans: getPublicPlans(options),
        enabled: options.subscription?.enabled !== false,
      }),
  );
}

export function listProducts(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-products",
    { method: "GET", use: [sessionMiddleware] },
    async (ctx) => ctx.json({ products: getPublicProducts(options) }),
  );
}

export function listCatalogProducts(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-catalog-products",
    {
      method: "GET",
      query: z
        .object({
          limit: z.coerce.number().int().positive().max(100).optional(),
          cursor: z.string().optional(),
          includeArchived: z
            .union([z.boolean(), z.literal("true"), z.literal("false")])
            .optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      const includeArchived =
        ctx.query?.includeArchived === true ||
        ctx.query?.includeArchived === "true";
      const page = await options.bachsClient.products.list({
        limit: ctx.query?.limit,
        cursor: ctx.query?.cursor,
        include_archived: includeArchived || undefined,
      });
      return ctx.json({
        items: page.items.map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description ?? null,
          status: product.status ?? null,
          price: product.price,
          billingCycle: product.billing_cycle ?? null,
        })),
        pagination: page.pagination,
      });
    },
  );
}

export function getCatalogProduct(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/get-catalog-product",
    {
      method: "GET",
      query: z.object({ productId: z.string().min(1) }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      const product = await options.bachsClient.products.get(ctx.query.productId);
      return ctx.json({
        id: product.id,
        name: product.name,
        description: product.description ?? null,
        status: product.status ?? null,
        price: product.price,
        billingCycle: product.billing_cycle ?? null,
        createdAt: product.created_at ?? null,
      });
    },
  );
}

export function getCustomer(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/get-customer",
    {
      method: "GET",
      query: z
        .object({
          referenceId: z.string().optional(),
          referenceType: z.enum(["user", "organization"]).optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const user = ctx.context.session.user;
      const referenceType = (ctx.query?.referenceType ?? "user") as BillingReferenceType;
      const referenceId = ctx.query?.referenceId ?? user.id;
      await authorizeBillingReference(ctx, options, {
        referenceId,
        referenceType,
        userId: user.id,
      });
      const customer = await ctx.context.adapter.findOne({
        model: "bachsCustomer",
        where: [
          { field: "referenceId", value: referenceId },
          { field: "referenceType", value: referenceType },
        ],
      });
      return ctx.json({ customer: customer ?? null });
    },
  );
}

export function listCheckouts(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-checkouts",
    {
      method: "GET",
      query: z
        .object({
          referenceId: z.string().optional(),
          referenceType: z.enum(["user", "organization"]).optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const user = ctx.context.session.user;
      const referenceType = (ctx.query?.referenceType ?? "user") as BillingReferenceType;
      const referenceId = ctx.query?.referenceId ?? user.id;
      await authorizeBillingReference(ctx, options, {
        referenceId,
        referenceType,
        userId: user.id,
      });
      const rows = await ctx.context.adapter.findMany({
        model: "bachsCheckout",
        where: [
          { field: "referenceId", value: referenceId },
          { field: "referenceType", value: referenceType },
        ],
      });
      return ctx.json({ checkouts: rows });
    },
  );
}

export function listRemoteSubscriptions(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-remote-subscriptions",
    {
      method: "GET",
      query: z
        .object({
          referenceId: z.string().optional(),
          referenceType: z.enum(["user", "organization"]).optional(),
          status: z
            .enum(["trialing", "active", "past_due", "unpaid", "canceled"])
            .optional(),
          limit: z.coerce.number().int().positive().max(100).optional(),
          offset: z.coerce.number().int().nonnegative().optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const user = ctx.context.session.user;
      const referenceType = (ctx.query?.referenceType ?? "user") as BillingReferenceType;
      const referenceId = ctx.query?.referenceId ?? user.id;
      await authorizeBillingReference(ctx, options, {
        referenceId,
        referenceType,
        userId: user.id,
      });
      const customerId = await requireCustomer(ctx, referenceId, referenceType);
      const page = await options.bachsClient.subscriptions.list({
        customer_id: customerId,
        status: ctx.query?.status,
        limit: ctx.query?.limit,
        offset: ctx.query?.offset,
      });
      return ctx.json({
        items: page.items,
        pagination: page.pagination,
      });
    },
  );
}

export function listSubscriptions(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-subscriptions",
    {
      method: "GET",
      query: z
        .object({
          referenceId: z.string().optional(),
          referenceType: z.enum(["user", "organization"]).optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const user = ctx.context.session.user;
      const referenceType = (ctx.query?.referenceType ?? "user") as BillingReferenceType;
      const referenceId = ctx.query?.referenceId ?? user.id;
      await authorizeBillingReference(ctx, options, {
        referenceId,
        referenceType,
        userId: user.id,
      });
      const rows = await ctx.context.adapter.findMany({
        model: "bachsSubscription",
        where: [
          { field: "referenceId", value: referenceId },
          { field: "referenceType", value: referenceType },
        ],
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
        where: [{ field: "subscriptionId", value: ctx.query.subscriptionId }],
      });
      if (!local) {
        throw new APIError("NOT_FOUND", BACHS_ERROR_CODES.SUBSCRIPTION_NOT_FOUND);
      }
      await authorizeBillingReference(ctx, options, {
        referenceId: (local as { referenceId: string }).referenceId,
        referenceType: ((local as { referenceType?: string }).referenceType ??
          "user") as BillingReferenceType,
        userId: ctx.context.session.user.id,
      });

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
        reason: z.string().nullable().optional(),
        idempotencyKey: idempotencyKeySchema,
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const local = await ctx.context.adapter.findOne({
        model: "bachsSubscription",
        where: [{ field: "subscriptionId", value: ctx.body.subscriptionId }],
      });
      if (!local) {
        throw new APIError("FORBIDDEN", BACHS_ERROR_CODES.SUBSCRIPTION_FORBIDDEN);
      }
      await authorizeBillingReference(ctx, options, {
        referenceId: (local as { referenceId: string }).referenceId,
        referenceType: ((local as { referenceType?: string }).referenceType ??
          "user") as BillingReferenceType,
        userId: ctx.context.session.user.id,
      });

      try {
        const subscription = await options.bachsClient.subscriptions.cancel(
          ctx.body.subscriptionId,
          {
            cancel_at_period_end: ctx.body.cancelAtPeriodEnd ?? true,
            reason: ctx.body.reason ?? null,
          },
          {
            idempotencyKey: operationIdempotencyKey(
              "cancel",
              ctx.context.session.user.id,
              ctx.body.idempotencyKey,
              { id: ctx.body.subscriptionId, type: "user" },
            ),
          },
        );

        await ctx.context.adapter.update({
          model: "bachsSubscription",
          where: [{ field: "subscriptionId", value: ctx.body.subscriptionId }],
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

export function listPayments(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-payments",
    {
      method: "GET",
      query: z
        .object({
          referenceId: z.string().optional(),
          referenceType: z.enum(["user", "organization"]).optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const user = ctx.context.session.user;
      const referenceType = (ctx.query?.referenceType ?? "user") as BillingReferenceType;
      const referenceId = ctx.query?.referenceId ?? user.id;
      await authorizeBillingReference(ctx, options, {
        referenceId,
        referenceType,
        userId: user.id,
      });
      const rows = await ctx.context.adapter.findMany({
        model: "bachsPayment",
        where: [
          { field: "referenceId", value: referenceId },
          { field: "referenceType", value: referenceType },
        ],
      });
      return ctx.json({ payments: rows });
    },
  );
}

export function getPayment(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/get-payment",
    {
      method: "GET",
      query: z.object({ paymentId: z.string().min(1) }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const local = requireLocalBillingResource(
        await ctx.context.adapter.findOne({
          model: "bachsPayment",
          where: [{ field: "paymentId", value: ctx.query.paymentId }],
        }),
        BACHS_ERROR_CODES.PAYMENT_NOT_FOUND,
      );
      await authorizeBillingReference(ctx, options, {
        referenceId: (local as { referenceId: string }).referenceId,
        referenceType: ((local as { referenceType?: string }).referenceType ??
          "user") as BillingReferenceType,
        userId: ctx.context.session.user.id,
      });

      const remote = await options.bachsClient.payments.get(ctx.query.paymentId);
      return ctx.json({
        local,
        payment: {
          id: remote.payment_id,
          status: remote.status,
          amount: remote.amount,
          currency: remote.currency,
          reference: remote.reference ?? null,
          checkoutId: remote.checkout_id ?? null,
          subscriptionId: remote.subscription_id ?? null,
        },
      });
    },
  );
}

export function billingStatus(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/billing-status",
    {
      method: "GET",
      query: z
        .object({
          referenceId: z.string().optional(),
          referenceType: z.enum(["user", "organization"]).optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      const user = ctx.context.session.user;
      const referenceType = (ctx.query?.referenceType ?? "user") as BillingReferenceType;
      const referenceId = ctx.query?.referenceId ?? user.id;
      await authorizeBillingReference(ctx, options, {
        referenceId,
        referenceType,
        userId: user.id,
      });

      const customer = await ctx.context.adapter.findOne({
        model: "bachsCustomer",
        where: [
          { field: "referenceId", value: referenceId },
          { field: "referenceType", value: referenceType },
        ],
      });
      const subscriptions = (await ctx.context.adapter.findMany({
        model: "bachsSubscription",
        where: [
          { field: "referenceId", value: referenceId },
          { field: "referenceType", value: referenceType },
        ],
      })) as Array<{ status: string }>;

      return ctx.json({
        referenceId,
        referenceType,
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
    { method: "GET", use: [sessionMiddleware] },
    async (ctx) =>
      ctx.json({
        subscription: {
          enabled: options.subscription?.enabled !== false,
          plans: (options.subscription?.plans ?? []).map((plan) => ({
            name: plan.name,
            description: plan.description,
            group: plan.group,
          })),
        },
        products: {
          products: (options.products?.products ?? []).map((product) => ({
            name: product.name,
            description: product.description,
          })),
        },
        organization: {
          enabled: options.organization?.enabled === true,
        },
        merchant: options.merchant === true,
      }),
  );
}

async function assertMerchant(ctx: GenericEndpointContext, options: ResolvedBachsOptions) {
  const userId = ctx.context.session?.user?.id;
  if (!userId) throw new APIError("UNAUTHORIZED", BACHS_ERROR_CODES.UNAUTHORIZED);
  await assertMerchantAccess(options, ctx, userId);
}

export function getBalance(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/get-balance",
    { method: "GET", use: [sessionMiddleware] },
    async (ctx) => {
      await assertMerchant(ctx, options);
      return ctx.json(await options.bachsClient.balances.get());
    },
  );
}

export function listBanks(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-banks",
    {
      method: "GET",
      query: z.object({ country: z.string().optional() }).optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      return ctx.json(
        await options.bachsClient.banks.list({ country: ctx.query?.country }),
      );
    },
  );
}

export function resolveBankAccount(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/resolve-bank-account",
    {
      method: "POST",
      body: z.object({
        accountNumber: z.string().min(1),
        bankCode: z.string().min(1),
        country: z.string().nullable().optional(),
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      try {
        const resolved = await options.bachsClient.banks.resolveAccount({
          account_number: ctx.body.accountNumber,
          bank_code: ctx.body.bankCode,
          country: ctx.body.country ?? null,
        });
        return ctx.json({
          resolved: resolved.resolved,
          accountName: resolved.account_name,
          accountNumber: resolved.account_number,
          message: resolved.message,
        });
      } catch (err) {
        throwIfUncertain(err);
      }
    },
  );
}

export function createProduct(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/create-product",
    {
      method: "POST",
      body: z.object({
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        currency: z.string().min(3).max(3),
        amount: z.string().optional(),
        presetAmount: z.string().optional(),
        minimumAmount: z.string().optional(),
        maximumAmount: z.string().optional(),
        priceType: z.enum(["fixed", "free", "custom"]).optional(),
        billingInterval: z.enum(["day", "week", "month", "year"]).optional(),
        billingFrequency: z.number().int().positive().optional(),
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
        idempotencyKey: idempotencyKeySchema,
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      const currency = ctx.body.currency as import("@bachs/sdk").ProductCurrency;
      const priceType = ctx.body.priceType ?? "fixed";
      if (priceType === "fixed" && !ctx.body.amount) {
        throw new APIError("BAD_REQUEST", {
          code: "PRODUCT_AMOUNT_REQUIRED",
          message: "Fixed-price products require amount (decimal string).",
        });
      }
      try {
        const product = await options.bachsClient.products.create(
          {
            name: ctx.body.name,
            description: ctx.body.description ?? null,
            metadata: (ctx.body.metadata ?? null) as
              | Record<string, string | number | boolean | null>
              | null,
            price:
              priceType === "free"
                ? { currency, price_type: "free" }
                : priceType === "custom"
                  ? {
                      currency,
                      price_type: "custom",
                      preset_amount:
                        ctx.body.presetAmount ?? ctx.body.amount ?? undefined,
                      minimum_amount: ctx.body.minimumAmount,
                      maximum_amount: ctx.body.maximumAmount,
                    }
                  : { currency, amount: ctx.body.amount! },
            billing_cycle: ctx.body.billingInterval
              ? {
                  interval: ctx.body.billingInterval,
                  frequency: ctx.body.billingFrequency ?? 1,
                }
              : null,
          },
          {
            idempotencyKey: operationIdempotencyKey(
              "product",
              ctx.context.session.user.id,
              ctx.body.idempotencyKey,
            ),
          },
        );
        return ctx.json({
          id: product.id,
          name: product.name,
          description: product.description ?? null,
          price: product.price,
          billingCycle: product.billing_cycle ?? null,
          status: product.status ?? null,
        });
      } catch (err) {
        throwIfUncertain(err);
      }
    },
  );
}

export function listRemotePayments(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-remote-payments",
    {
      method: "GET",
      query: z
        .object({
          limit: z.coerce.number().int().positive().max(100).optional(),
          offset: z.coerce.number().int().nonnegative().optional(),
          statusFilter: z
            .enum([
              "created",
              "processing",
              "succeeded",
              "accepted",
              "failed",
              "expired",
              "cancelled",
              "refunded",
              "partially_refunded",
              "auto_refunded",
              "underpaid",
              "overpaid",
            ])
            .optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      return ctx.json(
        await options.bachsClient.payments.list({
          limit: ctx.query?.limit,
          offset: ctx.query?.offset,
          status_filter: ctx.query?.statusFilter,
        }),
      );
    },
  );
}

export function listPayoutDestinations(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-payout-destinations",
    {
      method: "GET",
      query: z
        .object({
          limit: z.coerce.number().int().positive().max(100).optional(),
          offset: z.coerce.number().int().nonnegative().optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      return ctx.json(
        await options.bachsClient.payoutDestinations.list({
          limit: ctx.query?.limit,
          offset: ctx.query?.offset,
        }),
      );
    },
  );
}

export function getPayoutDestination(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/get-payout-destination",
    {
      method: "GET",
      query: z.object({ destinationId: z.string().min(1) }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      return ctx.json(
        await options.bachsClient.payoutDestinations.get(ctx.query.destinationId),
      );
    },
  );
}

export function createPayoutDestination(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/create-payout-destination",
    {
      method: "POST",
      body: z.object({
        currency: z.string().min(3),
        name: z.string().optional(),
        accountNumber: z.string().optional(),
        bankCode: z.string().optional(),
        accountName: z.string().optional(),
        bankName: z.string().optional(),
        phoneNumber: z.string().optional(),
        mobileProvider: z.string().optional(),
        walletAddress: z.string().optional(),
        network: z.string().optional(),
        idempotencyKey: idempotencyKeySchema,
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      try {
        return ctx.json(
          await options.bachsClient.payoutDestinations.create(
            {
              currency: ctx.body.currency,
              name: ctx.body.name ?? null,
              account_number: ctx.body.accountNumber ?? null,
              bank_code: ctx.body.bankCode ?? null,
              account_name: ctx.body.accountName ?? null,
              bank_name: ctx.body.bankName ?? null,
              phone_number: ctx.body.phoneNumber ?? null,
              mobile_provider: ctx.body.mobileProvider ?? null,
              wallet_address: ctx.body.walletAddress ?? null,
              network: ctx.body.network ?? null,
            },
            {
              idempotencyKey: operationIdempotencyKey(
                "payout-destination",
                ctx.context.session.user.id,
                ctx.body.idempotencyKey,
              ),
            },
          ),
        );
      } catch (err) {
        throwIfUncertain(err);
      }
    },
  );
}

export function createPayoutQuote(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/create-payout-quote",
    {
      method: "POST",
      body: z.object({
        fromCurrency: z.string().min(3),
        toCurrency: z.string().min(3),
        amount: z.string().min(1),
        payoutMethod: z.string().nullable().optional(),
        idempotencyKey: idempotencyKeySchema,
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      try {
        const quote = await options.bachsClient.payoutQuotes.create(
          {
            from_currency: ctx.body.fromCurrency,
            to_currency: ctx.body.toCurrency,
            amount: ctx.body.amount,
            payout_method: ctx.body.payoutMethod ?? null,
          },
          {
            idempotencyKey: operationIdempotencyKey(
              "payout-quote",
              ctx.context.session.user.id,
              ctx.body.idempotencyKey,
            ),
          },
        );
        return ctx.json({
          quoteId: quote.quote_id,
          fromCurrency: quote.from_currency,
          toCurrency: quote.to_currency,
          fromAmount: quote.from_amount,
          toAmount: quote.to_amount,
          exchangeRate: quote.exchange_rate,
          expiresAt: quote.expires_at,
        });
      } catch (err) {
        throwIfUncertain(err);
      }
    },
  );
}

export function createPayout(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/create-payout",
    {
      method: "POST",
      body: z.object({
        destination: z.string().min(1),
        amount: z.string().optional(),
        quoteId: z.string().optional(),
        reference: z.string().nullable().optional(),
        idempotencyKey: idempotencyKeySchema,
      }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      if (!ctx.body.amount && !ctx.body.quoteId) {
        throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.PAYOUT_AMOUNT_REQUIRED);
      }
      try {
        const payout = await options.bachsClient.payouts.create(
          (ctx.body.quoteId
            ? {
                destination: ctx.body.destination,
                quote_id: ctx.body.quoteId,
                reference: ctx.body.reference ?? null,
              }
            : {
                destination: ctx.body.destination,
                amount: ctx.body.amount!,
                reference: ctx.body.reference ?? null,
              }) as Parameters<typeof options.bachsClient.payouts.create>[0],
          {
            idempotencyKey: operationIdempotencyKey(
              "payout",
              ctx.context.session.user.id,
              ctx.body.idempotencyKey,
            ),
          },
        );
        return ctx.json({
          id: payout.id,
          status: payout.status,
          amount: payout.amount,
          currency: payout.currency,
        });
      } catch (err) {
        throwIfUncertain(err);
      }
    },
  );
}

export function listPayouts(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/list-payouts",
    {
      method: "GET",
      query: z
        .object({
          limit: z.coerce.number().int().positive().max(100).optional(),
          offset: z.coerce.number().int().nonnegative().optional(),
        })
        .optional(),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      return ctx.json(
        await options.bachsClient.payouts.list({
          limit: ctx.query?.limit,
          offset: ctx.query?.offset,
        }),
      );
    },
  );
}

export function getPayout(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/get-payout",
    {
      method: "GET",
      query: z.object({ payoutId: z.string().min(1) }),
      use: [sessionMiddleware],
    },
    async (ctx) => {
      await assertMerchant(ctx, options);
      return ctx.json(await options.bachsClient.payouts.get(ctx.query.payoutId));
    },
  );
}

export function bachsWebhook(options: ResolvedBachsOptions) {
  return createAuthEndpoint(
    "/bachs/webhook",
    { method: "POST" },
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
        event = constructBachsEvent(rawBody, ctx.headers ?? {}, options.webhookSecret);
      } catch (err) {
        if (err instanceof BachsWebhookError) {
          throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.INVALID_WEBHOOK);
        }
        throw err;
      }

      let existing = await ctx.context.adapter.findOne({
        model: "bachsWebhookEvent",
        where: [{ field: "eventId", value: event.id }],
      });
      if (existing && (existing as { status: string }).status === "processed") {
        return ctx.json({ received: true, duplicate: true, id: event.id });
      }

      if (!existing) {
        try {
          await ctx.context.adapter.create({
            model: "bachsWebhookEvent",
            data: {
              eventId: event.id,
              eventType: event.type,
              payload: JSON.stringify({ id: event.id, type: event.type }),
              status: "received",
              leaseExpiresAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        } catch (error) {
          existing = await ctx.context.adapter.findOne({
            model: "bachsWebhookEvent",
            where: [{ field: "eventId", value: event.id }],
          });
          if (!existing) throw error;
          if ((existing as { status: string }).status === "processed") {
            return ctx.json({ received: true, duplicate: true, id: event.id });
          }
        }
      }

      const claimed = await claimWebhookEvent(ctx.context.adapter, event.id);
      if (!claimed) {
        throw new APIError("INTERNAL_SERVER_ERROR", BACHS_ERROR_CODES.WEBHOOK_IN_PROGRESS);
      }

      try {
        const database = ctx.context.adapter;
        await database.transaction(async (adapter) => {
          const data = event.data;
          const userId = extractUserId(data);
          const customerId = extractCustomerId(data);
          const { referenceId, referenceType } = extractReference(data);
          const resolvedReferenceId = referenceId ?? userId;

          if (
            options.createCustomerOnCheckout &&
            resolvedReferenceId &&
            customerId
          ) {
            const existingCustomer = await adapter.findOne({
              model: "bachsCustomer",
              where: [
                { field: "referenceId", value: resolvedReferenceId },
                { field: "referenceType", value: referenceType },
              ],
            });
            if (!existingCustomer) {
              await adapter.create({
                model: "bachsCustomer",
                data: {
                  referenceId: resolvedReferenceId,
                  referenceType,
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
              await adapter.update({
                model: "bachsCustomer",
                where: [
                  { field: "referenceId", value: resolvedReferenceId },
                  { field: "referenceType", value: referenceType },
                ],
                update: { customerId, updatedAt: new Date() },
              });
            }
          }

          if (event.type === "checkout.completed" && typeof data.checkout_id === "string") {
            await adapter.update({
              model: "bachsCheckout",
              where: [{ field: "checkoutId", value: data.checkout_id }],
              update: { status: "completed", updatedAt: new Date() },
            });
          }

          const paymentId =
            typeof data.payment_id === "string"
              ? data.payment_id
              : typeof data.id === "string" && event.type.includes("payment")
                ? data.id
                : null;

          if (
            paymentId &&
            resolvedReferenceId &&
            (event.type === "collection.succeeded" ||
              event.type === "checkout.completed" ||
              event.type.startsWith("payment."))
          ) {
            const existingPayment = await adapter.findOne({
              model: "bachsPayment",
              where: [{ field: "paymentId", value: paymentId }],
            });
            const paymentPayload = {
              paymentId,
              referenceId: resolvedReferenceId,
              referenceType,
              userId: userId ?? resolvedReferenceId,
              checkoutId: typeof data.checkout_id === "string" ? data.checkout_id : null,
              subscriptionId:
                typeof data.subscription_id === "string" ? data.subscription_id : null,
              amount: typeof data.amount === "string" ? data.amount : null,
              currency: typeof data.currency === "string" ? data.currency : null,
              status: typeof data.status === "string" ? data.status : "succeeded",
              reference: typeof data.reference === "string" ? data.reference : null,
              updatedAt: new Date(),
            };
            if (existingPayment) {
              await adapter.update({
                model: "bachsPayment",
                where: [{ field: "paymentId", value: paymentId }],
                update: paymentPayload,
              });
            } else {
              await adapter.create({
                model: "bachsPayment",
                data: { ...paymentPayload, createdAt: new Date() },
              });
            }
          }

          if (
            event.type.startsWith("customer.subscription.") &&
            typeof data.id === "string" &&
            resolvedReferenceId
          ) {
            const plan =
              data.metadata && typeof data.metadata === "object"
                ? ((data.metadata as Record<string, unknown>).plan as string | undefined)
                : undefined;
            const groupId =
              data.metadata && typeof data.metadata === "object"
                ? ((data.metadata as Record<string, unknown>).group as string | undefined)
                : undefined;

            const existingSub = await adapter.findOne({
              model: "bachsSubscription",
              where: [{ field: "subscriptionId", value: data.id }],
            });

            const payload = {
              subscriptionId: data.id,
              referenceId: resolvedReferenceId,
              referenceType,
              userId: userId ?? resolvedReferenceId,
              customerId: customerId ?? "",
              plan: plan ?? null,
              productId: typeof data.product_id === "string" ? data.product_id : null,
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
              await adapter.update({
                model: "bachsSubscription",
                where: [{ field: "subscriptionId", value: data.id }],
                update: payload,
              });
            } else {
              await adapter.create({
                model: "bachsSubscription",
                data: { ...payload, createdAt: new Date() },
              });
            }
          }

        });

        if (options.onEvent) await options.onEvent(event);

        await ctx.context.adapter.update({
          model: "bachsWebhookEvent",
          where: [{ field: "eventId", value: event.id }],
          update: {
            status: "processed",
            leaseExpiresAt: null,
            processedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } catch (error) {
        try {
          await ctx.context.adapter.update({
            model: "bachsWebhookEvent",
            where: [
              { field: "eventId", value: event.id },
              { field: "status", value: "processing" },
            ],
            update: {
              status: "received",
              leaseExpiresAt: null,
              updatedAt: new Date(),
            },
          });
        } catch {
          // Keep the original processing error; the lease permits later recovery.
        }
        throw error;
      }

      return ctx.json({ received: true, id: event.id, type: event.type });
    },
  );
}
