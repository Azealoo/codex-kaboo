import {
  MAX_BODY_BYTES,
  MAX_EVENTS_PER_REQUEST,
  MAX_SESSIONS_PER_REQUEST,
} from "../../../shared/src/constants";
import type { SyncLimits } from "../../../shared/src/sync";

/** `syncTokens.lastUsedAt` is written at most once per minute per token. */
export const TOKEN_LAST_USED_THROTTLE_MS = 60_000;

/**
 * Rollups recomputed per `rollups.rebuildAll` invocation before it reschedules itself. Each one
 * re-reads a whole (user, day) of `tokenEvents` inside the same mutation, so the page stays small.
 */
export const REBUILD_PAGE_SIZE = 20;

/**
 * Guards `stats.loadRollups`'s document read. `dailyRollups` holds one document per (user, day),
 * so a team-scope read over the full range is bounded only by active users × days — Convex caps a
 * single query read at roughly 32,000 documents (and a 16 MiB payload, which can bind sooner,
 * since each rollup carries several 100-entry sub-arrays). This cap fails loudly well under either
 * ceiling; crossing it means it's time to add monthly rollups, exactly as the spec's Risks section
 * already anticipates: "Rollups older than ~3 years would push an ALL-time query toward the 16 MiB
 * read limit; add monthly rollups then." At this product's current scale (3 users, ~3,300 documents
 * at the 1100-day maximum range) the cap is nowhere close.
 */
export const MAX_ROLLUP_DOCS_PER_QUERY = 20_000;

/** How long `quotaSnapshots` rows are kept before the daily prune removes them. */
export const QUOTA_SNAPSHOT_RETENTION_MS = 90 * 86_400_000;
/** Rows deleted per `quota:pruneSnapshots` run; it reschedules itself while more remain. */
export const QUOTA_PRUNE_PAGE_SIZE = 500;
/** The widest history window `stats.quotaHistory` serves, and the most rows it reads. */
export const QUOTA_HISTORY_MAX_MS = 30 * 86_400_000;
export const QUOTA_HISTORY_MAX_ROWS = 5_000;

/** Advertised in every sync response so the CLI can re-chunk (contracts §7). */
export const LIMITS: SyncLimits = {
  maxBodyBytes: MAX_BODY_BYTES,
  maxSessions: MAX_SESSIONS_PER_REQUEST,
  maxEvents: MAX_EVENTS_PER_REQUEST,
};

/** Convex env var `LATEST_CLI_VERSION`, set by `web/scripts/pack-cli.mjs` at deploy time. */
export function latestCliVersion(): string | null {
  const env = typeof process !== "undefined" ? process.env : undefined;
  const value = env?.LATEST_CLI_VERSION;
  return value !== undefined && value.length > 0 ? value : null;
}
