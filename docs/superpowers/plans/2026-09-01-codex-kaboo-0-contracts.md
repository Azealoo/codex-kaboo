# codex-kaboo — Cross-plan contracts

> Shared interface document for the three implementation plans:
> `2026-09-01-codex-kaboo-1-foundation-cli.md` (bootstrap, `shared/`, `cli/`),
> `2026-09-01-codex-kaboo-2-convex.md` (`web/convex/`),
> `2026-09-01-codex-kaboo-3-web.md` (`web/src/`, packaging, deploy).
> Everything here is **binding**: a plan may add to it, never contradict it. When a plan and this
> document disagree, this document wins; when this document and the spec disagree, this document
> wins (it refines the spec). Spec: `docs/superpowers/specs/2026-09-01-codex-kaboo-design.md`.

## 1. Workspace layout and tooling (owned by Plan 1, relied on by Plans 2 and 3)

```
codex-kaboo/
  package.json          private, "workspaces": ["shared", "cli", "web"], engines.node ">=20"
                        scripts: typecheck / lint / test / build → `npm run <x> --workspaces --if-present`
  tsconfig.base.json    strict: true, target ES2022, module ESNext, moduleResolution Bundler,
                        isolatedModules, noUncheckedIndexedAccess, exactOptionalPropertyTypes: false,
                        skipLibCheck, forceConsistentCasingInFileNames, resolveJsonModule
  .prettierrc           { "printWidth": 100, "singleQuote": false, "trailingComma": "all" }
  eslint.config.mjs     ESLint 9 flat config (typescript-eslint recommended); web has its own
                        eslint.config.mjs from create-next-app (Plan 1 keeps it, root ignores web/)
  .github/workflows/ci.yml
  shared/               package "@codex-kaboo/shared", "private": true, no build step:
                        "exports": { ".": "./src/index.ts", "./*": "./src/*.ts" }, "types": "./src/index.ts"
                        deps: zod ^4 ; devDeps: vitest ^4.1, typescript ^5.9.3
  cli/                  package "codex-kaboo-cli", "bin": { "codex-kaboo": "dist/codex-kaboo.js" },
                        "files": ["dist"], "dependencies": {} (everything bundled by tsup),
                        devDeps: @codex-kaboo/shared "*", commander ^14, zod ^4, tsup ^8, vitest ^4.1, @types/node
                        engines.node ">=18"
  web/                  package "web" (Next 16 app), also hosts web/convex/
                        vitest projects: "convex" (edge-runtime, convex/**/*.test.ts, server.deps.inline ["convex-test"]),
                        "unit" (node, src/**/*.test.ts), "dom" (jsdom, src/**/*.test.tsx)
```

How each unit imports `shared/` (do not deviate — these three paths are verified to bundle):

| Importer | Import form | Why |
|---|---|---|
| `cli/src/**` | `import { … } from "@codex-kaboo/shared"` or `"@codex-kaboo/shared/sync"` | workspace symlink; tsup bundles it (`noExternal: [/.*/]`) |
| `web/convex/**` | `import { … } from "../../shared/src/sync"` (relative; from `web/convex/lib/` it is `../../../shared/src/sync`) | Convex's esbuild bundles relative TS without config |
| `web/src/**` | `import { … } from "@shared/sync"` | `web/tsconfig.json` paths `"@shared/*": ["../shared/src/*"]`, `next.config.ts` `turbopack.root` = repo root |

Test commands every plan uses (run from the repo root):

```
npm run test -w shared
npm run test -w cli
npm run test -w web -- --project convex     # convex-test suite only
npm run test -w web -- --project unit
npm run test -w web -- --project dom
npm run typecheck -w web                     # runs `next typegen` then `tsc --noEmit` (convex/_generated is committed)
npm run typecheck                            # all workspaces
```

Single-test invocation: `npx vitest run <path> -t "<name>"` inside the workspace directory
(for web: `cd web && npx vitest run --project convex convex/ingest.test.ts`).

## 2. `shared/src/constants.ts` (verbatim)

