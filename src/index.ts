import type { BetterAuthPlugin } from "better-auth";
import { resolveOptions } from "./bachs-sdk.js";
import { BACHS_ERROR_CODES } from "./errors.js";
import { getSchema } from "./schema.js";
import {
  bachsWebhook,
  billingStatus,
  cancelSubscription,
  createCheckout,
  createPortalSession,
  getCheckout,
  getConfig,
  getSubscription,
  listPlans,
  listProducts,
  listSubscriptions,
} from "./routes.js";
import type { BachsPluginOptions } from "./types.js";
import { PACKAGE_VERSION } from "./version.js";

declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    bachs: {
      creator: typeof bachs;
    };
  }
}

type BachsPluginEndpoints = {
  createCheckout: ReturnType<typeof createCheckout>;
  getCheckout: ReturnType<typeof getCheckout>;
  createPortalSession: ReturnType<typeof createPortalSession>;
  listPlans: ReturnType<typeof listPlans>;
  listProducts: ReturnType<typeof listProducts>;
  listSubscriptions: ReturnType<typeof listSubscriptions>;
  getSubscription: ReturnType<typeof getSubscription>;
  cancelSubscription: ReturnType<typeof cancelSubscription>;
  billingStatus: ReturnType<typeof billingStatus>;
  getConfig: ReturnType<typeof getConfig>;
  bachsWebhook: ReturnType<typeof bachsWebhook>;
};

/**
 * Better Auth plugin for Bachs payments.
 *
 * Built on the official `@bachs/sdk` — pass a Bachs client (recommended) or an API key.
 *
 * @example
 * ```ts
 * import { Bachs } from "@bachs/sdk";
 * import { betterAuth } from "better-auth";
 * import { bachs } from "better-auth-bachs";
 *
 * const bachsClient = new Bachs({ apiKey: process.env.BACHS_API_KEY! });
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     bachs({
 *       bachsClient,
 *       webhookSecret: process.env.BACHS_WEBHOOK_SECRET!,
 *       successUrl: "https://app.example.com/billing/success",
 *       subscription: {
 *         enabled: true,
 *         plans: [{ name: "pro", productId: "prod_...", group: "workspace" }],
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export const bachs = (options: BachsPluginOptions = {}) => {
  const resolved = resolveOptions(options);

  const endpoints = {
    createCheckout: createCheckout(resolved),
    getCheckout: getCheckout(resolved),
    createPortalSession: createPortalSession(resolved),
    listPlans: listPlans(resolved),
    listProducts: listProducts(resolved),
    listSubscriptions: listSubscriptions(resolved),
    getSubscription: getSubscription(resolved),
    cancelSubscription: cancelSubscription(resolved),
    billingStatus: billingStatus(),
    getConfig: getConfig(resolved),
    bachsWebhook: bachsWebhook(resolved),
  } satisfies BachsPluginEndpoints;

  return {
    id: "bachs",
    version: PACKAGE_VERSION,
    endpoints,
    schema: getSchema(options),
    rateLimit: [
      {
        pathMatcher: (path) => path.startsWith("/bachs/") && path !== "/bachs/webhook",
        window: 60,
        max: 40,
      },
    ],
    options: resolved,
    $ERROR_CODES: BACHS_ERROR_CODES,
  } satisfies BetterAuthPlugin;
};

export type { BachsPluginOptions, BachsPlan, BachsOneTimeProduct } from "./types.js";
export { BACHS_ERROR_CODES } from "./errors.js";
export { Bachs, createBachsClient } from "./bachs-sdk.js";
export {
  constructBachsEvent,
  BachsWebhookError,
  webhooks,
} from "./webhooks.js";
export { PACKAGE_VERSION } from "./version.js";
