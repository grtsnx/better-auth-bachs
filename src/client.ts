import type { BetterAuthClientPlugin } from "better-auth/client";
import type { bachs } from "./index.js";
import { PACKAGE_VERSION } from "./version.js";

type BachsServerPlugin = typeof bachs;

export type BachsClientOptions = {
  /**
   * When true, subscription helpers are emphasized in docs / agent skills.
   * Does not change runtime behavior.
   * @default true
   */
  subscription?: boolean;
};

/**
 * Client companion for the Bachs Better Auth plugin.
 */
export const bachsClient = (_options: BachsClientOptions = {}) => {
  return {
    id: "bachs",
    version: PACKAGE_VERSION,
    $InferServerPlugin: {} as ReturnType<BachsServerPlugin>,
    pathMethods: {
      "/bachs/create-checkout": "POST",
      "/bachs/create-portal-session": "POST",
      "/bachs/cancel-subscription": "POST",
      "/bachs/webhook": "POST",
    },
    getActions: ($fetch) => ({
      createCheckout: async (
        data: {
          plan?: string;
          product?: string;
          productId?: string;
          quantity?: number;
          reference?: string;
          successUrl?: string;
          cancelUrl?: string | null;
          idempotencyKey?: string;
        },
        fetchOptions?: Record<string, unknown>,
      ) => {
        return $fetch("/bachs/create-checkout", {
          method: "POST",
          body: data,
          ...fetchOptions,
        });
      },
      createPortalSession: async (
        data: { idempotencyKey?: string } = {},
        fetchOptions?: Record<string, unknown>,
      ) => {
        return $fetch("/bachs/create-portal-session", {
          method: "POST",
          body: data,
          ...fetchOptions,
        });
      },
      cancelSubscription: async (
        data: {
          subscriptionId: string;
          cancelAtPeriodEnd?: boolean;
          idempotencyKey?: string;
        },
        fetchOptions?: Record<string, unknown>,
      ) => {
        return $fetch("/bachs/cancel-subscription", {
          method: "POST",
          body: data,
          ...fetchOptions,
        });
      },
      listSubscriptions: async (fetchOptions?: Record<string, unknown>) => {
        return $fetch("/bachs/list-subscriptions", {
          method: "GET",
          ...fetchOptions,
        });
      },
      billingStatus: async (fetchOptions?: Record<string, unknown>) => {
        return $fetch("/bachs/billing-status", {
          method: "GET",
          ...fetchOptions,
        });
      },
      config: async (fetchOptions?: Record<string, unknown>) => {
        return $fetch("/bachs/config", {
          method: "GET",
          ...fetchOptions,
        });
      },
      listPlans: async (fetchOptions?: Record<string, unknown>) => {
        return $fetch("/bachs/list-plans", {
          method: "GET",
          ...fetchOptions,
        });
      },
      listProducts: async (fetchOptions?: Record<string, unknown>) => {
        return $fetch("/bachs/list-products", {
          method: "GET",
          ...fetchOptions,
        });
      },
    }),
  } satisfies BetterAuthClientPlugin;
};