```ts
export const SCHEMA_VERSION = 1 as const;
export const PARSER_VERSION = 1;
export const ROLLUP_VERSION = 1;

// Server-side request limits (also advertised in every sync response as `limits`).
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_SESSIONS_PER_REQUEST = 500;
export const MAX_EVENTS_PER_REQUEST = 5000;
// Server-side mutation chunking.
export const MAX_SESSIONS_PER_MUTATION = 200;
export const MAX_EVENTS_PER_MUTATION = 1000;
export const MAX_DAYS_PER_EVENT_CHUNK = 30;
// Payload shape limits.
export const MAX_KEYED_ENTRIES_PER_SESSION = 64; // mcpTools / skills per session
export const MAX_ROLLUP_ENTRIES = 100; // per keyed array in a daily rollup
export const OTHER_KEY = "(other)";
export const MAX_STRING_LENGTH = 256;

export const TTFT_BUCKETS_MS = [
  250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 12000, 16000, 24000, 32000, 60000,
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

export const TOKEN_PREFIX = "ck_";
export const SYNC_PATH = "/api/v1/sync";
export const WHOAMI_PATH = "/api/v1/whoami";
export const HEALTH_PATH = "/api/v1/health";
export const CLI_VERSION_HEADER = "X-Codex-Kaboo-Cli";
```

## 3. `shared/src/sync.ts` (verbatim; zod 4)

