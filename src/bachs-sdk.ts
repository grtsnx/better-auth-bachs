import {
  Bachs,
  BachsApiError,
  BachsNetworkError,
  BachsResponseError,
} from "@bachs/sdk";
import { APIError } from "better-auth/api";
import { BACHS_ERROR_CODES } from "./errors.js";
import type { BachsClient, BachsPluginOptions, ResolvedBachsOptions } from "./types.js";

export function createBachsClient(options: BachsPluginOptions): BachsClient {
  if (options.bachsClient) return options.bachsClient;
  if (!options.apiKey) {
    throw new Error(
      "better-auth-bachs: pass `bachsClient` (from @bachs/sdk) or `apiKey`.",
    );
  }
  return new Bachs({
    apiKey: options.apiKey,
    ...options.clientOptions,
  });
}

export function resolveOptions(options: BachsPluginOptions): ResolvedBachsOptions {
  return {
    ...options,
    bachsClient: createBachsClient(options),
    createCustomerOnCheckout: options.createCustomerOnCheckout !== false,
    merchant: options.merchant === true,
  };
}

export function isUncertainWrite(err: unknown): boolean {
  return (
    (err instanceof BachsApiError ||
      err instanceof BachsNetworkError ||
      err instanceof BachsResponseError) &&
    err.outcomeUnknown === true
  );
}

export function throwIfUncertain(err: unknown): never {
  if (isUncertainWrite(err)) {
    throw new APIError("CONFLICT", BACHS_ERROR_CODES.UNCERTAIN_WRITE);
  }
  throw err;
}

export { Bachs };
