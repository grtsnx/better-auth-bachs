# Better Auth Bachs Plugin

A TypeScript-first plugin that integrates [Bachs](https://bachs.io) into [Better Auth](https://www.better-auth.com). Built on the official [`@bachs/sdk`](https://www.npmjs.com/package/@bachs/sdk) — hosted checkout, subscriptions, customer portal, local billing records, and secure webhooks.

[![GitHub](https://img.shields.io/badge/github-grtsnx%2Fbetter-auth-bachs-blue)](https://github.com/grtsnx/better-auth-bachs)
![GitHub License](https://img.shields.io/github/license/grtsnx/better-auth-bachs)

**Author:** [Greatness Abolade](https://github.com/grtsnx)

## Features

- [x] **Official SDK** — every Bachs API call goes through `@bachs/sdk`
- [x] **Plan-based checkout** — map app plan names to Bachs catalog `productId`s
- [x] **One-time products** — named products for credits / packs
- [x] **Subscription groups** — one active subscription per group (e.g. `workspace`)
- [x] **Customer portal** — open Bachs portal for the linked customer
- [x] **Local billing tables** — customers, checkouts, subscriptions, webhook events
- [x] **Webhook dedupe** — verify `X-Bachs-Signature-V2`, store event ids, process once
- [x] **Typed client** — `authClient.bachs.createCheckout({ plan: "pro" })`

## Quick Start

### Prerequisites

- **Node.js** `v22` or higher (required by `@bachs/sdk`)
- **Better Auth** `v1.4` or higher

### 1. Install plugin & SDK

```bash
npm install better-auth better-auth-bachs @bachs/sdk
```

### 2. Environment

```env
BACHS_API_KEY=sk_sandbox_...
BACHS_WEBHOOK_SECRET=...   # endpoint signing secret from Bachs dashboard
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
```

### 3. Server plugin

```ts
import { Bachs } from "@bachs/sdk";
import { betterAuth } from "better-auth";
import { bachs } from "better-auth-bachs";

const bachsClient = new Bachs({
  apiKey: process.env.BACHS_API_KEY!,
});

export const auth = betterAuth({
  plugins: [
    bachs({
      bachsClient, // preferred — inject the official SDK
      webhookSecret: process.env.BACHS_WEBHOOK_SECRET!,
      successUrl: "https://your-app.com/billing/success",
      cancelUrl: "https://your-app.com/billing",
      subscription: {
        enabled: true,
        plans: [
          {
            name: "pro",
            productId: "prod_abc123", // Bachs catalog product
            group: "workspace",
            description: "Pro workspace plan",
          },
          {
            name: "starter",
            productId: "prod_def456",
            group: "workspace",
          },
        ],
      },
      products: {
        products: [
          { name: "credits_50", productId: "prod_credits_50" },
        ],
      },
      async onEvent(event) {
        // Fulfil after verified webhook (deduped by event.id)
      },
    }),
  ],
});
```

You can pass `apiKey` instead of `bachsClient`; the plugin will construct `new Bachs({ apiKey })` for you. Injecting the client is recommended.

### 4. Client plugin

```ts
import { createAuthClient } from "better-auth/client";
import { bachsClient } from "better-auth-bachs/client";

export const authClient = createAuthClient({
  plugins: [bachsClient({ subscription: true })],
});
```

### 5. Migrate schema

```bash
npx auth@latest generate
# or
npx auth@latest migrate
```

Tables added: `bachsCustomer`, `bachsCheckout`, `bachsSubscription`, `bachsWebhookEvent`.

---

## Usage

### Subscribe to a plan

```ts
const { data, error } = await authClient.bachs.createCheckout({
  plan: "pro",
  reference: orderId,
});

if (data?.checkoutUrl) {
  window.location.href = data.checkoutUrl;
}
```

### One-time product

```ts
await authClient.bachs.createCheckout({
  product: "credits_50",
});
```

### Billing status & portal

```ts
const { data: status } = await authClient.bachs.billingStatus();
const { data: portal } = await authClient.bachs.createPortalSession({});
if (portal?.portalUrl) window.location.href = portal.portalUrl;
```

### Cancel

```ts
await authClient.bachs.cancelSubscription({
  subscriptionId: "sub_...",
  cancelAtPeriodEnd: true,
});
```

---

## Webhooks

Point Bachs at:

```text
https://your-app.com/api/auth/bachs/webhook
```

Subscribe at least to:

- `checkout.completed`
- `collection.succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

The plugin verifies the signature with `@bachs/sdk` `webhooks.constructEvent`, deduplicates by `event.id`, links the Bachs customer to the Better Auth user (from `metadata.better_auth_user_id`), and upserts local subscription rows.

---

## Endpoints

| Path | Method | Purpose |
| --- | --- | --- |
| `/bachs/create-checkout` | `POST` | Start hosted checkout for a plan / product |
| `/bachs/get-checkout` | `GET` | Fetch checkout status |
| `/bachs/create-portal-session` | `POST` | Customer portal URL |
| `/bachs/list-plans` | `GET` | Configured plans |
| `/bachs/list-products` | `GET` | Configured one-time products |
| `/bachs/list-subscriptions` | `GET` | Local subscription rows for the user |
| `/bachs/get-subscription` | `GET` | Local + remote subscription |
| `/bachs/cancel-subscription` | `POST` | Cancel on Bachs + update local row |
| `/bachs/billing-status` | `GET` | Customer + active subscription summary |
| `/bachs/config` | `GET` | Public plan/product names (no product ids) |
| `/bachs/webhook` | `POST` | Verified Bachs webhooks |

---

## Options

| Option | Description |
| --- | --- |
| `bachsClient` | Injected `Bachs` from `@bachs/sdk` (**recommended**) |
| `apiKey` | Used when `bachsClient` is omitted |
| `webhookSecret` | Dashboard signing secret for `/bachs/webhook` |
| `successUrl` / `cancelUrl` | Default checkout return URLs |
| `subscription.plans` | `{ name, productId, group?, description? }[]` |
| `products.products` | `{ name, productId, description? }[]` |
| `createCustomerOnCheckout` | Persist `bachsCustomer` from webhooks (default `true`) |
| `onEvent` | Hook after a verified, non-duplicate webhook |

---

## Design notes

- Product ids stay on the server. Clients send **plan** / **product** names.
- Amounts and catalog prices are owned by Bachs — never trust client money fields.
- Uncertain SDK writes surface as a conflict so you can reconcile before retrying with a new idempotency key.
- Fulfil from verified webhooks, not from the success redirect alone.

Docs: [Bachs Node SDK](https://docs.bachs.io/sdks/node) · [Checkout](https://docs.bachs.io/guides/checkout/checkout-sessions) · [Webhooks](https://docs.bachs.io/guides/webhooks/overview)

## License

MIT © Greatness Abolade