```ts
import { z } from "zod";
import {
  MAX_EVENTS_PER_REQUEST,
  MAX_KEYED_ENTRIES_PER_SESSION,
  MAX_SESSIONS_PER_REQUEST,
  MAX_STRING_LENGTH,
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  TTFT_BUCKET_COUNT,
} from "./constants";
import { isValidDay } from "./days";

export const shortString = z.string().max(MAX_STRING_LENGTH);
export const nonEmptyString = z.string().min(1).max(MAX_STRING_LENGTH);
export const count = z.int().min(0);
export const timestampMs = z.int().min(MIN_TIMESTAMP_MS).max(MAX_TIMESTAMP_MS);
export const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidDay, { message: "invalid calendar day" });
export const hourOfDay = z.int().min(0).max(23);

export const TokenCounts = z.object({
  input: count,
  cachedInput: count,
  cacheWrite: count,
  output: count,
  reasoning: count,
  total: count,
});
export type Tokens = z.infer<typeof TokenCounts>;

export const ToolCounts = z.object({
  commandRead: count,
  commandList: count,
  commandSearch: count,
  commandOther: count,
  fileChange: count,
  webSearch: count,
  imageView: count,
  mcpTool: count,
  other: count,
});
export type ToolCounts = z.infer<typeof ToolCounts>;

export const KeyCount = z.object({ key: nonEmptyString, count });
export type KeyCount = z.infer<typeof KeyCount>;

export const Ttft = z.object({
  count,
  sumMs: count,
  hist: z.array(count).length(TTFT_BUCKET_COUNT),
});
export type Ttft = z.infer<typeof Ttft>;

export const SessionSummary = z.object({
  sessionId: nonEmptyString, // threadId or `${threadId}_${rolloutId}`
  threadId: nonEmptyString,
  parentThreadId: nonEmptyString.optional(),
  startedAt: timestampMs,
  endedAt: timestampMs,
  wallMs: count,
  day: dayString, // start day in the session's zone
  timezone: shortString.optional(),
  project: nonEmptyString, // basename(cwd) or "(unknown)"
  gitBranch: shortString.optional(),
  originator: shortString,
  source: nonEmptyString, // cli | exec | vscode | mcp | custom | internal | subagent:<kind> | unknown
  isSubagent: z.boolean(),
  model: nonEmptyString, // model of the last turn_context, else base_instructions model, else "(unknown)"
  effort: shortString.optional(), // effort of the last turn_context that had one
  cliVersion: shortString.optional(),
  turns: count,
  completedTurns: count,
  userMessages: count,
  agentMessages: count,
  reasoningItems: count,
  toolCounts: ToolCounts,
  mcpTools: z.array(KeyCount).max(MAX_KEYED_ENTRIES_PER_SESSION), // key = "server/tool"
  skills: z.array(KeyCount).max(MAX_KEYED_ENTRIES_PER_SESSION),
  linesAdded: count,
  linesRemoved: count,
  filesChanged: count,
  compactions: count,
  activeMs: count,
  ttft: Ttft,
  tokens: TokenCounts,
  responses: count, // number of token events
  inProgress: z.boolean(),
  lineCount: count,
  generation: count,
  parseErrors: count,
  parserVersion: count,
  summaryHash: z.string().regex(/^[0-9a-f]{40}$/), // sha1 of the canonical summary (see §6)
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const TokenEvent = z.object({
  sessionId: nonEmptyString,
  seq: count, // 0-based line index in the rollout file
  ts: timestampMs,
  day: dayString,
  hour: hourOfDay,
  model: nonEmptyString,
  effort: shortString.optional(),
  turnId: shortString.optional(),
  project: nonEmptyString,
  isSubagent: z.boolean(),
  input: count,
  cachedInput: count,
  cacheWrite: count,
  output: count,
  reasoning: count,
  total: count, // always input + output (recomputed by the parser)
  contextWindow: count.optional(),
});
export type TokenEvent = z.infer<typeof TokenEvent>;

export const RateLimitSnapshot = z.object({
  observedAt: timestampMs, // timestamp of the log line that carried it
  usedPercent: z.number().min(0),
  windowMinutes: count,
  resetsAt: timestampMs.optional(),
  planType: shortString.optional(),
  limitId: shortString.optional(),
});
export type RateLimitSnapshot = z.infer<typeof RateLimitSnapshot>;

export const MachineInfo = z.object({
  machineId: nonEmptyString,
  label: z.string().min(1).max(64),
  platform: nonEmptyString, // process.platform
  arch: shortString.optional(),
  nodeVersion: shortString.optional(),
  codexVersion: shortString.optional(), // installed = newest session_meta.cli_version seen
  codexLatestVersion: shortString.optional(), // from <codex-home>/version.json
  hostname: shortString.nullable().optional(), // only with `login --hostname`
  tz: shortString.optional(),
});
export type MachineInfo = z.infer<typeof MachineInfo>;

export const SyncBatch = z.object({
  schemaVersion: z.literal(1),
  parserVersion: count,
  cliVersion: nonEmptyString,
  batchId: nonEmptyString,
  sentAt: timestampMs,
  machine: MachineInfo,
  sessions: z.array(SessionSummary).max(MAX_SESSIONS_PER_REQUEST),
  tokenEvents: z.array(TokenEvent).max(MAX_EVENTS_PER_REQUEST),
  rateLimit: RateLimitSnapshot.optional(),
});
export type SyncBatch = z.infer<typeof SyncBatch>;

export const UpsertCounts = z.object({ inserted: count, updated: count, unchanged: count });
export type UpsertCounts = z.infer<typeof UpsertCounts>;
export const SyncLimits = z.object({ maxBodyBytes: count, maxSessions: count, maxEvents: count });
export type SyncLimits = z.infer<typeof SyncLimits>;

export const SyncResponse = z.object({
  ok: z.literal(true),
  accepted: z.object({ sessions: UpsertCounts, events: UpsertCounts }),
  conflicts: z.object({ sessions: z.array(z.string()), events: count }),
  serverTime: z.number(),
  latestCliVersion: z.string().nullable(),
  limits: SyncLimits,
});
export type SyncResponse = z.infer<typeof SyncResponse>;

export const ErrorCode = z.enum([
  "unauthorized",
  "token_revoked",
  "payload_too_large",
  "too_many_items",
  "invalid_json",
  "invalid_batch",
  "machine_conflict",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({
  ok: z.literal(false),
  error: z.string(), // an ErrorCode; parsed loosely so new codes never break old CLIs
  message: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  limits: SyncLimits.optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const WhoamiResponse = z.object({
  ok: z.literal(true),
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  token: z.object({ name: z.string(), prefix: z.string() }),
  serverTime: z.number(),
});
export type WhoamiResponse = z.infer<typeof WhoamiResponse>;
```

`shared/src/index.ts` re-exports `constants`, `sync`, `metrics`, `days`.

## 4. `shared/src/days.ts` — signatures and semantics (Plan 1 implements; all plans use)

All day math is on `YYYY-MM-DD` strings interpreted as UTC calendar dates (no zone conversion).

