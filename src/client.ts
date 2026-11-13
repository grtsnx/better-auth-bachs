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
  /**
   * When true, merchant helpers are available on the client.
   * Server must also set `merchant: true`.
   * @default false
   */
  merchant?: boolean;
};

type ReferenceInput = {
  referenceId?: string;
  referenceType?: "user" | "organization";
};

/**
 * Client companion for the Bachs Better Auth plugin.
 */
export const bachsClient = (options: BachsClientOptions = {}) => {
  return {
    id: "bachs",
    version: PACKAGE_VERSION,
    $InferServerPlugin: {} as ReturnType<BachsServerPlugin>,
    pathMethods: {
      "/bachs/create-checkout": "POST",
      "/bachs/upgrade-subscription": "POST",
      "/bachs/create-portal-session": "POST",
      "/bachs/cancel-subscription": "POST",
      "/bachs/resolve-bank-account": "POST",
      "/bachs/create-product": "POST",
      "/bachs/create-payout-destination": "POST",
      "/bachs/create-payout-quote": "POST",
      "/bachs/create-payout": "POST",
      "/bachs/webhook": "POST",
    },
    getActions: ($fetch) => {
      const actions = {
        createCheckout: async (
          data: {
            plan?: string;
            product?: string;
            productId?: string;
            quantity?: number;
            reference?: string;
            successUrl?: string;
            cancelUrl?: string | null;
            idempotencyKey: string;
          } & ReferenceInput,
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/create-checkout", {
            method: "POST",
            body: data,
            ...fetchOptions,
          });
        },
        upgradeSubscription: async (
          data: {
            plan: string;
            subscriptionId?: string;
            reference?: string;
            successUrl?: string;
            cancelUrl?: string | null;
            idempotencyKey: string;
          } & ReferenceInput,
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/upgrade-subscription", {
            method: "POST",
            body: data,
            ...fetchOptions,
          });
        },
        createPortalSession: async (
          data: { idempotencyKey: string } & ReferenceInput,
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
            reason?: string | null;
            idempotencyKey: string;
          },
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/cancel-subscription", {
            method: "POST",
            body: data,
            ...fetchOptions,
          });
        },
        listSubscriptions: async (
          query: ReferenceInput = {},
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/list-subscriptions", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
        listRemoteSubscriptions: async (
          query: ReferenceInput & {
            status?: "trialing" | "active" | "past_due" | "unpaid" | "canceled";
            limit?: number;
            offset?: number;
          } = {},
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/list-remote-subscriptions", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
        getSubscription: async (
          query: { subscriptionId: string },
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/get-subscription", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
        getCheckout: async (
          query: { checkoutId: string },
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/get-checkout", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
        listCheckouts: async (
          query: ReferenceInput = {},
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/list-checkouts", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
        listPayments: async (
          query: ReferenceInput = {},
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/list-payments", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
        getPayment: async (
          query: { paymentId: string },
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/get-payment", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
        getCustomer: async (
          query: ReferenceInput = {},
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/get-customer", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
        billingStatus: async (
          query: ReferenceInput = {},
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/billing-status", {
            method: "GET",
            query,
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
        listCatalogProducts: async (
          query: {
            limit?: number;
            cursor?: string;
            includeArchived?: boolean;
          } = {},
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/list-catalog-products", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
        getCatalogProduct: async (
          query: { productId: string },
          fetchOptions?: Record<string, unknown>,
        ) => {
          return $fetch("/bachs/get-catalog-product", {
            method: "GET",
            query,
            ...fetchOptions,
          });
        },
      };

      if (options.merchant) {
        Object.assign(actions, {
          getBalance: async (fetchOptions?: Record<string, unknown>) => {
            return $fetch("/bachs/get-balance", {
              method: "GET",
              ...fetchOptions,
            });
          },
          listBanks: async (
            query: { country?: string } = {},
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/list-banks", {
              method: "GET",
              query,
              ...fetchOptions,
            });
          },
          resolveBankAccount: async (
            data: {
              accountNumber: string;
              bankCode: string;
              country?: string | null;
            },
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/resolve-bank-account", {
              method: "POST",
              body: data,
              ...fetchOptions,
            });
          },
          createProduct: async (
            data: {
              name: string;
              description?: string | null;
              currency: string;
              amount?: string;
              presetAmount?: string;
              minimumAmount?: string;
              maximumAmount?: string;
              priceType?: "fixed" | "free" | "custom";
              billingInterval?: "day" | "week" | "month" | "year";
              billingFrequency?: number;
              metadata?: Record<string, unknown> | null;
              idempotencyKey: string;
            },
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/create-product", {
              method: "POST",
              body: data,
              ...fetchOptions,
            });
          },
          listRemotePayments: async (
            query: {
              limit?: number;
              offset?: number;
              statusFilter?: string;
            } = {},
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/list-remote-payments", {
              method: "GET",
              query,
              ...fetchOptions,
            });
          },
          listPayoutDestinations: async (
            query: { limit?: number; offset?: number } = {},
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/list-payout-destinations", {
              method: "GET",
              query,
              ...fetchOptions,
            });
          },
          getPayoutDestination: async (
            query: { destinationId: string },
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/get-payout-destination", {
              method: "GET",
              query,
              ...fetchOptions,
            });
          },
          createPayoutDestination: async (
            data: {
              currency: string;
              name?: string;
              accountNumber?: string;
              bankCode?: string;
              accountName?: string;
              bankName?: string;
              phoneNumber?: string;
              mobileProvider?: string;
              walletAddress?: string;
              network?: string;
              idempotencyKey: string;
            },
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/create-payout-destination", {
              method: "POST",
              body: data,
              ...fetchOptions,
            });
          },
          createPayoutQuote: async (
            data: {
              fromCurrency: string;
              toCurrency: string;
              amount: string;
              payoutMethod?: string | null;
              idempotencyKey: string;
            },
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/create-payout-quote", {
              method: "POST",
              body: data,
              ...fetchOptions,
            });
          },
          createPayout: async (
            data: {
              destination: string;
              amount?: string;
              quoteId?: string;
              reference?: string | null;
              idempotencyKey: string;
            },
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/create-payout", {
              method: "POST",
              body: data,
              ...fetchOptions,
            });
          },
          listPayouts: async (
            query: { limit?: number; offset?: number } = {},
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/list-payouts", {
              method: "GET",
              query,
              ...fetchOptions,
            });
          },
          getPayout: async (
            query: { payoutId: string },
            fetchOptions?: Record<string, unknown>,
          ) => {
            return $fetch("/bachs/get-payout", {
              method: "GET",
              query,
              ...fetchOptions,
            });
          },
        });
      }

      return actions;
    },
  } satisfies BetterAuthClientPlugin;
};
