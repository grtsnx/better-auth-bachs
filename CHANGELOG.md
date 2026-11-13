# Changelog

## Unreleased

- Require `authorizeMerchant` for merchant endpoints and protect live catalog reads with it
- Allow checkout only for configured products; restrict client redirect overrides to the configured application origin
- Require scoped idempotency keys for resource writes and require local ownership before remote billing reads
- Claim webhook events with expiring leases and transact local state updates; store only event IDs and types
- Add customer/reference uniqueness and billing lookup indexes
- Upgrade Vitest to a patched version and update vulnerable transitive development dependencies

## 0.5.1

- Republish after staged 0.5.0 reservation

## 0.5.0

- Add get catalog product, get customer, list checkouts, list remote subscriptions
- Merchant: get payout destination, list remote payments
- Stronger createProduct (fixed amount required, custom min/preset/max)
- Cancel subscription accepts `reason`
- Full README: setup walkthrough + usage for every endpoint

## 0.4.0


- Organization billing via `referenceId` / `referenceType`
- Local `bachsPayment` table + list/get payment endpoints
- Upgrade subscription checkout path
- Live catalog product listing
- Opt-in merchant endpoints (balance, banks, products, payouts)
- Stronger webhook handling for payments and billing references

## 0.3.0

- Production Better Auth billing plugin for Bachs
- Inject official `@bachs/sdk` client
- Plan + product catalog config, subscription groups
- Persist `bachsCustomer`, `bachsCheckout`, `bachsSubscription`, `bachsWebhookEvent`
- Typed client actions and webhook deduplication
