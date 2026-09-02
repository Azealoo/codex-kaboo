import { v, type Infer } from "convex/values";
import {
  MAX_BODY_BYTES,
  MAX_DAYS_PER_EVENT_CHUNK,
  MAX_EVENTS_PER_MUTATION,
  MAX_EVENTS_PER_REQUEST,
  MAX_SESSIONS_PER_MUTATION,
  MAX_SESSIONS_PER_REQUEST,
} from "../../shared/src/constants";
import {
  SyncBatch,
  type ErrorCode,
  type ErrorResponse,
  type SessionSummary,
  type SyncResponse,
  type TokenEvent,
  type UpsertCounts,
  type WhoamiResponse,
} from "../../shared/src/sync";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  httpAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx,
} from "./_generated/server";
import { LIMITS, latestCliVersion } from "./lib/constants";
import { parseBearer, sha256Hex } from "./lib/hash";
import {
  machineInfoValidator,
  rateLimitSnapshotValidator,
  sessionSummaryFields,
  tokenEventFields,
} from "./lib/validators";
import { recomputeDays } from "./rollups";
import { touchToken, type TokenLookup } from "./syncTokens";

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

/** One `upsertEvents` mutation: ≤ 1,000 events over ≤ 10 days (MAX_DAYS_PER_EVENT_CHUNK). */
export function chunkEvents(events: TokenEvent[]): TokenEvent[][] {
  return chunkByDays(events, MAX_EVENTS_PER_MUTATION);
}

/** One `upsertSessions` mutation: ≤ 200 sessions over ≤ 10 days (MAX_DAYS_PER_EVENT_CHUNK). */
export function chunkSessions(sessions: SessionSummary[]): SessionSummary[][] {
  return chunkByDays(sessions, MAX_SESSIONS_PER_MUTATION);
}

// Every payload field, `source` included: a field left out here can never be corrected on a row
// that is already stored, because the re-upload is judged unchanged and skipped — `--full` and a
// deleted `state.json` both included. `machineId` is deliberately absent: the server stamps it, so
// it is not a payload field at all.
const EVENT_KEYS = [
  "sessionId", "seq", "ts", "day", "hour", "model", "effort", "turnId", "project", "source",
  "isSubagent", "origin", "input", "cachedInput", "cacheWrite", "output", "reasoning", "total",
  "contextWindow",
] as const;

/**
 * Field-by-field equality of the payload fields (a stored document may carry extra fields, and
 * widens the enum-like `origin` to `string` the way the Convex validator stores it).
 */
type EventFields = Omit<TokenEvent, "origin"> & { origin: string };
export function eventsEqual(a: EventFields, b: EventFields): boolean {
  return EVENT_KEYS.every((key) => a[key] === b[key]);
}

type MachineInfoArg = Infer<typeof machineInfoValidator>;

function machineFields(machine: MachineInfoArg, cliVersion: string) {
  return {
    hostname: machine.hostname ?? undefined, // null (opt-out) clears the stored field
    platform: machine.platform,
    arch: machine.arch,
    nodeVersion: machine.nodeVersion,
    cliVersion,
    codexVersion: machine.codexVersion,
    codexLatestVersion: machine.codexLatestVersion,
    tz: machine.tz,
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
    const fields = machineFields(machine, cliVersion);
    if (existing) {
      // lastSyncAt is deliberately NOT included in `fields` and not patched here: only `finishSync`
      // (which runs last, and only after the whole batch has committed) advances it, so a request
      // that fails partway through leaves the machine's last-known-good sync time truthful.
      await ctx.db.patch(existing._id, fields);
      return { conflict: false, created: false };
    }
    await ctx.db.insert("machines", {
      machineId: machine.machineId,
      userId,
      label: machine.label,
      firstSeenAt: now,
      lastSyncAt: now, // seed value only (the schema requires one on insert); finishSync owns every
      // update to it from here on — see the comment on the patch branch above.
      ...fields,
    });
    return { conflict: false, created: true };
  },
});

