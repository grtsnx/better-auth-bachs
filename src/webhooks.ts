import {
  BachsWebhookError,
  webhooks,
  type WebhookEvent,
  type WebhookOptions,
} from "@bachs/sdk";

export function constructBachsEvent(
  rawBody: string | Uint8Array,
  headers: Headers | Record<string, string | string[] | undefined>,
  secret: string,
  options?: WebhookOptions,
): WebhookEvent {
  return webhooks.constructEvent(rawBody, headers, secret, options);
}

export { BachsWebhookError, webhooks };
export type { WebhookEvent };
