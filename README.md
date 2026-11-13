# Better Auth Bachs Plugin

TypeScript billing plugin for [Better Auth](https://www.better-auth.com) backed by the official [`@bachs/sdk`](https://docs.bachs.io/sdks/node).

[![GitHub](https://img.shields.io/badge/github-grtsnx%2Fbetter-auth-bachs-blue)](https://github.com/grtsnx/better-auth-bachs)
![GitHub License](https://img.shields.io/github/license/grtsnx/better-auth-bachs)

**Author:** [Greatness Abolade](https://github.com/grtsnx)

## Features

- Official `@bachs/sdk` for every Bachs API call
- Plan / product name → catalog `productId` mapping (ids stay on the server)
- User **and** organization billing references
- Local tables for customers, checkouts, subscriptions, payments, webhook events
- Verified, deduped webhooks
- Opt-in **merchant** mode (create products, balance, banks, payouts)

---

## Setup

### Prerequisites

- Node.js **22+**
- Better Auth **1.4+**
- A [Bachs](https://bachs.io) account (sandbox or live API key + webhook signing secret)

### 1. Install

```bash
npm install better-auth better-auth-bachs @bachs/sdk
```

### 2. Environment

```env
BACHS_API_KEY=sk_sandbox_...
BACHS_WEBHOOK_SECRET=whsec_...   # signing secret from Bachs → Webhooks (not the API key)
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
```

### 3. Create products in Bachs

In the [Bachs dashboard](https://bachs.io) (or via merchant `createProduct` below), create catalog products and copy each `prod_…` id. Map those ids to **app plan/product names** in plugin config — clients never send product ids for normal checkout.

### 4. Server plugin

Mount Better Auth as usual (e.g. `/api/auth/*`). Add the Bachs plugin:

```ts
// auth.ts
import { Bachs } from "@bachs/sdk";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { bachs } from "better-auth-bachs";

const bachsClient = new Bachs({
  apiKey: process.env.BACHS_API_KEY!,
});

export const auth = betterAuth({
  plugins: [
    organization(), // required only if you enable org billing
    bachs({
      bachsClient,
      webhookSecret: process.env.BACHS_WEBHOOK_SECRET!,
      successUrl: "https://your-app.com/billing/success", // must be a public URL
      cancelUrl: "https://your-app.com/billing",
      organization: {
        enabled: true,
        billingRoles: ["owner", "admin"], // default
      },
      // merchant: true, // only if THIS app manages the Bachs merchant account
      subscription: {
        enabled: true,
        plans: [
          {
            name: "starter",
            productId: "prod_...",
            group: "workspace",
            description: "Starter plan",
          },
          {
            name: "pro",
            productId: "prod_...",
            group: "workspace",
            description: "Pro plan",
          },
        ],
      },
      products: {
        products: [{ name: "credits_50", productId: "prod_..." }],
      },
      async onEvent(event) {
        // Fulfil after verified, non-duplicate webhook
        // event.type, event.id, event.data
      },
    }),
  ],
});
```

`bachsClient` is preferred. You can pass `apiKey` instead and the plugin will construct `new Bachs({ apiKey })`.

### 5. Client plugin

```ts
// lib/auth-client.ts
import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";
import { bachsClient } from "better-auth-bachs/client";

export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    bachsClient({
      subscription: true,
      // merchant: true, // must match server merchant: true
    }),
  ],
});
```

All billing calls below use `authClient.bachs.*` and require a signed-in session (except the webhook).

### 6. Migrate the database

```bash
npx @better-auth/cli generate
# or
npx @better-auth/cli migrate
```

Tables: `bachsCustomer`, `bachsCheckout`, `bachsSubscription`, `bachsPayment`, `bachsWebhookEvent`.

### 7. Configure the Bachs webhook

In the Bachs dashboard, create an endpoint pointing at:

```text
https://your-app.com/api/auth/bachs/webhook
```

(Adjust the `/api/auth` prefix to match your Better Auth base path.)

Subscribe at least to:

| Event | Why |
| --- | --- |
| `checkout.completed` | Mark checkout paid; often creates customer |
| `collection.succeeded` | Record successful collection / payment |
| `customer.subscription.created` | Upsert local subscription |
| `customer.subscription.updated` | Sync status / period end |
| `customer.subscription.deleted` | Mark canceled |

Paste the endpoint **signing secret** into `BACHS_WEBHOOK_SECRET`.

---

## Concepts

| Concept | Meaning |
| --- | --- |
| **Plan name** | App string like `"pro"` → server looks up `productId` |
| **Product name** | One-time catalog alias like `"credits_50"` |
| **referenceId / referenceType** | Who is billed: signed-in `user` (default) or an `organization` |
| **Local vs remote** | Local = rows in your DB; remote = live Bachs API |
| **Merchant mode** | `merchant: true` — create products, payouts, account balance |

Organization billing also needs the Better Auth `organization` plugin. Only members with `billingRoles` (default `owner`, `admin`) may manage org billing.

---

## Endpoint reference

Base path: `{BETTER_AUTH_URL}/api/auth` (or your auth basePath).

### Checkout

#### `POST /bachs/create-checkout`

Start hosted Bachs checkout for a plan or one-time product.

```ts
const { data, error } = await authClient.bachs.createCheckout({
  plan: "pro", // or product: "credits_50" or productId: "prod_..."
  quantity: 1,
  reference: "order_123", // optional merchant reference
  successUrl: "https://your-app.com/billing/success",
  cancelUrl: "https://your-app.com/billing",
  // Organization:
  // referenceId: orgId,
  // referenceType: "organization",
});

if (data?.checkoutUrl) window.location.href = data.checkoutUrl;
```

Returns `checkoutId`, `checkoutUrl`, `status`, `plan` / `product`, `referenceId`, `referenceType`.

#### `POST /bachs/upgrade-subscription`

Checkout for a **new** plan (upgrade path). Optionally pass the subscription being replaced.

```ts
await authClient.bachs.upgradeSubscription({
  plan: "pro",
  subscriptionId: "sub_...", // optional
});
```

#### `GET /bachs/get-checkout`

```ts
await authClient.bachs.getCheckout({ checkoutId: "chs_..." });
```

#### `GET /bachs/list-checkouts`

Local checkout rows for the billing reference.

```ts
await authClient.bachs.listCheckouts();
await authClient.bachs.listCheckouts({
  referenceId: orgId,
  referenceType: "organization",
});
```

---

### Catalog & config

#### `GET /bachs/list-plans`

Configured subscription plans (from plugin options).

```ts
await authClient.bachs.listPlans();
```

#### `GET /bachs/list-products`

Configured one-time product aliases.

```ts
await authClient.bachs.listProducts();
```

#### `GET /bachs/list-catalog-products`

Live products from the Bachs catalog.

```ts
await authClient.bachs.listCatalogProducts({
  limit: 20,
  cursor: undefined,
  includeArchived: false,
});
```

#### `GET /bachs/get-catalog-product`

```ts
await authClient.bachs.getCatalogProduct({ productId: "prod_..." });
```

#### `GET /bachs/config`

Safe public config (plan/product **names** only — no product ids).

```ts
await authClient.bachs.config();
```

---

### Customer & billing status

#### `GET /bachs/get-customer`

Local `bachsCustomer` row for the reference (linked after checkout/webhook).

```ts
await authClient.bachs.getCustomer();
```

#### `GET /bachs/billing-status`

Customer id + whether an active/trialing/past_due subscription exists.

```ts
const { data } = await authClient.bachs.billingStatus();
// data.hasActiveSubscription, data.subscriptions, data.customerId
```

#### `POST /bachs/create-portal-session`

Open the Bachs customer portal (requires a linked customer).

```ts
const { data } = await authClient.bachs.createPortalSession({});
if (data?.portalUrl) window.location.href = data.portalUrl;
```

---

### Subscriptions

#### `GET /bachs/list-subscriptions`

Local subscription rows.

```ts
await authClient.bachs.listSubscriptions();
```

#### `GET /bachs/list-remote-subscriptions`

Live Bachs subscriptions for the linked customer.

```ts
await authClient.bachs.listRemoteSubscriptions({
  status: "active",
  limit: 20,
});
```

#### `GET /bachs/get-subscription`

Local row + remote snapshot.

```ts
await authClient.bachs.getSubscription({ subscriptionId: "sub_..." });
```

#### `POST /bachs/cancel-subscription`

```ts
await authClient.bachs.cancelSubscription({
  subscriptionId: "sub_...",
  cancelAtPeriodEnd: true, // default true
  reason: "too_expensive",
});
```

---

### Payments

#### `GET /bachs/list-payments`

Local payment rows (filled from webhooks).

```ts
await authClient.bachs.listPayments();
```

#### `GET /bachs/get-payment`

```ts
await authClient.bachs.getPayment({ paymentId: "pay_..." });
```

---

### Webhook

#### `POST /bachs/webhook`

Called by Bachs — not by your client. Verifies signature, dedupes by `event.id`, upserts customer / checkout / subscription / payment, then runs `onEvent`.

---

## Merchant endpoints

Enable on **both** sides:

```ts
// server
bachs({ merchant: true, bachsClient, ... })

// client
bachsClient({ merchant: true })
```

Only enable this for apps that operate the Bachs merchant account (admin dashboards, internal tools). Do not expose merchant routes to end users in a multi-tenant SaaS without your own authorization layer.

### Products

#### `POST /bachs/create-product`

Create a Bachs catalog product (fixed, free, or custom / pay-what-you-want). Add `billingInterval` for recurring.

```ts
// Fixed one-time
await authClient.bachs.createProduct({
  name: "Field Guide",
  currency: "USD",
  amount: "19.00",
});

// Recurring plan product
await authClient.bachs.createProduct({
  name: "Pro monthly",
  currency: "USD",
  amount: "29.00",
  billingInterval: "month",
  billingFrequency: 1,
});

// Pay what you want
await authClient.bachs.createProduct({
  name: "Tip jar",
  currency: "USD",
  priceType: "custom",
  minimumAmount: "5.00",
  presetAmount: "10.00",
});
```

Copy the returned `id` (`prod_…`) into `subscription.plans` / `products.products` in your auth config (or store it in your own admin DB).

> Product **update/archive** are not in `@bachs/sdk` yet — use the Bachs dashboard or REST API.

### Account payments (merchant)

#### `GET /bachs/list-remote-payments`

Account-wide payment list from Bachs (not scoped to one customer).

```ts
await authClient.bachs.listRemotePayments({
  limit: 50,
  statusFilter: "succeeded",
});
```

### Balance & banks

```ts
await authClient.bachs.getBalance();

await authClient.bachs.listBanks({ country: "NG" });

await authClient.bachs.resolveBankAccount({
  accountNumber: "0123456789",
  bankCode: "058",
  country: "NG",
});
```

### Payouts

```ts
const { data: dest } = await authClient.bachs.createPayoutDestination({
  currency: "NGN",
  accountNumber: "0123456789",
  bankCode: "058",
  accountName: "Acme Ltd",
});

await authClient.bachs.listPayoutDestinations();
await authClient.bachs.getPayoutDestination({ destinationId: "..." });

const { data: quote } = await authClient.bachs.createPayoutQuote({
  fromCurrency: "USD",
  toCurrency: "NGN",
  amount: "100.00",
});

await authClient.bachs.createPayout({
  destination: dest.id,
  quoteId: quote.quoteId, // or amount: "100.00"
});

await authClient.bachs.listPayouts();
await authClient.bachs.getPayout({ payoutId: "..." });
```

---

## Full endpoint list

### Always available (session required except webhook)

| Method | Path | Client |
| --- | --- | --- |
| `POST` | `/bachs/create-checkout` | `createCheckout` |
| `POST` | `/bachs/upgrade-subscription` | `upgradeSubscription` |
| `GET` | `/bachs/get-checkout` | `getCheckout` |
| `GET` | `/bachs/list-checkouts` | `listCheckouts` |
| `POST` | `/bachs/create-portal-session` | `createPortalSession` |
| `GET` | `/bachs/list-plans` | `listPlans` |
| `GET` | `/bachs/list-products` | `listProducts` |
| `GET` | `/bachs/list-catalog-products` | `listCatalogProducts` |
| `GET` | `/bachs/get-catalog-product` | `getCatalogProduct` |
| `GET` | `/bachs/get-customer` | `getCustomer` |
| `GET` | `/bachs/list-subscriptions` | `listSubscriptions` |
| `GET` | `/bachs/list-remote-subscriptions` | `listRemoteSubscriptions` |
| `GET` | `/bachs/get-subscription` | `getSubscription` |
| `POST` | `/bachs/cancel-subscription` | `cancelSubscription` |
| `GET` | `/bachs/list-payments` | `listPayments` |
| `GET` | `/bachs/get-payment` | `getPayment` |
| `GET` | `/bachs/billing-status` | `billingStatus` |
| `GET` | `/bachs/config` | `config` |
| `POST` | `/bachs/webhook` | *(Bachs → your server)* |

### Merchant (`merchant: true`)

| Method | Path | Client |
| --- | --- | --- |
| `POST` | `/bachs/create-product` | `createProduct` |
| `GET` | `/bachs/list-remote-payments` | `listRemotePayments` |
| `GET` | `/bachs/get-balance` | `getBalance` |
| `GET` | `/bachs/list-banks` | `listBanks` |
| `POST` | `/bachs/resolve-bank-account` | `resolveBankAccount` |
| `GET` | `/bachs/list-payout-destinations` | `listPayoutDestinations` |
| `GET` | `/bachs/get-payout-destination` | `getPayoutDestination` |
| `POST` | `/bachs/create-payout-destination` | `createPayoutDestination` |
| `POST` | `/bachs/create-payout-quote` | `createPayoutQuote` |
| `POST` | `/bachs/create-payout` | `createPayout` |
| `GET` | `/bachs/list-payouts` | `listPayouts` |
| `GET` | `/bachs/get-payout` | `getPayout` |

---

## Options

| Option | Description |
| --- | --- |
| `bachsClient` | Injected `Bachs` from `@bachs/sdk` (**recommended**) |
| `apiKey` | Used when `bachsClient` is omitted |
| `clientOptions` | Extra `new Bachs(...)` options when using `apiKey` |
| `webhookSecret` | Dashboard signing secret for `/bachs/webhook` |
| `successUrl` / `cancelUrl` | Default checkout return URLs |
| `subscription.plans` | `{ name, productId, group?, description? }[]` |
| `subscription.authorizeReference` | Custom auth for billing references |
| `products.products` | `{ name, productId, description? }[]` |
| `organization.enabled` | Enable org billing |
| `organization.billingRoles` | Default `["owner","admin"]` |
| `merchant` | Enable merchant endpoints (default `false`) |
| `createCustomerOnCheckout` | Persist `bachsCustomer` from webhooks (default `true`) |
| `onEvent` | After a verified, non-duplicate webhook |
| `schema` | Schema overrides for Better Auth migrations |

---

## Design notes

- Clients send **plan** / **product** names; catalog ids stay on the server.
- Never trust client-supplied money amounts for checkout — Bachs owns catalog prices.
- Fulfil from **verified webhooks**, not from the success redirect alone.
- Uncertain SDK writes return a conflict so you can reconcile before retrying with a new idempotency key.
- SDK coverage today: create/get/list products, checkout, subscriptions cancel/list/get, payments get/list, portal, balance, banks, payouts. Product update/archive are not in the Node SDK yet.

Docs: [Bachs Node SDK](https://docs.bachs.io/sdks/node) · [Checkout](https://docs.bachs.io/guides/checkout/checkout-sessions) · [Products](https://docs.bachs.io/guides/products/overview) · [Webhooks](https://docs.bachs.io/guides/webhooks/overview)

## License

MIT © Greatness Abolade
