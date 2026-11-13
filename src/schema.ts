import type { BetterAuthPluginDBSchema } from "better-auth/db";
import { mergeSchema } from "better-auth/db";
import type { BachsPluginOptions } from "./types.js";

const baseSchema = {
  bachsCustomer: {
    indexes: [
      {
        name: "bachs_customer_reference_unique",
        fields: ["referenceType", "referenceId"],
        unique: true,
      },
    ],
    fields: {
      referenceId: { type: "string", required: true },
      referenceType: { type: "string", required: true },
      customerId: { type: "string", required: true },
      email: { type: "string", required: false },
      createdAt: { type: "date", required: true, defaultValue: () => new Date() },
      updatedAt: { type: "date", required: true, defaultValue: () => new Date() },
    },
  },
  bachsCheckout: {
    indexes: [
      { name: "bachs_checkout_reference_idx", fields: ["referenceType", "referenceId"] },
    ],
    fields: {
      checkoutId: { type: "string", required: true, unique: true },
      referenceId: { type: "string", required: true },
      referenceType: { type: "string", required: true },
      userId: { type: "string", required: true },
      reference: { type: "string", required: false },
      plan: { type: "string", required: false },
      product: { type: "string", required: false },
      status: { type: "string", required: true },
      checkoutUrl: { type: "string", required: false },
      metadata: { type: "string", required: false },
      createdAt: { type: "date", required: true, defaultValue: () => new Date() },
      updatedAt: { type: "date", required: true, defaultValue: () => new Date() },
    },
  },
  bachsSubscription: {
    indexes: [
      {
        name: "bachs_subscription_reference_idx",
        fields: ["referenceType", "referenceId"],
      },
    ],
    fields: {
      subscriptionId: { type: "string", required: true, unique: true },
      referenceId: { type: "string", required: true },
      referenceType: { type: "string", required: true },
      userId: { type: "string", required: true },
      customerId: { type: "string", required: true },
      plan: { type: "string", required: false },
      productId: { type: "string", required: false },
      status: { type: "string", required: true },
      groupId: { type: "string", required: false },
      cancelAtPeriodEnd: { type: "boolean", required: false },
      currentPeriodEnd: { type: "date", required: false },
      metadata: { type: "string", required: false },
      createdAt: { type: "date", required: true, defaultValue: () => new Date() },
      updatedAt: { type: "date", required: true, defaultValue: () => new Date() },
    },
  },
  bachsPayment: {
    indexes: [
      { name: "bachs_payment_reference_idx", fields: ["referenceType", "referenceId"] },
    ],
    fields: {
      paymentId: { type: "string", required: true, unique: true },
      referenceId: { type: "string", required: true },
      referenceType: { type: "string", required: true },
      userId: { type: "string", required: true },
      checkoutId: { type: "string", required: false },
      subscriptionId: { type: "string", required: false },
      amount: { type: "string", required: false },
      currency: { type: "string", required: false },
      status: { type: "string", required: true },
      reference: { type: "string", required: false },
      metadata: { type: "string", required: false },
      createdAt: { type: "date", required: true, defaultValue: () => new Date() },
      updatedAt: { type: "date", required: true, defaultValue: () => new Date() },
    },
  },
  bachsWebhookEvent: {
    fields: {
      eventId: { type: "string", required: true, unique: true },
      eventType: { type: "string", required: true },
      payload: { type: "string", required: true },
      status: { type: "string", required: true },
      leaseExpiresAt: { type: "date", required: false },
      processedAt: { type: "date", required: false },
      createdAt: { type: "date", required: true, defaultValue: () => new Date() },
      updatedAt: { type: "date", required: true, defaultValue: () => new Date() },
    },
  },
} satisfies BetterAuthPluginDBSchema;

export type BachsPluginSchema = typeof baseSchema;

export function getSchema(options?: BachsPluginOptions) {
  return mergeSchema(baseSchema, options?.schema);
}
