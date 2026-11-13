import type { Bachs, BachsOptions, WebhookEvent } from "@bachs/sdk";
import type { InferOptionSchema } from "better-auth/types";
import type { BachsPluginSchema } from "./schema.js";

export type BachsClient = Bachs;

export type BachsPlan = {
  /** App-facing plan name, e.g. "pro" */
  name: string;
  /** Bachs catalog product id (`prod_…`) */
  productId: string;
  description?: string;
  /**
   * Optional group. A user may only have one active/trialing subscription
   * per group (same idea as better-auth-paystack).
   */
  group?: string;
};

export type BachsOneTimeProduct = {
  name: string;
  productId: string;
  description?: string;
};

export type BachsPluginOptions = {
  /**
   * Official Bachs SDK client. Prefer creating it with `@bachs/sdk`:
   * `new Bachs({ apiKey: process.env.BACHS_API_KEY })`
   */
  bachsClient?: BachsClient;
  /**
   * Bachs secret API key. Used to construct a client when `bachsClient` is omitted.
   */
  apiKey?: string;
  /**
   * Extra options for `new Bachs(...)` when `apiKey` is used.
   */
  clientOptions?: Omit<BachsOptions, "apiKey">;
  /**
   * Webhook signing secret from the Bachs dashboard (not the API key).
   */
  webhookSecret?: string;
  /**
   * Default hosted-checkout success URL (must be public).
   */
  successUrl?: string;
  /**
   * Default hosted-checkout cancel URL.
   */
  cancelUrl?: string;
  /**
   * Subscription plans mapped to Bachs catalog products.
   */
  subscription?: {
    enabled?: boolean;
    plans?: BachsPlan[];
  };
  /**
   * One-time products mapped to Bachs catalog products.
   */
  products?: {
    products?: BachsOneTimeProduct[];
  };
  /**
   * When true, persist a local Bachs customer row after checkout / webhook
   * using the signed-in Better Auth user.
   * @default true
   */
  createCustomerOnCheckout?: boolean;
  /**
   * Called after a verified webhook event is accepted and recorded.
   */
  onEvent?: (event: WebhookEvent) => void | Promise<void>;
  /**
   * Optional schema overrides for Better Auth CLI migrations.
   */
  schema?: InferOptionSchema<BachsPluginSchema>;
};

export type ResolvedBachsOptions = BachsPluginOptions & {
  bachsClient: BachsClient;
  createCustomerOnCheckout: boolean;
};
