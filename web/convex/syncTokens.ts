import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/auth";
import { TOKEN_LAST_USED_THROTTLE_MS } from "./lib/constants";
import { generateRawToken, sha256Hex, tokenPrefix } from "./lib/hash";
import type { SyncTokenRow } from "./lib/types";
import { displayName } from "./users";

export type TokenLookup = {
  tokenId: Id<"syncTokens">;
  userId: Id<"users">;
  name: string;
  prefix: string;
  revokedAt: number | null;
  lastUsedAt: number | null;
  user: { name: string; email: string | null };
};

/** Token row (never the hash) plus its owner, or null when unknown. Revoked tokens are returned. */
export async function findTokenByHash(
  ctx: QueryCtx,
  tokenHash: string,
): Promise<TokenLookup | null> {
  const token = await ctx.db
    .query("syncTokens")
    .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!token) return null;
  const user = await ctx.db.get(token.userId);
  if (!user) return null;
  return {
    tokenId: token._id,
    userId: token.userId,
    name: token.name,
    prefix: token.prefix,
    revokedAt: token.revokedAt ?? null,
    lastUsedAt: token.lastUsedAt ?? null,
    user: { name: displayName(user), email: user.email ?? null },
  };
}

/** Writes `lastUsedAt` at most once per TOKEN_LAST_USED_THROTTLE_MS; returns whether it wrote. */
export async function touchToken(
  ctx: MutationCtx,
  tokenId: Id<"syncTokens">,
  now: number,
): Promise<boolean> {
  const token = await ctx.db.get(tokenId);
  if (!token) return false;
  if (token.lastUsedAt !== undefined && now - token.lastUsedAt < TOKEN_LAST_USED_THROTTLE_MS) {
    return false;
  }
  await ctx.db.patch(tokenId, { lastUsedAt: now });
  return true;
}

export const lookupByHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }): Promise<TokenLookup | null> =>
    findTokenByHash(ctx, tokenHash),
});

export const touchLastUsed = internalMutation({
  args: { tokenId: v.id("syncTokens"), now: v.number() },
  handler: async (ctx, { tokenId, now }): Promise<boolean> => touchToken(ctx, tokenId, now),
});

export const insert = internalMutation({
  args: { clerkId: v.string(), tokenHash: v.string(), prefix: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<Id<"syncTokens">> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (!user) throw new ConvexError({ code: "user_not_registered" });
    return await ctx.db.insert("syncTokens", {
      userId: user._id,
      tokenHash: args.tokenHash,
      prefix: args.prefix,
      name: args.name,
      createdAt: Date.now(),
    });
  },
});

function toRow(row: Doc<"syncTokens">): SyncTokenRow {
  return {
    _id: row._id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

export const list = authedQuery({
  args: {},
  handler: async (ctx): Promise<SyncTokenRow[]> => {
    const rows = await ctx.db
      .query("syncTokens")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .order("desc")
      .collect();
    return rows.map(toRow);
  },
});

/** Generates a token in the action runtime (Web Crypto) and stores only its sha256. */
export const create = action({
  args: { name: v.string() },
  handler: async (
    ctx,
    { name },
  ): Promise<{ id: Id<"syncTokens">; token: string; prefix: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "unauthenticated" });
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 64) throw new ConvexError({ code: "bad_name" });
    const token = generateRawToken();
    const prefix = tokenPrefix(token);
    const id = await ctx.runMutation(internal.syncTokens.insert, {
      clerkId: identity.subject,
      tokenHash: await sha256Hex(token),
      prefix,
      name: trimmed,
    });
    return { id, token, prefix };
  },
});

export const revoke = authedMutation({
  args: { tokenId: v.id("syncTokens") },
  handler: async (ctx, { tokenId }): Promise<null> => {
    const token = await ctx.db.get(tokenId);
    if (!token || token.userId !== ctx.user._id) throw new ConvexError({ code: "forbidden" });
    if (token.revokedAt === undefined) await ctx.db.patch(tokenId, { revokedAt: Date.now() });
    return null;
  },
});

/** Pre-registers a teammate by email (pending user) and mints a token for the CLI:
 *   npx convex run syncTokens:mint '{"email":"person@example.com","name":"Person"}'
 * The raw token is printed once by the CLI command output and never stored. */
export const mint = internalAction({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (
    ctx,
    { email, name },
  ): Promise<{ token: string; prefix: string; userId: Id<"users"> }> => {
    const token = generateRawToken();
    const prefix = tokenPrefix(token);
    const result = await ctx.runMutation(internal.syncTokens.insertForEmail, {
      email,
      name,
      tokenHash: await sha256Hex(token),
      prefix,
    });
    return { token, prefix, userId: result.userId };
  },
});

export const insertForEmail = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    tokenHash: v.string(),
    prefix: v.string(),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; tokenId: Id<"syncTokens"> }> => {
    const email = args.email.trim().toLowerCase();
    if (email.length === 0) throw new ConvexError({ code: "bad_email" });
    const now = Date.now();
    const users = await ctx.db.query("users").collect(); // a handful of rows
    const existing = users.find((user) => (user.email ?? "").toLowerCase() === email);
    const userId =
      existing?._id ??
      (await ctx.db.insert("users", {
        clerkId: `pending:${email}`,
        tokenIdentifier: `pending:${email}`,
        email,
        name: args.name ?? email,
        createdAt: now,
        lastSeenAt: now,
      }));
    const tokenId = await ctx.db.insert("syncTokens", {
      userId,
      tokenHash: args.tokenHash,
      prefix: args.prefix,
      name: "cli-bootstrap",
      createdAt: now,
    });
    return { userId, tokenId };
  },
});
