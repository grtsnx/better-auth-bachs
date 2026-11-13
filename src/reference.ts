import { APIError } from "better-auth/api";
import type { GenericEndpointContext } from "better-auth";
import type {
  BillingReferenceType,
  ResolvedBachsOptions,
} from "./types.js";

export async function authorizeBillingReference(
  ctx: GenericEndpointContext,
  options: ResolvedBachsOptions,
  args: {
    referenceId: string;
    referenceType: BillingReferenceType;
    userId: string;
  },
): Promise<void> {
  if (options.subscription?.authorizeReference) {
    const ok = await options.subscription.authorizeReference(ctx, args);
    if (!ok) {
      throw new APIError("FORBIDDEN", {
        code: "REFERENCE_FORBIDDEN",
        message: "Not allowed to manage billing for this reference.",
      });
    }
    return;
  }

  if (args.referenceType === "user") {
    if (args.referenceId !== args.userId) {
      throw new APIError("FORBIDDEN", {
        code: "REFERENCE_FORBIDDEN",
        message: "Not allowed to manage billing for this user.",
      });
    }
    return;
  }

  if (!options.organization?.enabled) {
    throw new APIError("BAD_REQUEST", {
      code: "ORG_BILLING_DISABLED",
      message: "Organization billing is not enabled on the Bachs plugin.",
    });
  }

  if (!ctx.context.hasPlugin("organization")) {
    throw new APIError("BAD_REQUEST", {
      code: "ORGANIZATION_PLUGIN_REQUIRED",
      message: "Enable the Better Auth organization plugin for org billing.",
    });
  }

  const member = await ctx.context.adapter.findOne({
    model: "member",
    where: [
      { field: "organizationId", value: args.referenceId },
      { field: "userId", value: args.userId },
    ],
  });

  if (!member) {
    throw new APIError("FORBIDDEN", {
      code: "NOT_ORG_MEMBER",
      message: "You are not a member of this organization.",
    });
  }

  const roles = options.organization.billingRoles ?? ["owner", "admin"];
  const role = (member as { role?: string }).role ?? "";
  const memberRoles = role.split(",").map((r) => r.trim());
  if (!memberRoles.some((r) => roles.includes(r))) {
    throw new APIError("FORBIDDEN", {
      code: "ORG_BILLING_ROLE",
      message: "Your organization role cannot manage billing.",
    });
  }
}

export async function resolveCheckoutCustomer(
  ctx: GenericEndpointContext,
  options: ResolvedBachsOptions,
  args: {
    referenceId: string;
    referenceType: BillingReferenceType;
    email: string;
    name: string;
  },
) {
  const existingCustomer = await ctx.context.adapter.findOne({
    model: "bachsCustomer",
    where: [
      { field: "referenceId", value: args.referenceId },
      { field: "referenceType", value: args.referenceType },
    ],
  });

  if (
    existingCustomer &&
    typeof (existingCustomer as { customerId?: string }).customerId === "string"
  ) {
    return {
      customer_id: (existingCustomer as { customerId: string }).customerId,
    } as const;
  }

  if (args.referenceType === "organization") {
    const org = await ctx.context.adapter.findOne({
      model: "organization",
      where: [{ field: "id", value: args.referenceId }],
    });
    const orgEmail =
      (org as { email?: string | null } | null)?.email ?? args.email;
    const orgName =
      (org as { name?: string | null } | null)?.name ?? args.name;
    return {
      email: orgEmail,
      name: orgName?.trim() || orgEmail,
    } as const;
  }

  return {
    email: args.email,
    name: args.name.trim() || args.email,
  } as const;
}
