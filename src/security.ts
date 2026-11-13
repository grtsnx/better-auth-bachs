import { createHash } from "node:crypto";
import { APIError } from "better-auth/api";
import type { GenericEndpointContext } from "better-auth";
import { BACHS_ERROR_CODES } from "./errors.js";
import type {
  BillingReferenceType,
  BachsPlan,
  BachsOneTimeProduct,
  ResolvedBachsOptions,
} from "./types.js";

export type CheckoutProductSelection = {
  plan?: string;
  product?: string;
  productId?: string;
};

export type ResolvedCheckoutProduct = {
  productId: string;
  planName?: string;
  productName?: string;
  groupId?: string;
};

export function resolveCheckoutProduct(
  options: ResolvedBachsOptions,
  selection: CheckoutProductSelection,
): ResolvedCheckoutProduct {
  const selectors = [selection.plan, selection.product, selection.productId].filter(
    (value) => typeof value === "string" && value.length > 0,
  );

  if (selectors.length !== 1) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_PRODUCT_SELECTION",
      message: "Provide exactly one configured plan, product, or productId.",
    });
  }

  if (selection.plan) {
    if (options.subscription?.enabled === false) {
      throw new APIError("FORBIDDEN", {
        code: "SUBSCRIPTIONS_DISABLED",
        message: "Subscription checkout is disabled.",
      });
    }
    const plan = options.subscription?.plans?.find(
      (candidate) => candidate.name === selection.plan,
    );
    if (!plan) throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.PLAN_NOT_FOUND);
    return {
      productId: plan.productId,
      planName: plan.name,
      groupId: plan.group,
    };
  }

  if (selection.product) {
    const product = options.products?.products?.find(
      (candidate) => candidate.name === selection.product,
    );
    if (!product) throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.PRODUCT_NOT_FOUND);
    return { productId: product.productId, productName: product.name };
  }

  const configuredPlan = options.subscription?.plans?.find(
    (candidate) => candidate.productId === selection.productId,
  );
  if (configuredPlan) {
    if (options.subscription?.enabled === false) {
      throw new APIError("FORBIDDEN", {
        code: "SUBSCRIPTIONS_DISABLED",
        message: "Subscription checkout is disabled.",
      });
    }
    return {
      productId: configuredPlan.productId,
      planName: configuredPlan.name,
      groupId: configuredPlan.group,
    };
  }

  const configuredProduct = options.products?.products?.find(
    (candidate) => candidate.productId === selection.productId,
  );
  if (configuredProduct) {
    return {
      productId: configuredProduct.productId,
      productName: configuredProduct.name,
    };
  }

  throw new APIError("BAD_REQUEST", BACHS_ERROR_CODES.PRODUCT_NOT_FOUND);
}

export function resolveTrustedRedirectUrl(
  requested: string | null | undefined,
  configured: string | null | undefined,
  trustedBase: string | null | undefined,
): string | null | undefined {
  if (requested === null) return null;
  if (!requested) {
    return configured ? parseHttpUrl(configured).toString() : configured;
  }
  if (!trustedBase) {
    throw new APIError("BAD_REQUEST", {
      code: "UNTRUSTED_REDIRECT_URL",
      message: "A server-configured application URL is required for redirect overrides.",
    });
  }

  const requestedUrl = parseHttpUrl(requested);
  const trustedUrl = parseHttpUrl(trustedBase);
  if (requestedUrl.origin !== trustedUrl.origin) {
    throw new APIError("BAD_REQUEST", {
      code: "UNTRUSTED_REDIRECT_URL",
      message: "Redirect URLs must use the trusted application origin.",
    });
  }
  return requestedUrl.toString();
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new APIError("BAD_REQUEST", {
      code: "UNTRUSTED_REDIRECT_URL",
      message: "Redirect URLs must be absolute HTTP or HTTPS URLs.",
    });
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "UNTRUSTED_REDIRECT_URL",
      message: "Redirect URLs must be absolute HTTP or HTTPS URLs without credentials.",
    });
  }
  return url;
}

export function getPublicPlans(options: ResolvedBachsOptions) {
  return (options.subscription?.plans ?? []).map(({ name, description, group }) => ({
    name,
    description,
    group,
  }));
}

export function getPublicProducts(options: ResolvedBachsOptions) {
  return (options.products?.products ?? []).map(({ name, description }) => ({
    name,
    description,
  }));
}

export function requireLocalBillingResource<T>(
  resource: T,
  error: { code: string; message: string },
): NonNullable<T> {
  if (resource == null) throw new APIError("NOT_FOUND", error);
  return resource as NonNullable<T>;
}

type WebhookClaimAdapter = Pick<GenericEndpointContext["context"]["adapter"], "update">;

const WEBHOOK_CLAIM_LEASE_MS = 5 * 60 * 1000;

export async function claimWebhookEvent(
  adapter: WebhookClaimAdapter,
  eventId: string,
  now = new Date(),
): Promise<boolean> {
  const leaseExpiresAt = new Date(now.getTime() + WEBHOOK_CLAIM_LEASE_MS);
  const update = { status: "processing", leaseExpiresAt, updatedAt: now };
  const eventWhere = { field: "eventId", value: eventId } as const;

  const firstClaim = await adapter.update({
    model: "bachsWebhookEvent",
    where: [eventWhere, { field: "status", value: "received" }],
    update,
  });
  if (firstClaim) return true;

  const expiredClaim = await adapter.update({
    model: "bachsWebhookEvent",
    where: [
      eventWhere,
      { field: "status", value: "processing" },
      { field: "leaseExpiresAt", operator: "lt", value: now },
    ],
    update,
  });
  return Boolean(expiredClaim);
}

export async function assertMerchantAccess(
  options: ResolvedBachsOptions,
  ctx: Parameters<NonNullable<ResolvedBachsOptions["authorizeMerchant"]>>[0],
  userId: string,
): Promise<void> {
  if (!options.merchant) {
    throw new APIError("FORBIDDEN", BACHS_ERROR_CODES.MERCHANT_DISABLED);
  }
  if (!options.authorizeMerchant) {
    throw new APIError("FORBIDDEN", BACHS_ERROR_CODES.MERCHANT_AUTHORIZATION_REQUIRED);
  }
  if (!(await options.authorizeMerchant(ctx, userId))) {
    throw new APIError("FORBIDDEN", BACHS_ERROR_CODES.MERCHANT_FORBIDDEN);
  }
}

export function scopedIdempotencyKey(
  operation: string,
  actorId: string,
  key: string,
  reference?: { id: string; type: BillingReferenceType },
): string {
  const scope = JSON.stringify([operation, actorId, reference?.type, reference?.id, key]);
  const digest = createHash("sha256").update(scope).digest("hex");
  return `bachs:${operation}:${digest}`;
}

export type PublicPlan = Pick<BachsPlan, "name" | "description" | "group">;
export type PublicProduct = Pick<BachsOneTimeProduct, "name" | "description">;