```ts
export function isValidDay(day: string): boolean;            // real calendar date, 2000-01-01 … 2099-12-31
export function dayToUtcMs(day: string): number;             // Date.UTC(y, m-1, d)
export function utcMsToDay(ms: number): string;              // YYYY-MM-DD of the UTC date
export function addDays(day: string, n: number): string;     // n may be negative
export function daysBetween(from: string, to: string): number; // inclusive count; from > to → 0
export function eachDay(from: string, to: string): string[]; // inclusive, ascending
export function compareDays(a: string, b: string): number;   // lexical (valid days sort correctly)
export function previousPeriod(from: string, to: string): { from: string; to: string };
//   n = daysBetween(from, to); prevTo = addDays(from, -1); prevFrom = addDays(prevTo, -(n - 1))
export function weekdayOf(day: string): number;              // 0 = Monday … 6 = Sunday
export function weekStart(day: string): string;              // Monday of that week
export function monthStart(day: string): string;             // YYYY-MM-01
export type Bucket = "day" | "week" | "month";
export function bucketStart(day: string, bucket: Bucket): string;
export function eachBucket(from: string, to: string, bucket: Bucket): string[];
//   ascending bucket starts covering [from, to]; first = bucketStart(from), last ≤ to
export function bucketFor(days: number): Bucket;             // ≤ 120 → "day", ≤ 730 → "week", else "month"
export function dayHourIn(tsMs: number, timeZone: string | undefined): { day: string; hour: number };
//   Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", hourCycle:"h23" })
//   invalid/undefined zone → machine zone (Intl default) → UTC. hour "24" (older ICU) → 0.
```

## 5. `shared/src/metrics.ts` — signatures and semantics

```ts
import type { Tokens, Ttft, ToolCounts, KeyCount } from "./sync";

export interface ModelPrice { inputUsdPerMTok: number; cachedInputUsdPerMTok: number; outputUsdPerMTok: number }
export interface CostBreakdown { total: number; input: number; cached: number; output: number; reasoning: number }
//   input     = (input − cachedInput) / 1e6 × inputUsdPerMTok
//   cached    = cachedInput / 1e6 × cachedInputUsdPerMTok
//   output    = max(0, output − reasoning) / 1e6 × outputUsdPerMTok   (clamped: malformed logs may report reasoning > output)
//   reasoning = min(reasoning, output) / 1e6 × outputUsdPerMTok  (clamped, so input+cached+output+reasoning stays exact)
//   total     = input + cached + output + reasoning
export function costOf(tokens: Tokens, price: ModelPrice): CostBreakdown;
export function cacheSavings(tokens: Tokens, price: ModelPrice): number; // cachedInput/1e6 × (input − cached price)
export function ratio(numerator: number, denominator: number): number | null; // denominator ≤ 0 → null
export function cacheHitRate(tokens: Tokens): number | null;              // ratio(cachedInput, input)
export function percentChange(current: number, previous: number | null): number | null;
//   previous null or 0 → null; else (current − previous) / previous  (0.25 means +25 %)
export function emptyTokens(): Tokens;                                    // all zero
export function addTokens(a: Tokens, b: Tokens): Tokens;                  // field-wise sum
export function emptyToolCounts(): ToolCounts;
export function addToolCounts(a: ToolCounts, b: ToolCounts): ToolCounts;
export function emptyTtft(): Ttft;                                        // count 0, sumMs 0, hist 16 zeros
export function addTtft(a: Ttft, b: Ttft): Ttft;
export function ttftBucketIndex(ms: number): number;                      // first i with ms ≤ TTFT_BUCKETS_MS[i]
export function ttftMean(t: Ttft): number | null;                         // sumMs / count, null when count 0
export function ttftMedianApprox(t: Ttft): number | null;
//   linear interpolation inside the bucket containing the (count/2)-th sample; bucket lower bound =
//   previous upper bound (0 for the first); the last bucket interpolates between 60000 and 120000
export function mergeKeyCounts(lists: KeyCount[][], cap: number, otherKey: string): KeyCount[];
//   sum by key, sort by count desc then key asc, keep `cap − 1` entries and fold the rest into
//   { key: otherKey, count } (only when overflow exists); result sorted by key asc for stability
export function sortByKey<T extends { key: string }>(items: T[]): T[];
```

