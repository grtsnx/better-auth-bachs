import { describe, expect, it } from "vitest";
import {
  assertMerchantAccess,
  claimWebhookEvent,
  getPublicProducts,
  getPublicPlans,
  resolveCheckoutProduct,
  resolveTrustedRedirectUrl,
  requireLocalBillingResource,
  scopedIdempotencyKey,
} from "../src/security.js";
import { BACHS_ERROR_CODES } from "../src/errors.js";
import type { ResolvedBachsOptions } from "../src/types.js";

const options = {
  merchant: true,
  subscription: {
    enabled: true,
    plans: [
      { name: "pro", productId: "prod_pro", description: "Pro", group: "workspace" },
    ],
  },
  products: {
    products: [{ name: "credits", productId: "prod_credits", description: "Credits" }],
  },
} as ResolvedBachsOptions;

describe("billing security helpers", () => {
  it("only resolves configured checkout product IDs", () => {
    expect(() => resolveCheckoutProduct(options, { productId: "prod_hidden" })).toThrow();
    expect(resolveCheckoutProduct(options, { productId: "prod_pro" })).toEqual({
      productId: "prod_pro",
      planName: "pro",
      groupId: "workspace",
    });
  });

  it("rejects checkout redirect URLs outside the configured app origin", () => {
    expect(
      resolveTrustedRedirectUrl(
        "https://app.example.com/success?ref=1",
        "https://app.example.com/billing/success",
        "https://app.example.com/billing/success",
      ),
    ).toBe("https://app.example.com/success?ref=1");
    expect(() =>
      resolveTrustedRedirectUrl(
        "https://phishing.example/success",
        "https://app.example.com/billing/success",
        "https://app.example.com/billing/success",
      ),
    ).toThrow("trusted application origin");
    expect(() =>
      resolveTrustedRedirectUrl(
        "javascript:alert(1)",
        "https://app.example.com/billing/success",
        "https://app.example.com/billing/success",
      ),
    ).toThrow("HTTP or HTTPS");
  });

  it("does not expose catalog IDs in public product configuration", () => {
    expect(getPublicPlans(options)).toEqual([
      { name: "pro", description: "Pro", group: "workspace" },
    ]);
    expect(getPublicProducts(options)).toEqual([
      { name: "credits", description: "Credits" },
    ]);
  });

  it("denies merchant access unless the app authorizes the user", async () => {
    await expect(
      assertMerchantAccess(options, {} as never, "user_1"),
    ).rejects.toThrow();

    const authorizeMerchant = async (_ctx: unknown, userId: string) => userId === "admin";
    const authorized = { ...options, authorizeMerchant } as ResolvedBachsOptions;
    await expect(assertMerchantAccess(authorized, {} as never, "member")).rejects.toThrow();
    await expect(assertMerchantAccess(authorized, {} as never, "admin")).resolves.toBeUndefined();
  });

  it("scopes idempotency keys to the operation and authenticated actor", () => {
    const key = scopedIdempotencyKey("payout", "user_1", "retry-1");
    expect(key).toBe(scopedIdempotencyKey("payout", "user_1", "retry-1"));
    expect(key).not.toBe(scopedIdempotencyKey("payout", "user_2", "retry-1"));
    expect(key).not.toBe(scopedIdempotencyKey("checkout", "user_1", "retry-1"));
  });

  it("requires a locally owned billing row before remote resource reads", () => {
    expect(() =>
      requireLocalBillingResource(null, BACHS_ERROR_CODES.CHECKOUT_NOT_FOUND),
    ).toThrow("Checkout not found.");
    expect(
      requireLocalBillingResource({ checkoutId: "checkout_1" }, BACHS_ERROR_CODES.CHECKOUT_NOT_FOUND),
    ).toEqual({ checkoutId: "checkout_1" });
  });

  it("claims a webhook event for only one concurrent worker", async () => {
    const row: Record<string, unknown> = {
      eventId: "evt_1",
      status: "received",
      leaseExpiresAt: null,
    };
    const adapter = {
      async update({ where, update }: { where: Array<{ field: string; operator?: string; value: unknown }>; update: Record<string, unknown> }) {
        const matches = where.every(({ field, operator, value }) => {
          const current = row[field];
          if (operator === "lt") return current instanceof Date && current < (value as Date);
          return current === value;
        });
        if (!matches) return null;
        Object.assign(row, update);
        return { ...row };
      },
    };

    const results = await Promise.all([
      claimWebhookEvent(adapter as never, "evt_1", new Date("2026-11-13T00:00:00Z")),
      claimWebhookEvent(adapter as never, "evt_1", new Date("2026-11-13T00:00:00Z")),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(row.status).toBe("processing");
  });
});
