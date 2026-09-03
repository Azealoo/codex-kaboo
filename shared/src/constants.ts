export const SCHEMA_VERSION = 1 as const;
export const PARSER_VERSION = 1;
/**
 * Bumped to 2: `byMachine`/`bySource` tokens moved from the session basis (the session's start
 * day) to the event basis (the event's own day), and commit 3eccabf had already changed persisted
 * rollup output without a bump. Run `npx convex run rollups:rebuildAll '{}'` after deploying.
 */
export const ROLLUP_VERSION = 2;

// Server-side request limits (also advertised in every sync response as `limits`).
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_SESSIONS_PER_REQUEST = 500;
export const MAX_EVENTS_PER_REQUEST = 5000;
// Server-side mutation chunking.
export const MAX_SESSIONS_PER_MUTATION = 200;
export const MAX_EVENTS_PER_MUTATION = 1000;
/**
 * Distinct `day` values one upsert mutation may touch. Each touched day costs a full
 * `recomputeDay` — that day's `tokenEvents` and `sessions` re-read — inside the same mutation, so
 * this multiplied by MAX_EVENTS_PER_MUTATION bounds the mutation's document reads: ~10k here, and
 * ~20k even when a resend moves events to a different day and touches both. Convex's ceiling is
 * ~32k documents, and blowing it yields a permanent 503 (the identical retry hits the same wall),
 * so the margin is deliberate. More mutations per sync is the intended trade. If this is ever
 * approached again, the next step is the "mark dirty -> scheduled drain" pattern from the design
 * doc rather than a larger bound.
 */
export const MAX_DAYS_PER_EVENT_CHUNK = 10;
// Payload shape limits.
export const MAX_KEYED_ENTRIES_PER_SESSION = 64; // mcpTools / skills per session
export const MAX_ROLLUP_ENTRIES = 100; // per keyed array in a daily rollup
export const OTHER_KEY = "(other)";
export const MAX_STRING_LENGTH = 256;

/**
 * Upper bound on a manually entered model price (USD per million tokens), checked by both
 * `parsePrice` (client) and `prices.upsert` (server) so the two cannot drift. This is a typo
 * guard, not a pricing policy — it exists to catch a fat-fingered entry (e.g. `2000000` typed for
 * `2.00`), not to express a real ceiling: it is roughly 333x the priciest seed-table entry
 * (`gpt-5.5` output at 30), so no real model price can hit it.
 */
export const MAX_PRICE_USD_PER_MTOK = 10000;

export const TTFT_BUCKETS_MS = [
  250,
  500,
  750,
  1000,
  1500,
  2000,
  3000,
  4000,
  6000,
  8000,
  12000,
  16000,
  24000,
  32000,
  60000,
  Number.POSITIVE_INFINITY,
] as const;
export const TTFT_BUCKET_COUNT = 16;

export const TOOL_KINDS = [
  "commandRead",
  "commandList",
  "commandSearch",
  "commandOther",
  "fileChange",
  "webSearch",
  "imageView",
  "mcpTool",
  "other",
] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
export const MAX_TIMESTAMP_MS = Date.UTC(2100, 0, 1);

export const MAX_QUERY_RANGE_DAYS = 1100; // server-side cap on [from, to]
export const MAX_CUSTOM_RANGE_DAYS = 400; // UI custom range cap

// CLI behaviour.
export const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
export const CLI_BATCH_MAX_EVENTS = 1000;
export const CLI_BATCH_MAX_BYTES = Math.floor(3.5 * 1024 * 1024);
export const CLI_MIN_BATCH_EVENTS = 50;
export const CLI_RUN_BUDGET_MS = 10 * 60 * 1000;
export const CLI_LOCK_STALE_MS = 10 * 60 * 1000;
export const CLI_MAX_FILE_BYTES = 256 * 1024 * 1024;
export const CLI_MAX_FILES = 20000;
export const CLI_IN_PROGRESS_WINDOW_MS = 10 * 60 * 1000;

/**
 * The Node floor the CLI is published under. Four surfaces state it — `engines.node` in
 * cli/package.json, `doctor`'s node check, the README and the dashboard's install card — and two
 * of them have already drifted from the others once. Everything that can import it now does, and
 * `cli/test/engines.test.ts` pins package.json to this value, so the next bump is one edit.
 */
export const MIN_NODE_MAJOR = 20;

export const TOKEN_PREFIX = "ck_";
export const SYNC_PATH = "/api/v1/sync";
export const WHOAMI_PATH = "/api/v1/whoami";
export const HEALTH_PATH = "/api/v1/health";
export const SUMMARY_PATH = "/api/v1/summary";
export const CLI_VERSION_HEADER = "X-Codex-Kaboo-Cli";

/**
 * How old a quota reading may be before the card labels it stale. Measured against the SERVER's
 * `receivedAt`, so it says "no machine has reported a limit for an hour", not "this machine's
 * clock thinks so" — one install with a fast RTC cannot mark the shared gauge fresh.
 *
 * Four scheduled syncs' worth (the collector runs every 15 minutes), which leaves room for a
 * missed run or two before the card starts hedging. The label is a display hint and nothing else:
 * a stale reading is still shown, because a two-hour-old "7 % used" is far more useful than a
 * blank row.
 */
export const QUOTA_STALE_MS = 60 * 60 * 1000;