## 6. Canonical summary hash (CLI computes, server compares)

`summaryHash = sha1(JSON.stringify(canonical(summaryWithoutHash)))` where `canonical` sorts object
keys recursively, keeps array order, and drops `undefined` values. `summaryWithoutHash` is the
`SessionSummary` object minus `summaryHash`, `inProgress`, `lineCount`, `generation`, `syncedAt`.
The server never recomputes the hash; it only compares the stored one with the incoming one.

## 7. HTTP protocol (Plan 1 client ↔ Plan 2 server)

Base URL = the Convex deployment's `.convex.site` origin (`CODEX_KABOO_SERVER`). All bodies JSON.

| Route | Auth | Success | Errors |
|---|---|---|---|
| `POST /api/v1/sync` | `Authorization: Bearer ck_…` | 200 `SyncResponse` | 401 `unauthorized` / `token_revoked`; 413 `payload_too_large` (body > 8 MiB) or `too_many_items` (with `limits`); 400 `invalid_json` / `invalid_batch` (with `issues`); 409 `machine_conflict`; 503 `internal` + `Retry-After: 5` |
| `GET /api/v1/whoami` | Bearer | 200 `WhoamiResponse` | 401 |
| `GET /api/v1/health` | none | 200 `{ ok: true, serverTime }` | — |

Headers the CLI sends: `Content-Type: application/json`, `X-Codex-Kaboo-Cli: <cliVersion>`.
`latestCliVersion` in the response = Convex env var `LATEST_CLI_VERSION` or `null`
(`web/scripts/pack-cli.mjs` sets it with `npx convex env set` when `CONVEX_DEPLOY_KEY` is present).

Upsert semantics (server): sessions keyed by `sessionId` — insert / `unchanged` when the stored
`summaryHash` equals the incoming one / `updated` (replace, keeping `userId`, `machineId`,
`syncedAt` = server time) / `conflicts.sessions` when owned by another user (skipped, never merged).
Events keyed by `(sessionId, seq)` — insert / `unchanged` when all fields equal / `updated` /
`conflicts.events` count. `machine_conflict` when `machineId` exists for another user (409, no data
written). Machine `hostname: null` is stored as absent.

A 503 may follow a batch that partially committed, since the sync handler's mutations are
independent `ctx.runMutation` calls rather than one transaction; this is safe because every upsert
above is keyed and idempotent and the CLI only advances its per-file replay state on a 200, so
retrying the identical batch converges with no loss or duplication. `lastSyncAt` only advances via
`finishSync`, which runs last and only after the whole batch has committed — `upsertMachine` never
advances it when patching an existing row (only when inserting a new one).

## 8. Convex data model additions to the spec

- `sessions` gains `effort?: string` (from `SessionSummary.effort`). `machineId` is stamped by the
  server from `batch.machine.machineId`; `SessionSummary` does not carry it.
