import type { BetterAuthPlugin } from "better-auth";
import { resolveOptions } from "./bachs-sdk.js";
import { BACHS_ERROR_CODES } from "./errors.js";
import { getSchema } from "./schema.js";
import {
  bachsWebhook,
  billingStatus,
  cancelSubscription,
  createCheckout,
  createPayout,
  createPayoutDestination,
  createPayoutQuote,
  createPortalSession,
  createProduct,
  getBalance,
  getCatalogProduct,
  getCheckout,
  getConfig,
  getCustomer,
  getPayment,
  getPayout,
  getPayoutDestination,
  getSubscription,
  listBanks,
  listCatalogProducts,
  listCheckouts,
  listPayments,
  listPayoutDestinations,
  listPayouts,
  listPlans,
  listProducts,
  listRemotePayments,
  listRemoteSubscriptions,
  listSubscriptions,
  resolveBankAccount,
  upgradeSubscription,
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

  const endpoints: BetterAuthPlugin["endpoints"] = {
    createCheckout: createCheckout(resolved),
    upgradeSubscription: upgradeSubscription(resolved),
    getCheckout: getCheckout(resolved),
    listCheckouts: listCheckouts(resolved),
    createPortalSession: createPortalSession(resolved),
    listPlans: listPlans(resolved),
    listProducts: listProducts(resolved),
    listCatalogProducts: listCatalogProducts(resolved),
    getCatalogProduct: getCatalogProduct(resolved),
    getCustomer: getCustomer(resolved),
    listSubscriptions: listSubscriptions(resolved),
    listRemoteSubscriptions: listRemoteSubscriptions(resolved),
    getSubscription: getSubscription(resolved),
    cancelSubscription: cancelSubscription(resolved),
    listPayments: listPayments(resolved),
    getPayment: getPayment(resolved),
    billingStatus: billingStatus(resolved),
    getConfig: getConfig(resolved),
    bachsWebhook: bachsWebhook(resolved),
  };

  if (resolved.merchant) {
    Object.assign(endpoints, {
      getBalance: getBalance(resolved),
      listBanks: listBanks(resolved),
      resolveBankAccount: resolveBankAccount(resolved),
      createProduct: createProduct(resolved),
      listRemotePayments: listRemotePayments(resolved),
      listPayoutDestinations: listPayoutDestinations(resolved),
      getPayoutDestination: getPayoutDestination(resolved),
      createPayoutDestination: createPayoutDestination(resolved),
      createPayoutQuote: createPayoutQuote(resolved),
      createPayout: createPayout(resolved),
      listPayouts: listPayouts(resolved),
      getPayout: getPayout(resolved),
    });
  }

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

export type {
  BachsPluginOptions,
  BachsPlan,
  BachsOneTimeProduct,
  BillingReferenceType,
} from "./types.js";
export { BACHS_ERROR_CODES } from "./errors.js";
export { Bachs, createBachsClient } from "./bachs-sdk.js";
export {
  constructBachsEvent,
  BachsWebhookError,
  webhooks,
} from "./webhooks.js";
export { PACKAGE_VERSION } from "./version.js";
