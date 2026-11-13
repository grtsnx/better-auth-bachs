import { describe, expect, it } from "vitest";
import { Bachs } from "@bachs/sdk";
import { bachs, BACHS_ERROR_CODES, PACKAGE_VERSION } from "../src/index.js";
import { bachsClient } from "../src/client.js";

describe("better-auth-bachs", () => {
  it("exposes plugin id, version, and schema tables", () => {
    const plugin = bachs({
      apiKey: "sk_sandbox_test_key_for_plugin_unit_tests_only",
      subscription: {
        enabled: true,
        plans: [{ name: "pro", productId: "prod_pro", group: "workspace" }],
      },
      products: {
        products: [{ name: "credits", productId: "prod_credits" }],
      },
      organization: { enabled: true },
    });

    expect(plugin.id).toBe("bachs");
    expect(plugin.version).toBe(PACKAGE_VERSION);
    expect(plugin.schema?.bachsCustomer).toBeTruthy();
    expect(plugin.schema?.bachsSubscription).toBeTruthy();
    expect(plugin.schema?.bachsCheckout).toBeTruthy();
    expect(plugin.schema?.bachsPayment).toBeTruthy();
    expect(plugin.schema?.bachsWebhookEvent).toBeTruthy();
    expect(plugin.endpoints?.createCheckout).toBeTypeOf("function");
    expect(plugin.endpoints?.upgradeSubscription).toBeTypeOf("function");
    expect(plugin.endpoints?.listPayments).toBeTypeOf("function");
    expect(plugin.endpoints?.bachsWebhook).toBeTypeOf("function");
    expect(plugin.endpoints?.getBalance).toBeUndefined();
    expect(BACHS_ERROR_CODES.PLAN_NOT_FOUND.code).toBe("PLAN_NOT_FOUND");
  });

  it("registers merchant endpoints when merchant is enabled", () => {
    const plugin = bachs({
      apiKey: "sk_sandbox_test_key_for_plugin_unit_tests_only",
      merchant: true,
    });
    expect(plugin.endpoints?.getBalance).toBeTypeOf("function");
    expect(plugin.endpoints?.createPayout).toBeTypeOf("function");
    expect(plugin.options.merchant).toBe(true);
  });

  it("accepts an injected @bachs/sdk client", () => {
    const bachsClientInstance = new Bachs({
      apiKey: "sk_sandbox_test_key_for_plugin_unit_tests_only",
    });
    const plugin = bachs({ bachsClient: bachsClientInstance });
    expect(plugin.options.bachsClient).toBe(bachsClientInstance);
  });

  it("creates a matching client plugin", () => {
    const client = bachsClient({ subscription: true, merchant: true });
    expect(client.id).toBe("bachs");
    expect(client.getActions).toBeTypeOf("function");
  });
});
