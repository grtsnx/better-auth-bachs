# Changelog

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
