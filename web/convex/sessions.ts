import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { v } from "convex/values";
import { ratio } from "../../shared/src/metrics";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { authedQuery } from "./lib/auth";
import { loadPriceMap, priceTokens, type PriceMap } from "./lib/cost";
import type { SessionRow } from "./lib/types";
import { displayName } from "./users";

type Caches = {
  prices: PriceMap;
  userNames: Map<Id<"users">, string>;
  machineLabels: Map<string, string>;
};

async function makeCaches(ctx: QueryCtx): Promise<Caches> {
  return { prices: await loadPriceMap(ctx), userNames: new Map(), machineLabels: new Map() };
}

async function userName(ctx: QueryCtx, caches: Caches, userId: Id<"users">): Promise<string> {
  const cached = caches.userNames.get(userId);
  if (cached !== undefined) return cached;
  const user = await ctx.db.get(userId);
  const name = user ? displayName(user) : "Unknown";
  caches.userNames.set(userId, name);
  return name;
}

async function machineLabel(ctx: QueryCtx, caches: Caches, machineId: string): Promise<string> {
  const cached = caches.machineLabels.get(machineId);
  if (cached !== undefined) return cached;
  const machine = await ctx.db
    .query("machines")
    .withIndex("by_machineId", (q) => q.eq("machineId", machineId))
    .unique();
  const label = machine?.label ?? machineId;
  caches.machineLabels.set(machineId, label);
  return label;
}

export async function toSessionRow(
  ctx: QueryCtx,
  doc: Doc<"sessions">,
  caches: Caches,
): Promise<SessionRow> {
  return {
    _id: doc._id,
    sessionId: doc.sessionId,
    userId: doc.userId,
    userName: await userName(ctx, caches, doc.userId),
    machineId: doc.machineId,
    machineLabel: await machineLabel(ctx, caches, doc.machineId),
    startedAt: doc.startedAt,
    endedAt: doc.endedAt,
    day: doc.day,
    project: doc.project,
    gitBranch: doc.gitBranch ?? null,
    model: doc.model,
    effort: doc.effort ?? null,
    source: doc.source,
    isSubagent: doc.isSubagent,
    turns: doc.turns,
    userMessages: doc.userMessages,
    agentMessages: doc.agentMessages,
    tokens: doc.tokens,
    cacheHitRate: ratio(doc.tokens.cachedInput, doc.tokens.input),
    costUsd: priceTokens(doc.model, doc.tokens, caches.prices)?.total ?? null,
    activeMs: doc.activeMs,
    linesAdded: doc.linesAdded,
    linesRemoved: doc.linesRemoved,
    toolCounts: doc.toolCounts,
    inProgress: doc.inProgress,
  };
}

export const listRecent = authedQuery({
  args: { userId: v.optional(v.id("users")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<SessionRow>> => {
    const userId = args.userId;
    const result =
      userId !== undefined
        ? await ctx.db
            .query("sessions")
            .withIndex("by_user_startedAt", (q) => q.eq("userId", userId))
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("sessions")
            .withIndex("by_startedAt")
            .order("desc")
            .paginate(args.paginationOpts);
    const caches = await makeCaches(ctx);
    const page: SessionRow[] = [];
    for (const doc of result.page) page.push(await toSessionRow(ctx, doc, caches));
    return { ...result, page };
  },
});

export const get = authedQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<SessionRow | null> => {
    const doc = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!doc) return null;
    return await toSessionRow(ctx, doc, await makeCaches(ctx));
  },
});