/**
 * Deletes every `count`-derived event of one session and returns the days they were on, so their
 * rollups get recomputed. This is the ingest's ONLY delete path, and it exists because the CLI's
 * `token_count`-vs-`token_usage_record` choice is a whole-file decision re-taken on every parse
 * while uploads are incremental: a parse that ended before the file's first `token_usage_record`
 * has already shipped `count` events keyed on `(sessionId, seq)` that the next parse suppresses
 * locally and could otherwise never retract, double-counting the session's tokens for good.
 *
 * Reads that session's whole `by_session_seq` range. That is bounded in practice because it fires
 * at most once per session — the stored `eventOrigin` latches to `record` in the same mutation —
 * and because `upsertSessions` runs before `upsertEvents`, so a session first seen in this batch
 * usually has no stored events yet.
 */
async function purgeCountEvents(ctx: MutationCtx, sessionId: string): Promise<string[]> {
  const events = await ctx.db
    .query("tokenEvents")
    .withIndex("by_session_seq", (q) => q.eq("sessionId", sessionId))
    .collect();
  const days: string[] = [];
  for (const event of events) {
    if (event.origin !== "count") continue;
    days.push(event.day);
    await ctx.db.delete(event._id);
  }
  return days;
}

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
      if (existing && existing.userId !== userId) {
        conflicts.push(session.sessionId);
        continue;
      }
      // The `count` -> `record` flip lives here rather than in `upsertEvents` because the summary
      // is re-derived in full on every parse and always states the file's CURRENT mechanism, so
      // the trigger is exact and fires at most once per session per flip; in `upsertEvents` it
      // would rescan the session on every chunk. `record` always wins — a single Codex process
      // writes one file and a file's emission pattern cannot change mid-file — so there is no
      // reverse transition. Checked BEFORE the write below, which latches the stored value, and
      // idempotent either way: after the purge there is nothing left to delete, so `--full`, a
      // re-send and a deleted `state.json` all heal rather than corrupt.
      if (session.eventOrigin === "record" && existing?.eventOrigin !== "record") {
        for (const day of await purgeCountEvents(ctx, session.sessionId)) touched.add(day);
      }
      if (!existing) {
        await ctx.db.insert("sessions", { ...session, userId, machineId, syncedAt: now });
        counts.inserted += 1;
        touched.add(session.day);
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
    machineId: v.string(),
    events: v.array(v.object(tokenEventFields)),
    now: v.number(),
  },
  handler: async (ctx, { userId, machineId, events, now }): Promise<{ counts: UpsertCounts; conflicts: number }> => {
    const counts = zeroCounts();
    let conflicts = 0;
    const touched = new Set<string>();
    // Owner of each parent session, resolved at most once per distinct sessionId: a 1,000-event
    // chunk spans a handful of sessions and this mutation's document-read budget is already tight
    // (see MAX_DAYS_PER_EVENT_CHUNK). `null` = no session document (yet).
    const sessionOwners = new Map<string, Id<"users"> | null>();
    const sessionOwner = async (sessionId: string): Promise<Id<"users"> | null> => {
      const cached = sessionOwners.get(sessionId);
      if (cached !== undefined) return cached;
      const session = await ctx.db
        .query("sessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .unique();
      const owner = session?.userId ?? null;
      sessionOwners.set(sessionId, owner);
      return owner;
    };
    for (const event of events) {
      const existing = await ctx.db
        .query("tokenEvents")
        .withIndex("by_session_seq", (q) => q.eq("sessionId", event.sessionId).eq("seq", event.seq))
        .unique();
      if (!existing) {
        // A new (sessionId, seq) is only writable by the parent session's owner — without this,
        // a second user could inject token events into someone else's session (they would land in
        // the attacker's rollup and the owner could never recover them). A session with no document
        // yet stays permissive: the protocol lets a file's events arrive before its summary, which
        // rides in the file's LAST batch.
        const owner = await sessionOwner(event.sessionId);
        if (owner !== null && owner !== userId) {
          conflicts += 1;
          continue;
        }
        await ctx.db.insert("tokenEvents", { ...event, userId, machineId });
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
      // Re-stamps machineId from the batch that carried this version of the row. A machine-only
      // difference does not reach here — machineId is not compared, so it is judged unchanged —
      // which is the intent: re-syncing the same file from a second install must not make two
      // machines fight over the same rows.
      await ctx.db.replace(existing._id, { ...event, userId, machineId });
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
      // Gated on the SERVER clock (design spec: "when `receivedAt` is newer — server clock, never
      // the client's"). `observedAt` is the client's reading of a log line: one machine resuming
      // with a fast RTC would store a future date and discard every corrected snapshot after it,
      // freezing the shared gauge for good. It is still stored, for display only.
      if (
        rateLimit !== undefined &&
        (machine.lastRateLimit === undefined || now >= machine.lastRateLimit.receivedAt)
      ) {
        patch.lastRateLimit = {
          ...rateLimit,
          // Clamped rather than rejected: the quota reading is incidental to a sync and must never
          // fail one. Unclamped, a bogus 4000 would be echoed straight to the dashboard gauge.
          usedPercent: Math.min(100, Math.max(0, rateLimit.usedPercent)),
          receivedAt: now,
        };
        rateLimitStored = true;
      }
      await ctx.db.patch(machine._id, patch);
    }
    const tokenTouched = await touchToken(ctx, tokenId, now);
    return { rateLimitStored, tokenTouched };
  },
});

