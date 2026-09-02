import { v, type Infer } from "convex/values";
import {
  MAX_DAYS_PER_EVENT_CHUNK,
  MAX_EVENTS_PER_MUTATION,
  MAX_SESSIONS_PER_MUTATION,
} from "../../shared/src/constants";
import type { SessionSummary, TokenEvent, UpsertCounts } from "../../shared/src/sync";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import {
  machineInfoValidator,
  rateLimitSnapshotValidator,
  sessionSummaryFields,
  tokenEventFields,
} from "./lib/validators";
import { recomputeDays } from "./rollups";
import { touchToken } from "./syncTokens";

// ---------- pure helpers ----------

export function zeroCounts(): UpsertCounts {
  return { inserted: 0, updated: 0, unchanged: 0 };
}

export function addCounts(target: UpsertCounts, delta: UpsertCounts): void {
  target.inserted += delta.inserted;
  target.updated += delta.updated;
  target.unchanged += delta.unchanged;
}

/**
 * Splits day-tagged rows into mutation-sized chunks: at most `maxItems` rows and at most
 * MAX_DAYS_PER_EVENT_CHUNK distinct `day` values per chunk (every touched day costs one
 * `recomputeDay` in the same mutation). Order is preserved.
 */
export function chunkByDays<T extends { day: string }>(items: T[], maxItems: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let days = new Set<string>();
  for (const item of items) {
    const addsDay = !days.has(item.day);
    if (current.length >= maxItems || (addsDay && days.size >= MAX_DAYS_PER_EVENT_CHUNK)) {
      chunks.push(current);
      current = [];
      days = new Set<string>();
    }
    current.push(item);
    days.add(item.day);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** One `upsertEvents` mutation: ≤ 1,000 events over ≤ 30 days. */
export function chunkEvents(events: TokenEvent[]): TokenEvent[][] {
  return chunkByDays(events, MAX_EVENTS_PER_MUTATION);
}

/** One `upsertSessions` mutation: ≤ 200 sessions over ≤ 30 days. */
export function chunkSessions(sessions: SessionSummary[]): SessionSummary[][] {
  return chunkByDays(sessions, MAX_SESSIONS_PER_MUTATION);
}

const EVENT_KEYS = [
  "sessionId", "seq", "ts", "day", "hour", "model", "effort", "turnId", "project", "isSubagent",
  "input", "cachedInput", "cacheWrite", "output", "reasoning", "total", "contextWindow",
] as const;

/** Field-by-field equality of the payload fields (a stored document may carry extra fields). */
export function eventsEqual(a: TokenEvent, b: TokenEvent): boolean {
  return EVENT_KEYS.every((key) => a[key] === b[key]);
}

type MachineInfoArg = Infer<typeof machineInfoValidator>;

function machineFields(machine: MachineInfoArg, cliVersion: string, now: number) {
  return {
    hostname: machine.hostname ?? undefined, // null (opt-out) clears the stored field
    platform: machine.platform,
    arch: machine.arch,
    nodeVersion: machine.nodeVersion,
    cliVersion,
    codexVersion: machine.codexVersion,
    codexLatestVersion: machine.codexLatestVersion,
    tz: machine.tz,
    lastSyncAt: now,
  };
}

// ---------- internal mutations ----------

export const upsertMachine = internalMutation({
  args: {
    userId: v.id("users"),
    machine: machineInfoValidator,
    cliVersion: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { userId, machine, cliVersion, now }): Promise<{ conflict: boolean; created: boolean }> => {
    const existing = await ctx.db
      .query("machines")
      .withIndex("by_machineId", (q) => q.eq("machineId", machine.machineId))
      .unique();
    if (existing && existing.userId !== userId) return { conflict: true, created: false };
    const fields = machineFields(machine, cliVersion, now);
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { conflict: false, created: false };
    }
    await ctx.db.insert("machines", {
      machineId: machine.machineId,
      userId,
      label: machine.label,
      firstSeenAt: now,
      ...fields,
    });
    return { conflict: false, created: true };
  },
});

export const upsertSessions = internalMutation({
  args: {
    userId: v.id("users"),
    machineId: v.string(),
    sessions: v.array(v.object(sessionSummaryFields)),
    now: v.number(),
  },
  handler: async (ctx, { userId, machineId, sessions, now }): Promise<{ counts: UpsertCounts; conflicts: string[] }> => {
    const counts = zeroCounts();
    const conflicts: string[] = [];
    const touched = new Set<string>();
    for (const session of sessions) {
      const existing = await ctx.db
        .query("sessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session.sessionId))
        .unique();
      if (!existing) {
        await ctx.db.insert("sessions", { ...session, userId, machineId, syncedAt: now });
        counts.inserted += 1;
        touched.add(session.day);
        continue;
      }
      if (existing.userId !== userId) {
        conflicts.push(session.sessionId);
        continue;
      }
      if (existing.summaryHash === session.summaryHash) {
        counts.unchanged += 1;
        if (
          existing.inProgress !== session.inProgress ||
          existing.lineCount !== session.lineCount ||
          existing.generation !== session.generation
        ) {
          await ctx.db.patch(existing._id, {
            inProgress: session.inProgress,
            lineCount: session.lineCount,
            generation: session.generation,
            syncedAt: now,
          });
        }
        continue;
      }
      await ctx.db.replace(existing._id, { ...session, userId, machineId, syncedAt: now });
      counts.updated += 1;
      touched.add(existing.day);
      touched.add(session.day);
    }
    await recomputeDays(ctx, userId, touched, now);
    return { counts, conflicts };
  },
});

export const upsertEvents = internalMutation({
  args: {
    userId: v.id("users"),
    events: v.array(v.object(tokenEventFields)),
    now: v.number(),
  },
  handler: async (ctx, { userId, events, now }): Promise<{ counts: UpsertCounts; conflicts: number }> => {
    const counts = zeroCounts();
    let conflicts = 0;
    const touched = new Set<string>();
    for (const event of events) {
      const existing = await ctx.db
        .query("tokenEvents")
        .withIndex("by_session_seq", (q) => q.eq("sessionId", event.sessionId).eq("seq", event.seq))
        .unique();
      if (!existing) {
        await ctx.db.insert("tokenEvents", { ...event, userId });
        counts.inserted += 1;
        touched.add(event.day);
        continue;
      }
      if (existing.userId !== userId) {
        conflicts += 1;
        continue;
      }
      if (eventsEqual(existing, event)) {
        counts.unchanged += 1;
        continue;
      }
      await ctx.db.replace(existing._id, { ...event, userId });
      counts.updated += 1;
      touched.add(existing.day);
      touched.add(event.day);
    }
    await recomputeDays(ctx, userId, touched, now);
    return { counts, conflicts };
  },
});

export const finishSync = internalMutation({
  args: {
    userId: v.id("users"),
    machineId: v.string(),
    tokenId: v.id("syncTokens"),
    rateLimit: v.optional(rateLimitSnapshotValidator),
    now: v.number(),
  },
  handler: async (ctx, { userId, machineId, tokenId, rateLimit, now }): Promise<{ rateLimitStored: boolean; tokenTouched: boolean }> => {
    let rateLimitStored = false;
    const machine = await ctx.db
      .query("machines")
      .withIndex("by_machineId", (q) => q.eq("machineId", machineId))
      .unique();
    if (machine && machine.userId === userId) {
      const patch: { lastSyncAt: number; lastRateLimit?: Doc<"machines">["lastRateLimit"] } = {
        lastSyncAt: now,
      };
      if (
        rateLimit !== undefined &&
        (machine.lastRateLimit === undefined || rateLimit.observedAt > machine.lastRateLimit.observedAt)
      ) {
        patch.lastRateLimit = { ...rateLimit, receivedAt: now };
        rateLimitStored = true;
      }
      await ctx.db.patch(machine._id, patch);
    }
    const tokenTouched = await touchToken(ctx, tokenId, now);
    return { rateLimitStored, tokenTouched };
  },
});
