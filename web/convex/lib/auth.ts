import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import type { Doc } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";

export type AuthedContext = { identity: UserIdentity; user: Doc<"users"> };

/** Clerk identity → users row. `users.ensure` must have run once for this identity. */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<AuthedContext> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "unauthenticated" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (!user) throw new ConvexError({ code: "user_not_registered" });
  return { identity, user };
}

export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => requireUser(ctx)),
);

export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => requireUser(ctx)),
);