// ---------- HTTP handlers ----------

const JSON_HEADERS = { "content-type": "application/json" };

export function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(
  status: number,
  error: ErrorCode,
  message: string,
  extra: Partial<Pick<ErrorResponse, "issues" | "limits">> = {},
  extraHeaders: Record<string, string> = {},
): Response {
  const body: ErrorResponse = { ok: false, error, message, ...extra };
  return jsonResponse(status, body, extraHeaders);
}

type AuthResult = { ok: true; auth: TokenLookup } | { ok: false; response: Response };

async function authenticate(ctx: ActionCtx, request: Request): Promise<AuthResult> {
  const raw = parseBearer(request.headers.get("authorization"));
  if (!raw) return { ok: false, response: errorResponse(401, "unauthorized", "missing bearer token") };
  const auth = await ctx.runQuery(internal.syncTokens.lookupByHash, {
    tokenHash: await sha256Hex(raw),
  });
  if (!auth) return { ok: false, response: errorResponse(401, "unauthorized", "unknown token") };
  if (auth.revokedAt !== null) {
    return { ok: false, response: errorResponse(401, "token_revoked", "token has been revoked") };
  }
  return { ok: true, auth };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internalError(error: unknown): Response {
  console.error("codex-kaboo ingest failed", error);
  return errorResponse(503, "internal", "unexpected error, retry later", {}, { "retry-after": "5" });
}

/**
 * A 503 may follow a batch that partially committed, since the sync handler's mutations are
 * independent `ctx.runMutation` calls rather than one transaction; this is safe because every
 * upsert above is keyed and idempotent and the CLI only advances its per-file replay state on a
 * 200, so retrying the identical batch converges with no loss or duplication. `lastSyncAt` only
 * advances via `finishSync`, which runs last and only after the whole batch has committed —
 * `upsertMachine` never advances it when patching an existing row (only when inserting a new one).
 */
export const syncHandler = httpAction(async (ctx, request) => {
  try {
    const authed = await authenticate(ctx, request);
    if (!authed.ok) return authed.response;
    const { auth } = authed;

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) {
      return errorResponse(413, "payload_too_large", `body exceeds ${MAX_BODY_BYTES} bytes`, {
        limits: LIMITS,
      });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "payload_too_large", `body exceeds ${MAX_BODY_BYTES} bytes`, {
        limits: LIMITS,
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return errorResponse(400, "invalid_json", "body is not valid JSON");
    }

    if (isRecord(json)) {
      const sessions = Array.isArray(json.sessions) ? json.sessions.length : 0;
      const events = Array.isArray(json.tokenEvents) ? json.tokenEvents.length : 0;
      if (sessions > MAX_SESSIONS_PER_REQUEST || events > MAX_EVENTS_PER_REQUEST) {
        return errorResponse(
          413,
          "too_many_items",
          `at most ${MAX_SESSIONS_PER_REQUEST} sessions and ${MAX_EVENTS_PER_REQUEST} events per request`,
          { limits: LIMITS },
        );
      }
    }

    const parsed = SyncBatch.safeParse(json);
    if (!parsed.success) {
      return errorResponse(400, "invalid_batch", "batch failed validation", {
        issues: parsed.error.issues.slice(0, 50).map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      });
    }
    const batch = parsed.data;
    const now = Date.now();

    const machine = await ctx.runMutation(internal.ingest.upsertMachine, {
      userId: auth.userId,
      machine: batch.machine,
      cliVersion: batch.cliVersion,
      now,
    });
    if (machine.conflict) {
      return errorResponse(409, "machine_conflict", "this machineId is registered to another user");
    }

    const accepted = { sessions: zeroCounts(), events: zeroCounts() };
    const conflicts: { sessions: string[]; events: number } = { sessions: [], events: 0 };
    for (const chunk of chunkSessions(batch.sessions)) {
      const result = await ctx.runMutation(internal.ingest.upsertSessions, {
        userId: auth.userId,
        machineId: batch.machine.machineId,
        sessions: chunk,
        now,
      });
      addCounts(accepted.sessions, result.counts);
      conflicts.sessions.push(...result.conflicts);
    }
    for (const chunk of chunkEvents(batch.tokenEvents)) {
      const result = await ctx.runMutation(internal.ingest.upsertEvents, {
        userId: auth.userId,
        machineId: batch.machine.machineId,
        events: chunk,
        now,
      });
      addCounts(accepted.events, result.counts);
      conflicts.events += result.conflicts;
    }
    await ctx.runMutation(internal.ingest.finishSync, {
      userId: auth.userId,
      machineId: batch.machine.machineId,
      tokenId: auth.tokenId,
      rateLimit: batch.rateLimit,
      now,
    });

    const body: SyncResponse = {
      ok: true,
      accepted,
      conflicts,
      serverTime: now,
      latestCliVersion: latestCliVersion(),
      limits: LIMITS,
    };
    return jsonResponse(200, body);
  } catch (error) {
    return internalError(error);
  }
});

export const whoamiHandler = httpAction(async (ctx, request) => {
  try {
    const authed = await authenticate(ctx, request);
    if (!authed.ok) return authed.response;
    const { auth } = authed;
    const now = Date.now();
    await ctx.runMutation(internal.syncTokens.touchLastUsed, { tokenId: auth.tokenId, now });
    const body: WhoamiResponse = {
      ok: true,
      userId: auth.userId,
      name: auth.user.name,
      email: auth.user.email,
      token: { name: auth.name, prefix: auth.prefix },
      serverTime: now,
    };
    return jsonResponse(200, body);
  } catch (error) {
    return internalError(error);
  }
});

export const healthHandler = httpAction(async () =>
  jsonResponse(200, { ok: true, serverTime: Date.now() }),
);

/** No table is scanned past this in `counts`; a table that hits it reports `capped: true`. */
const COUNTS_LIMIT = 5000;

/** Operational check: `npx convex run ingest:counts '{}'`. Every table is counted up to 5,000 rows. */
export const counts = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    sessions: number;
    tokenEvents: number;
    dailyRollups: number;
    capped: { sessions: boolean; tokenEvents: boolean; dailyRollups: boolean };
  }> => {
    const sessions = await ctx.db.query("sessions").take(COUNTS_LIMIT);
    const tokenEvents = await ctx.db.query("tokenEvents").take(COUNTS_LIMIT);
    const dailyRollups = await ctx.db.query("dailyRollups").take(COUNTS_LIMIT);
    return {
      sessions: sessions.length,
      tokenEvents: tokenEvents.length,
      dailyRollups: dailyRollups.length,
      capped: {
        sessions: sessions.length === COUNTS_LIMIT,
        tokenEvents: tokenEvents.length === COUNTS_LIMIT,
        dailyRollups: dailyRollups.length === COUNTS_LIMIT,
      },
    };
  },
});
