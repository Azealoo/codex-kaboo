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
