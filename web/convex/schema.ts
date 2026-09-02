import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  dailyRollupFields,
  rateLimitValidator,
  sessionSummaryFields,
  tokenEventFields,
} from "./lib/validators";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(), // identity.subject
    tokenIdentifier: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_clerkId", ["clerkId"]),

  syncTokens: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(), // sha256 hex of the raw token; the raw token is never stored
    prefix: v.string(), // e.g. "ck_3f9a1c"
    name: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_user", ["userId"]),

  machines: defineTable({
    machineId: v.string(),
    userId: v.id("users"),
    label: v.string(),
    hostname: v.optional(v.string()),
    platform: v.string(),
    arch: v.optional(v.string()),
    nodeVersion: v.optional(v.string()),
    cliVersion: v.string(),
    codexVersion: v.optional(v.string()),
    codexLatestVersion: v.optional(v.string()),
    tz: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSyncAt: v.number(),
    lastRateLimit: v.optional(rateLimitValidator),
  })
    .index("by_machineId", ["machineId"])
    .index("by_user", ["userId"]),

  sessions: defineTable({
    userId: v.id("users"),
    machineId: v.string(),
    ...sessionSummaryFields,
    syncedAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_user_day", ["userId", "day"])
    .index("by_user_startedAt", ["userId", "startedAt"])
    .index("by_startedAt", ["startedAt"]),

  tokenEvents: defineTable({
    userId: v.id("users"),
    ...tokenEventFields,
  })
    .index("by_session_seq", ["sessionId", "seq"])
    .index("by_user_day", ["userId", "day"]),

  dailyRollups: defineTable(dailyRollupFields)
    .index("by_user_day", ["userId", "day"])
    .index("by_day", ["day"]),

  modelPrices: defineTable({
    model: v.string(),
    inputUsdPerMTok: v.number(),
    cachedInputUsdPerMTok: v.number(),
    outputUsdPerMTok: v.number(),
    source: v.string(), // "seed" | "manual"
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }).index("by_model", ["model"]),
});