- `machines.lastRateLimit` = `RateLimitSnapshot & { receivedAt: number }` (`receivedAt` = server time
  of the request that carried it; replaced when the incoming `receivedAt` is newer — the server
  clock, never the client's). The client's `observedAt` is stored for display only and never decides
  a replacement: one machine with a fast RTC would otherwise store a future date and freeze the
  shared quota gauge for good. `usedPercent` is clamped to [0, 100] on ingest.
- Every keyed array (`mcpTools`, `skills`, rollup `by*`) is an array of `{ key: string, … }`, sorted
  by `key` ascending, capped at 100 in rollups with the overflow folded into `key: "(other)"`.
- `SessionSummary.inProgress` is purely structural: `true` while a turn has started without completing
  (no wall-clock component), so it flips on the file change that closes the turn. The server patches
  `inProgress` and `lineCount` on a re-sent summary whose hash is unchanged.
- An empty batch (`sessions: []`, `tokenEvents: []`) is a heartbeat: the server upserts the machine,
  applies `rateLimit` if present, updates `lastSyncAt` and answers 200 with zero counts.

## 9. Convex public API (Plan 2 implements, Plan 3 consumes) — `web/convex/lib/types.ts`

All public functions are `authedQuery` / `authedMutation` (throw `ConvexError({ code: "unauthenticated" })`
without a Clerk identity, `ConvexError({ code: "user_not_registered" })` when `users.ensure` has not
run yet). Range arguments are inclusive `YYYY-MM-DD` strings; the server validates
`from ≤ to`, both valid days, span ≤ `MAX_QUERY_RANGE_DAYS`, else `ConvexError({ code: "bad_range" })`.
`previous` (default `true`) makes the server fold the previous period `previousPeriod(from, to)`;
the UI passes `previous: false` for the ALL preset. All money is USD numbers; all rates are
fractions (0.42 = 42 %), `null` when undefined (division by zero or unpriced).

Two `MetricKey` entries whose names do not fix their meaning are defined here and nowhere else:
`activeDays` = the number of **distinct calendar days** in the range with `tokens.total > 0` or
`sessions > 0` (days, never rollup documents: two users active on the same day count once);
`tokensPerLine` = `tokens.total / linesAdded`, `null` when `linesAdded` is 0.

```ts
import type { Id } from "../_generated/dataModel";
import type { Tokens, ToolCounts } from "../../../shared/src/sync";

export type Metric = { current: number; previous: number | null; change: number | null };
export type Range = { from: string; to: string };

export type MetricKey =
  | "totalTokens" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens"
  | "subagentTokens" | "costUsd" | "linesAdded" | "linesRemoved" | "filesChanged"
  | "sessions" | "turns" | "responses" | "messages" | "userMessages" | "agentMessages"
  | "cacheHitRate" | "tokensPerTurn" | "tokensPerLine" | "avgSessionActiveMs" | "activeRate"
  | "activeMs" | "wallMs" | "ttftAvgMs" | "ttftP50Ms" | "compactions" | "activeDays";

export type CostByKind = { input: number; cached: number; output: number; reasoning: number };

export type SummaryResult = {
  range: Range;
  previousRange: Range | null;
  tokens: Tokens;
  previousTokens: Tokens | null;
  metrics: Record<MetricKey, Metric>;   // rate metrics use 0 as `current` when undefined and set `change: null`
  costByKind: CostByKind;
  cacheSavingsUsd: number;
  unpricedModels: string[];              // models with tokens in range but no price row
};

export type UserRef = { userId: Id<"users">; name: string; imageUrl: string | null };

export type LeaderboardRow = UserRef & {
  tokens: Tokens;
  costUsd: number;
  unpriced: boolean;
  sessions: number;
  turns: number;
  messages: number;
  userMessages: number;
  linesAdded: number;
  linesRemoved: number;
  tokensPerLine: number | null;
  cacheHitRate: number | null;
  activeMs: number;
  rank: number;                          // 1-based by tokens.total desc, ties by name asc
  previousRank: number | null;           // null when no previous data / previous disabled
  previousTokens: number | null;
  change: number | null;                 // percentChange(tokens.total, previousTokens)
};
export type LeaderboardResult = { range: Range; previousRange: Range | null; rows: LeaderboardRow[] };

export type TrendPoint = {
  bucket: string;                        // bucket start day
  total: number;                         // tokens.total
  tokens: Tokens;
  costUsd: number;
  activeMs: number;
  sessions: number;
  byUser: { key: string; tokens: number; costUsd: number; activeMs: number }[]; // key = userId
  byModel: { key: string; tokens: number }[];
};
export type TrendsResult = {
  bucket: "day" | "week" | "month";
  points: TrendPoint[];                  // one per bucket in range, zero-filled, ascending
  users: UserRef[];                      // every user that appears in `points`
  models: string[];                      // every model that appears, by total tokens desc
  peak: { bucket: string; total: number } | null;
};

export type ModelRow = { key: string; effort: string | null; tokens: Tokens; responses: number; costUsd: number | null; share: number };
export type BreakdownsResult = {
  totalTokens: number;
  byModel: ModelRow[];                   // key = model, effort null (folded over efforts)
  byModelEffort: ModelRow[];             // key = model, effort set (raw rollup grain)
  byEffort: { key: string; tokens: number; responses: number; share: number }[]; // key = effort or "(none)"
  byTool: { key: string; count: number; share: number }[];   // fixed ToolKind keys, all 9 present
  byMcpTool: { key: string; count: number }[];
  bySkill: { key: string; count: number; sessions: number }[];
  byProject: { key: string; tokens: number; responses: number; sessions: number; userMessages: number; linesAdded: number; linesRemoved: number; share: number }[];
  byMachine: { key: string; label: string; tokens: number; sessions: number; share: number }[]; // key = machineId
  bySource: { key: string; tokens: number; sessions: number; share: number }[];
  byHour: number[];                      // 24 entries, total tokens
  toolCalls: number;                     // Σ byTool.count
};

export type ActivityHeatmapResult = {
  range: Range;
  days: { day: string; tokens: number; sessions: number; costUsd: number }[]; // only days with data
  activeDays: number;
  maxTokens: number;
};

export type DayHourHeatmapResult = {
  grid: number[][];                      // [weekday 0=Mon..6=Sun][hour 0..23] total tokens
  max: number;
  peakHour: number | null;
  peakWeekday: number | null;
};

export type QuotaResult = null | {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
  planType: string | null;
  limitId: string | null;
  observedAt: number;
  receivedAt: number;
  machine: { machineId: string; label: string };
  user: UserRef;
};

export type BoundsResult = { firstDay: string | null; lastDay: string | null };

export type SessionRow = {
  _id: Id<"sessions">;
  sessionId: string;
  userId: Id<"users">;
  userName: string;
  machineId: string;
  machineLabel: string;
  startedAt: number;
  endedAt: number;
  day: string;
  project: string;
  gitBranch: string | null;
  model: string;
  effort: string | null;
  source: string;
  isSubagent: boolean;
  turns: number;
  userMessages: number;
  agentMessages: number;
  tokens: Tokens;
  cacheHitRate: number | null;
  costUsd: number | null;                // priced with the session's `model`; null when unpriced
  activeMs: number;
  linesAdded: number;
  linesRemoved: number;
  toolCounts: ToolCounts;
  inProgress: boolean;
};

export type MachineRow = {
  _id: Id<"machines">;
  machineId: string;
  userId: Id<"users">;
  label: string;
  hostname: string | null;
  platform: string;
  arch: string | null;
  nodeVersion: string | null;
  cliVersion: string;
  codexVersion: string | null;
  codexLatestVersion: string | null;
  tz: string | null;
  firstSeenAt: number;
  lastSyncAt: number;
  lastRateLimit: { usedPercent: number; windowMinutes: number; resetsAt: number | null; planType: string | null; observedAt: number; receivedAt: number } | null;
};

export type SyncTokenRow = { _id: Id<"syncTokens">; name: string; prefix: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null };
export type PriceRow = { _id: Id<"modelPrices">; model: string; inputUsdPerMTok: number; cachedInputUsdPerMTok: number; outputUsdPerMTok: number; source: string; updatedAt: number };
export type MeResult = { _id: Id<"users">; clerkId: string; email: string | null; name: string; imageUrl: string | null; createdAt: number; lastSeenAt: number };
```

| Function | Kind | Args | Returns |
|---|---|---|---|
| `users.ensure` | mutation (identity required) | `{}` | `Id<"users">` — upsert by `by_clerkId`; name = identity.name ?? identity.email ?? "Unknown" |
| `users.me` | authedQuery | `{}` | `MeResult` |
| `users.list` | authedQuery | `{}` | `UserRef[]` sorted by name |
| `stats.summary` | authedQuery | `{ from, to, userId?: Id<"users">, previous?: boolean }` | `SummaryResult` |
| `stats.leaderboard` | authedQuery | `{ from, to, previous?: boolean }` | `LeaderboardResult` |
| `stats.trends` | authedQuery | `{ from, to, bucket: "day"\|"week"\|"month", userId? }` | `TrendsResult` |
| `stats.breakdowns` | authedQuery | `{ from, to, userId? }` | `BreakdownsResult` |
| `stats.activityHeatmap` | authedQuery | `{ userId, from, to }` | `ActivityHeatmapResult` |
| `stats.dayHourHeatmap` | authedQuery | `{ from, to, userId? }` | `DayHourHeatmapResult` |
| `stats.quota` | authedQuery | `{}` | `QuotaResult` |
| `stats.bounds` | authedQuery | `{ userId? }` | `BoundsResult` |
| `sessions.listRecent` | authedQuery | `{ userId?, paginationOpts }` | `PaginationResult<SessionRow>` newest first |
| `sessions.get` | authedQuery | `{ sessionId: string }` | `SessionRow \| null` |
| `syncTokens.list` | authedQuery | `{}` | `SyncTokenRow[]` (own tokens, newest first, revoked included) |
| `syncTokens.create` | action (identity required) | `{ name: string }` | `{ id: Id<"syncTokens">; token: string; prefix: string }` — raw token returned once |
| `syncTokens.revoke` | authedMutation | `{ tokenId: Id<"syncTokens"> }` | `null`; `ConvexError({ code: "forbidden" })` for another user's token |
| `machines.list` | authedQuery | `{ userId? }` | `MachineRow[]` (all users when omitted) |
| `machines.rename` | authedMutation | `{ machineId: string; label: string }` | `null`; own machines only (`forbidden`) |
| `prices.list` | authedQuery | `{}` | `PriceRow[]` sorted by model |
| `prices.upsert` | authedMutation | `{ model, inputUsdPerMTok, cachedInputUsdPerMTok, outputUsdPerMTok }` | `Id<"modelPrices">`; all ≥ 0, source "manual" |
| `prices.remove` | authedMutation | `{ model: string }` | `null` |
| `prices.seed` | internalMutation | `{}` | `{ inserted: number }`; inserts the spec's table where the model is absent |
| `rollups.rebuildAll` | internalMutation | `{ cursor?: string; pageSize?: number }` | `{ done: boolean; recomputed: number }`; reschedules itself until `done` |

Cost rules used by every function: a `(model, tokens)` pair is priced with `costOf` when a
`modelPrices` row with that exact `model` exists; otherwise it contributes 0 to `costUsd` and the
model is listed in `unpricedModels` / the row is flagged `unpriced` / `costUsd: null`.

## 10. Web ↔ CLI strings (Plan 3 shows, Plan 1 implements)

```
npm install -g https://<origin>/cli/codex-kaboo-cli.tgz          # npm ≥ 12: add --allow-remote=all
codex-kaboo login --token <token>
codex-kaboo install
codex-kaboo status
```

`<origin>` = `window.location.origin` in the UI. CLI build-time env: `CODEX_KABOO_SERVER`
(required, the `.convex.site` origin), `CODEX_KABOO_WEB_ORIGIN` (optional, for the upgrade hint).
Packed artifact: `web/public/cli/codex-kaboo-cli.tgz` + `web/public/cli/codex-kaboo-cli-<version>.tgz`
+ `web/public/cli/version.json` = `{ "version": "<v>", "builtAt": "<iso>", "commit": "<sha7>" }`.
CLI version string: `<package.json version>-build.<yyyymmddHHmm>.<sha7>` when packed by
`pack-cli.mjs`, plain `<package.json version>` in local builds.

## 11. Identity, auth and environment names

| Name | Where | Value |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | web | injected by `npx convex dev` (.env.local) / `npx convex deploy` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | web | from Clerk |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | web | `/sign-in` |
| `CLERK_FRONTEND_API_URL` | Convex env | `https://<slug>.clerk.accounts.dev` (`auth.config.ts` domain) |
| `LATEST_CLI_VERSION` | Convex env | set by `pack-cli.mjs` at deploy |
| `CONVEX_DEPLOY_KEY` | Vercel | production deploy key |
| `CODEX_KABOO_SERVER`, `CODEX_KABOO_WEB_ORIGIN` | Vercel (build) | baked into the CLI |
| `CODEX_KABOO_HOME` | CLI runtime | overrides `~/.codex-kaboo` |
| `CODEX_HOME` | CLI runtime | overrides `~/.codex` |

Public web routes (Clerk proxy): `/sign-in(.*)`, `/sign-up(.*)`, `/cli/(.*)`. Everything else
requires a signed-in Clerk user.
