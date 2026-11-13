export const BACHS_ERROR_CODES = {
  UNAUTHORIZED: { code: "UNAUTHORIZED", message: "Authentication required." },
  PLAN_NOT_FOUND: { code: "PLAN_NOT_FOUND", message: "Plan was not found." },
  PRODUCT_NOT_FOUND: {
    code: "PRODUCT_NOT_FOUND",
    message: "Product was not found.",
  },
  MISSING_SUCCESS_URL: {
    code: "MISSING_SUCCESS_URL",
    message: "A success URL is required for checkout.",
  },
  MISSING_EMAIL: {
    code: "MISSING_EMAIL",
    message: "The signed-in user needs an email for Bachs checkout.",
  },
  MISSING_CUSTOMER: {
    code: "MISSING_CUSTOMER",
    message: "No Bachs customer is linked to this account yet.",
  },
  SUBSCRIPTION_FORBIDDEN: {
    code: "SUBSCRIPTION_FORBIDDEN",
    message: "This subscription does not belong to the signed-in user.",
  },
  INVALID_WEBHOOK: {
    code: "INVALID_WEBHOOK",
    message: "Invalid Bachs webhook signature.",
  },
  WEBHOOK_NOT_CONFIGURED: {
    code: "WEBHOOK_NOT_CONFIGURED",
    message: "webhookSecret is not configured on the Bachs plugin.",
  },
  UNCERTAIN_WRITE: {
    code: "UNCERTAIN_WRITE",
    message:
      "The Bachs write may have succeeded. Reconcile before retrying with a new idempotency key.",
  },
  ALREADY_SUBSCRIBED: {
    code: "ALREADY_SUBSCRIBED",
    message: "An active subscription already exists for this plan group.",
  },
} as const;
