import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { authedQuery } from "./lib/auth";
import type { MeResult, UserRef } from "./lib/types";

export function displayName(user: { name?: string; email?: string }): string {
  return user.name ?? user.email ?? "Unknown";
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Upserts the caller's users row from the Clerk identity. Called once per sign-in by the web app. */
export const ensure = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "unauthenticated" });
    const now = Date.now();
    const fields = {
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email,
      name: identity.name ?? identity.email ?? "Unknown",
      imageUrl: identity.pictureUrl,
      lastSeenAt: now,
    };
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("users", { clerkId: identity.subject, createdAt: now, ...fields });
  },
});

export const me = authedQuery({
  args: {},
  handler: async (ctx): Promise<MeResult> => {
    const user = ctx.user;
    return {
      _id: user._id,
      clerkId: user.clerkId,
      email: user.email ?? null,
      name: displayName(user),
      imageUrl: user.imageUrl ?? null,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
    };
  },
});

export const list = authedQuery({
  args: {},
  handler: async (ctx): Promise<UserRef[]> => {
    const users = await ctx.db.query("users").collect();
    return users
      .map((user) => ({
        userId: user._id,
        name: displayName(user),
        imageUrl: user.imageUrl ?? null,
      }))
      .sort(byName);
  },
});
