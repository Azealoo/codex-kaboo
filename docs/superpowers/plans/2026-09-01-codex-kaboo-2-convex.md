# codex-kaboo Convex Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Convex backend under `web/convex/`: schema, the `/api/v1/sync` ingest pipeline with deterministic daily rollups, every dashboard query listed in the contracts, sync-token/machine/price management, and a dev deployment that the Plan 1 CLI syncs real data into.

**Architecture:** An HTTP action authenticates a bearer sync token (sha256 lookup), validates the batch with the shared zod schema, and drives internal mutations that idempotently upsert `sessions` (by `sessionId`) and `tokenEvents` (by `sessionId+seq`), then recompute the touched `dailyRollups` inside the same mutation. Dashboard queries only ever read rollups (team scope via `by_day`, user scope via `by_user_day`), fold them with pure helpers in `lib/aggregate.ts`, and price them at query time from `modelPrices`. Public functions are wrapped by `authedQuery`/`authedMutation` (Clerk identity → `users` row); internal functions are unreachable from clients.

**Tech Stack:** Convex 1.45 (default runtime, no `"use node"` anywhere), convex-helpers (`customQuery`/`customMutation`), convex-test + vitest 4 in the `edge-runtime` environment, zod 4 via `shared/src/sync.ts`, TypeScript 5.9.

**Spec:** `docs/superpowers/specs/2026-09-01-codex-kaboo-design.md` (sections "Metric definitions", "Seed price table", "Convex data model", "Functions", "Sync protocol", phase 4 of "Implementation phases", "Verification"). **Contracts (binding, win over the spec):** `docs/superpowers/plans/2026-09-01-codex-kaboo-0-contracts.md` §1 (tooling and test commands), §2–§5 (shared code this plan imports), §6 (summary hash), §7 (HTTP protocol), §8 (data-model additions), §9 (public API result types and the function table).

## Global Constraints

- Prerequisites from Plan 1 (assumed present, never redone here): npm workspaces root; `web/` Next scaffold with `convex`, `convex-helpers`, `convex-test`, `@edge-runtime/vm`, `vitest` installed; `web/vitest.config.ts` with a `convex` project (`environment: "edge-runtime"`, include `convex/**/*.test.ts`, `server.deps.inline: ["convex-test"]`); `web/convex/tsconfig.json` from `npx convex codegen --init`; `shared/src/{constants,sync,days,metrics,index}.ts` exactly as contracts §2–§5.
- Import paths: from `web/convex/*.ts` shared code is `../../shared/src/<file>`; from `web/convex/lib/*.ts` it is `../../../shared/src/<file>`. Generated code is `./_generated/*` and `../_generated/*` respectively. Never import via `@codex-kaboo/shared` or `@shared/*` inside `web/convex/`.
- Convex field names are ASCII identifiers: every keyed sub-aggregate is an array of `{ key: string, … }`. Enum-like strings (`source`, `originator`, `effort`, tool kinds) are `v.string()`.
- Limits (contracts §2): body ≤ 8 MiB (`MAX_BODY_BYTES`), ≤ 500 sessions and ≤ 5,000 events per request, 200 sessions / 1,000 events per mutation, ≤ 30 distinct days per chunk (`MAX_DAYS_PER_EVENT_CHUNK`, applied to both the session and the event chunker), rollup arrays capped at 100 entries with an `"(other)"` fold.
- Queries never call `Date.now()`; mutations, actions and HTTP actions may. Query results carry only day strings and Unix-ms numbers.
- Sub-agent rule (refines the spec): sub-agent sessions contribute tokens (`tokens`, `subagentTokens`, `subagentSessions`, `byModel`, `byHour`, `byProject.tokens/responses`) and, in `byMachine` and `bySource` only, both `tokens` **and** `sessions` — a sub-agent session is a real session of its machine and its source. The top-level `sessions`, `turns`, messages, tools, skills, lines, compactions, active/wall time and TTFT exclude them.
- Privacy: the server stores exactly the fields in `schema.ts`; unknown keys are stripped by zod before any mutation runs.
- Every commit message ends with the two trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt`.
- Test commands (from the repo root): `npm run test -w web -- --project convex` runs the whole convex suite; a single file is `cd web && npx vitest run --project convex convex/<file>.test.ts`. Typecheck: `npm run typecheck -w web` (runs `convex codegen` then `tsc --noEmit`).
- Test files live next to the code as `web/convex/**/*.test.ts` and the helper is `web/convex/test.helpers.ts`: the Convex bundler skips any file whose basename contains more than one dot (verified in the Convex CLI 1.45 bundler source), so neither is deployed.

---

## File map

| File | Responsibility |
|---|---|
| `web/convex/lib/types.ts` | Result types of every public function (contracts §9, verbatim) |
| `web/convex/lib/validators.ts` | Convex validators mirroring `shared/src/sync.ts` plus rollup sub-aggregate validators |
| `web/convex/schema.ts` | Tables and indexes |
| `web/convex/auth.config.ts` | Clerk JWT provider |
| `web/convex/lib/hash.ts` | sha256 hex, base64url, token generation/prefix, bearer parsing |
| `web/convex/lib/constants.ts` | Server-only constants, `LIMITS`, `latestCliVersion()` |
| `web/convex/lib/days.ts` | Range validation and previous-period resolution |
| `web/convex/lib/cost.ts` | Price map loading and cost folding |
| `web/convex/lib/aggregate.ts` | `computeDayRollup`, `mergeRollups`, the `Rollup`/`Aggregate` types |
| `web/convex/lib/auth.ts` | `requireUser`, `authedQuery`, `authedMutation` |
| `web/convex/test.helpers.ts` | convex-test harness, identities, fixture builders, `postSync` |
| `web/convex/users.ts` | `ensure`, `me`, `list` |
| `web/convex/syncTokens.ts` | `list`, `create`, `revoke`, internal `insert`, `lookupByHash`, `touchLastUsed` |
| `web/convex/rollups.ts` | `recomputeDay`, `recomputeDays`, `rebuildAll` |
| `web/convex/ingest.ts` | HTTP handlers and the four internal upsert mutations |
| `web/convex/http.ts` | Router |
| `web/convex/stats.ts` | `summary`, `leaderboard`, `trends`, `breakdowns`, `activityHeatmap`, `dayHourHeatmap`, `quota`, `bounds` |
| `web/convex/sessions.ts` | `listRecent`, `get` |
| `web/convex/machines.ts` | `list`, `rename` |
| `web/convex/prices.ts` | `list`, `upsert`, `remove`, `seed`, `SEED_PRICES` |

---

### Task 1: Result types, validators, schema and auth config

**Files:**
- Create: `web/convex/lib/types.ts`
- Create: `web/convex/lib/validators.ts`
- Create: `web/convex/schema.ts`
- Create: `web/convex/auth.config.ts`
- Create: `web/convex/test.helpers.ts` (harness only; later tasks add builders)
- Test: `web/convex/schema.test.ts`

**Interfaces:**
- Consumes: `Tokens`, `ToolCounts` types from `shared/src/sync.ts`.
- Produces: `Doc<"users" | "syncTokens" | "machines" | "sessions" | "tokenEvents" | "dailyRollups" | "modelPrices">` via codegen; `sessionSummaryFields`, `tokenEventFields`, `dailyRollupFields`, `machineInfoValidator`, `rateLimitSnapshotValidator`, `rateLimitValidator`, `tokensValidator`, `toolCountsValidator`, `keyCountValidator`, `ttftValidator`, `rollupModelValidator`, `rollupSkillValidator`, `rollupProjectValidator`, `rollupTokensSessionsValidator`; every type in contracts §9; `setup(): TestConvex` and `modules` from `test.helpers.ts`.

- [ ] **Step 1: Create `web/convex/lib/types.ts` (verbatim copy of contracts §9)**

This file is the binding result-type contract consumed by the web app (Plan 3). Do not rename, reorder or add fields.

```ts
// web/convex/lib/types.ts
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

- [ ] **Step 2: Write the failing schema test**

```ts
// web/convex/schema.test.ts
import { describe, expect, it } from "vitest";
import { modules, setup } from "./test.helpers";

describe("schema", () => {
  it("stores a user and finds it through by_clerkId", async () => {
    const t = setup();
    const id = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        clerkId: "user_alice",
        tokenIdentifier: "https://clerk.example|user_alice",
        name: "Alice",
        createdAt: 1_700_000_000_000,
        lastSeenAt: 1_700_000_000_000,
      }),
    );
    const found = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", "user_alice"))
        .unique(),
    );
    expect(found?._id).toBe(id);
  });

  it("rejects a session document that misses required fields", async () => {
    const t = setup();
    await expect(
      t.run(async (ctx) => ctx.db.insert("sessions", { sessionId: "only-id" } as never)),
    ).rejects.toThrow();
  });

  it("enumerates the convex modules for convex-test", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run --project convex convex/schema.test.ts`
Expected: FAIL — `Cannot find module './test.helpers'` (and `./schema`).

- [ ] **Step 4: Create `web/convex/lib/validators.ts`**

```ts
import { v } from "convex/values";

export const tokensValidator = v.object({
  input: v.number(),
  cachedInput: v.number(),
  cacheWrite: v.number(),
  output: v.number(),
  reasoning: v.number(),
  total: v.number(),
});

export const toolCountsValidator = v.object({
  commandRead: v.number(),
  commandList: v.number(),
  commandSearch: v.number(),
  commandOther: v.number(),
  fileChange: v.number(),
  webSearch: v.number(),
  imageView: v.number(),
  mcpTool: v.number(),
  other: v.number(),
});

export const keyCountValidator = v.object({ key: v.string(), count: v.number() });

export const ttftValidator = v.object({
  count: v.number(),
  sumMs: v.number(),
  hist: v.array(v.number()),
});

// Snapshot exactly as the CLI sends it (contracts §3 RateLimitSnapshot).
export const rateLimitSnapshotValidator = v.object({
  observedAt: v.number(),
  usedPercent: v.number(),
  windowMinutes: v.number(),
  resetsAt: v.optional(v.number()),
  planType: v.optional(v.string()),
  limitId: v.optional(v.string()),
});

// Stored on machines.lastRateLimit (contracts §8): the snapshot plus the server receive time.
export const rateLimitValidator = v.object({
  observedAt: v.number(),
  usedPercent: v.number(),
  windowMinutes: v.number(),
  resetsAt: v.optional(v.number()),
  planType: v.optional(v.string()),
  limitId: v.optional(v.string()),
  receivedAt: v.number(),
});

export const machineInfoValidator = v.object({
  machineId: v.string(),
  label: v.string(),
  platform: v.string(),
  arch: v.optional(v.string()),
  nodeVersion: v.optional(v.string()),
  codexVersion: v.optional(v.string()),
  codexLatestVersion: v.optional(v.string()),
  hostname: v.optional(v.union(v.string(), v.null())),
  tz: v.optional(v.string()),
});

// SessionSummary (contracts §3). The sessions table adds userId, machineId and syncedAt.
export const sessionSummaryFields = {
  sessionId: v.string(),
  threadId: v.string(),
  parentThreadId: v.optional(v.string()),
  startedAt: v.number(),
  endedAt: v.number(),
  wallMs: v.number(),
  day: v.string(),
  timezone: v.optional(v.string()),
  project: v.string(),
  gitBranch: v.optional(v.string()),
  originator: v.string(),
  source: v.string(),
  isSubagent: v.boolean(),
  model: v.string(),
  effort: v.optional(v.string()),
  cliVersion: v.optional(v.string()),
  turns: v.number(),
  completedTurns: v.number(),
  userMessages: v.number(),
  agentMessages: v.number(),
  reasoningItems: v.number(),
  toolCounts: toolCountsValidator,
  mcpTools: v.array(keyCountValidator),
  skills: v.array(keyCountValidator),
  linesAdded: v.number(),
  linesRemoved: v.number(),
  filesChanged: v.number(),
  compactions: v.number(),
  activeMs: v.number(),
  ttft: ttftValidator,
  tokens: tokensValidator,
  responses: v.number(),
  inProgress: v.boolean(),
  lineCount: v.number(),
  generation: v.number(),
  parseErrors: v.number(),
  parserVersion: v.number(),
  summaryHash: v.string(),
};

// TokenEvent (contracts §3). The tokenEvents table adds userId.
export const tokenEventFields = {
  sessionId: v.string(),
  seq: v.number(),
  ts: v.number(),
  day: v.string(),
  hour: v.number(),
  model: v.string(),
  effort: v.optional(v.string()),
  turnId: v.optional(v.string()),
  project: v.string(),
  isSubagent: v.boolean(),
  input: v.number(),
  cachedInput: v.number(),
  cacheWrite: v.number(),
  output: v.number(),
  reasoning: v.number(),
  total: v.number(),
  contextWindow: v.optional(v.number()),
};

// dailyRollups sub-aggregates. Every keyed array carries `key` (contracts §8).
export const rollupModelValidator = v.object({
  key: v.string(), // model
  effort: v.optional(v.string()),
  tokens: tokensValidator,
  responses: v.number(),
});
export const rollupSkillValidator = v.object({
  key: v.string(),
  count: v.number(),
  sessions: v.number(),
});
export const rollupProjectValidator = v.object({
  key: v.string(),
  tokens: v.number(),
  responses: v.number(),
  sessions: v.number(),
  userMessages: v.number(),
  linesAdded: v.number(),
  linesRemoved: v.number(),
});
export const rollupTokensSessionsValidator = v.object({
  key: v.string(),
  tokens: v.number(),
  sessions: v.number(),
});

export const dailyRollupFields = {
  userId: v.id("users"),
  day: v.string(),
  version: v.number(),
  computedAt: v.number(),
  tokens: tokensValidator,
  responses: v.number(),
  subagentTokens: tokensValidator,
  sessions: v.number(),
  subagentSessions: v.number(),
  turns: v.number(),
  userMessages: v.number(),
  agentMessages: v.number(),
  linesAdded: v.number(),
  linesRemoved: v.number(),
  filesChanged: v.number(),
  compactions: v.number(),
  activeMs: v.number(),
  wallMs: v.number(),
  ttft: ttftValidator,
  byHour: v.array(v.number()),
  byModel: v.array(rollupModelValidator),
  byTool: v.array(keyCountValidator),
  byMcpTool: v.array(keyCountValidator),
  bySkill: v.array(rollupSkillValidator),
  byProject: v.array(rollupProjectValidator),
  byMachine: v.array(rollupTokensSessionsValidator),
  bySource: v.array(rollupTokensSessionsValidator),
};
```

- [ ] **Step 5: Create `web/convex/schema.ts`**

```ts
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
```

- [ ] **Step 6: Create `web/convex/auth.config.ts`**

```ts
import type { AuthConfig } from "convex/server";

// CLERK_FRONTEND_API_URL must be set on the deployment (`npx convex env set CLERK_FRONTEND_API_URL
// https://<slug>.clerk.accounts.dev`) before `npx convex dev` / `npx convex deploy` pushes this file;
// Convex refuses to push an auth config whose env var is unset. convex-test ignores this file.
export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
```

- [ ] **Step 7: Create the harness in `web/convex/test.helpers.ts`**

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "./schema";

// Every module under convex/ (tests included; convex-test only loads what a function reference needs).
export const modules = import.meta.glob("./**/*.*s");

export function setup() {
  return convexTest(schema, modules);
}
export type Harness = ReturnType<typeof setup>;
```

- [ ] **Step 8: Generate types and run the test**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/schema.test.ts`
Expected: codegen writes `convex/_generated/{api,dataModel,server}.{d.ts,js}`; 3 tests PASS.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck -w web`
Expected: exit 0 (no output from tsc).

- [ ] **Step 10: Commit**

```bash
git add web/convex/lib/types.ts web/convex/lib/validators.ts web/convex/schema.ts web/convex/auth.config.ts web/convex/test.helpers.ts web/convex/schema.test.ts
git commit -m "Add Convex schema, validators, result types and auth config

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

### Task 2: Hashing and token helpers (`lib/hash.ts`)

**Files:**
- Create: `web/convex/lib/hash.ts`
- Test: `web/convex/lib/hash.test.ts`

**Interfaces:**
- Consumes: `TOKEN_PREFIX` from `shared/src/constants.ts`; Web Crypto (`crypto.subtle.digest`, `crypto.getRandomValues`) and `btoa`, both available in the Convex runtime and in `edge-runtime`.
- Produces: `bytesToHex(bytes: Uint8Array): string`, `sha256Hex(text: string): Promise<string>`, `base64Url(bytes: Uint8Array): string`, `generateRawToken(): string`, `PREFIX_LENGTH: number`, `tokenPrefix(raw: string): string`, `parseBearer(header: string | null): string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/lib/hash.test.ts
import { describe, expect, it } from "vitest";
import {
  base64Url,
  bytesToHex,
  generateRawToken,
  parseBearer,
  sha256Hex,
  tokenPrefix,
} from "./hash";

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("matches the known digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("bytesToHex", () => {
  it("zero-pads every byte", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });
});

describe("base64Url", () => {
  it("uses the url alphabet and strips padding", () => {
    expect(base64Url(new Uint8Array([251, 255, 191]))).toBe("-_-_");
    expect(base64Url(new Uint8Array([1]))).toBe("AQ");
  });
});

describe("generateRawToken / tokenPrefix", () => {
  it("produces ck_ tokens of 43 url-safe characters that differ per call", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).toMatch(/^ck_[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^ck_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it("keeps the prefix plus six characters", () => {
    expect(tokenPrefix("ck_abcdefXYZ123")).toBe("ck_abcdef");
  });
});

describe("parseBearer", () => {
  it("extracts the token case-insensitively", () => {
    expect(parseBearer("Bearer ck_abc")).toBe("ck_abc");
    expect(parseBearer("bearer ck_abc")).toBe("ck_abc");
    expect(parseBearer("  Bearer   ck_abc  ")).toBe("ck_abc");
  });
  it("rejects other schemes and malformed headers", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic ck_abc")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer a b")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/lib/hash.test.ts`
Expected: FAIL — `Cannot find module './hash'`.

- [ ] **Step 3: Create `web/convex/lib/hash.ts`**

```ts
import { TOKEN_PREFIX } from "../../../shared/src/constants";

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `ck_` + base64url of 32 random bytes (43 characters). Returned to the user exactly once. */
export function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return TOKEN_PREFIX + base64Url(bytes);
}

export const PREFIX_LENGTH = TOKEN_PREFIX.length + 6;

/** Display prefix stored next to the hash, e.g. `ck_3f9a1c`. */
export function tokenPrefix(raw: string): string {
  return raw.slice(0, PREFIX_LENGTH);
}

export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run --project convex convex/lib/hash.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/lib/hash.ts web/convex/lib/hash.test.ts
git commit -m "Add sha256, token generation and bearer parsing helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 3: Server constants and range validation (`lib/constants.ts`, `lib/days.ts`)

**Files:**
- Create: `web/convex/lib/constants.ts`
- Create: `web/convex/lib/days.ts`
- Test: `web/convex/lib/constants.test.ts`
- Test: `web/convex/lib/days.test.ts`

**Interfaces:**
- Consumes: `MAX_BODY_BYTES`, `MAX_EVENTS_PER_REQUEST`, `MAX_SESSIONS_PER_REQUEST`, `MAX_QUERY_RANGE_DAYS` from `shared/src/constants.ts`; `SyncLimits` from `shared/src/sync.ts`; `isValidDay`, `compareDays`, `daysBetween`, `previousPeriod`, `addDays` from `shared/src/days.ts`; `Range` from `lib/types.ts`.
- Produces: `TOKEN_LAST_USED_THROTTLE_MS = 60_000`, `REBUILD_PAGE_SIZE = 20`, `LIMITS: SyncLimits`, `latestCliVersion(): string | null`, `assertRange(from, to): Range` (throws `ConvexError({ code: "bad_range", from, to })`), `resolvePeriods(from, to, previous?: boolean): { range: Range; previousRange: Range | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/lib/constants.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS, latestCliVersion } from "./constants";

afterEach(() => vi.unstubAllEnvs());

describe("LIMITS", () => {
  it("advertises the shared request limits", () => {
    expect(LIMITS).toEqual({ maxBodyBytes: 8 * 1024 * 1024, maxSessions: 500, maxEvents: 5000 });
  });
});

describe("latestCliVersion", () => {
  it("reads LATEST_CLI_VERSION from the environment", () => {
    vi.stubEnv("LATEST_CLI_VERSION", "0.1.0-build.202609011200.abc1234");
    expect(latestCliVersion()).toBe("0.1.0-build.202609011200.abc1234");
  });
  it("returns null when unset or empty", () => {
    vi.stubEnv("LATEST_CLI_VERSION", "");
    expect(latestCliVersion()).toBeNull();
  });
});
```

```ts
// web/convex/lib/days.test.ts
import { describe, expect, it } from "vitest";
import { addDays } from "../../../shared/src/days";
import { assertRange, resolvePeriods } from "./days";

describe("assertRange", () => {
  it("accepts an inclusive range and returns it", () => {
    expect(assertRange("2026-08-03", "2026-09-01")).toEqual({ from: "2026-08-03", to: "2026-09-01" });
  });
  it("rejects invalid days, reversed ranges and spans over 1100 days", () => {
    expect(() => assertRange("2026-02-30", "2026-03-01")).toThrow();
    expect(() => assertRange("2026-03-02", "2026-03-01")).toThrow();
    expect(() => assertRange("2020-01-01", addDays("2020-01-01", 1099))).not.toThrow();
    expect(() => assertRange("2020-01-01", addDays("2020-01-01", 1100))).toThrow();
  });
  it("reports code bad_range with the offending days", () => {
    try {
      assertRange("bogus", "2026-03-01");
      expect.unreachable("assertRange must throw");
    } catch (error) {
      expect((error as { data: unknown }).data).toEqual({
        code: "bad_range",
        from: "bogus",
        to: "2026-03-01",
      });
    }
  });
});

describe("resolvePeriods", () => {
  it("computes the previous period of equal length ending the day before `from`", () => {
    expect(resolvePeriods("2026-03-01", "2026-03-07", undefined)).toEqual({
      range: { from: "2026-03-01", to: "2026-03-07" },
      previousRange: { from: "2026-02-22", to: "2026-02-28" },
    });
  });
  it("handles the leap day and year boundaries", () => {
    expect(resolvePeriods("2024-03-01", "2024-03-01", true).previousRange).toEqual({
      from: "2024-02-29",
      to: "2024-02-29",
    });
    expect(resolvePeriods("2026-01-01", "2026-01-31", true).previousRange).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
  it("omits the previous period when previous is false", () => {
    expect(resolvePeriods("2026-03-01", "2026-03-07", false).previousRange).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/lib/constants.test.ts convex/lib/days.test.ts`
Expected: FAIL — `Cannot find module './constants'` and `'./days'`.

- [ ] **Step 3: Create `web/convex/lib/constants.ts`**

```ts
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
```

- [ ] **Step 4: Create `web/convex/lib/days.ts`**

```ts
import { ConvexError } from "convex/values";
import { MAX_QUERY_RANGE_DAYS } from "../../../shared/src/constants";
import { compareDays, daysBetween, isValidDay, previousPeriod } from "../../../shared/src/days";
import type { Range } from "./types";

/** Inclusive day range validation shared by every stats query. */
export function assertRange(from: string, to: string): Range {
  if (
    !isValidDay(from) ||
    !isValidDay(to) ||
    compareDays(from, to) > 0 ||
    daysBetween(from, to) > MAX_QUERY_RANGE_DAYS
  ) {
    throw new ConvexError({ code: "bad_range", from, to });
  }
  return { from, to };
}

/** `previous` defaults to true; the UI passes false for the ALL preset. */
export function resolvePeriods(
  from: string,
  to: string,
  previous: boolean | undefined,
): { range: Range; previousRange: Range | null } {
  const range = assertRange(from, to);
  return { range, previousRange: previous === false ? null : previousPeriod(from, to) };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run --project convex convex/lib/constants.test.ts convex/lib/days.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/convex/lib/constants.ts web/convex/lib/days.ts web/convex/lib/constants.test.ts web/convex/lib/days.test.ts
git commit -m "Add server constants and stats range validation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 4: Cost folding (`lib/cost.ts`)

**Files:**
- Create: `web/convex/lib/cost.ts`
- Test: `web/convex/lib/cost.test.ts`

**Interfaces:**
- Consumes: `costOf(tokens, price): CostBreakdown`, `cacheSavings(tokens, price): number`, `ModelPrice`, `CostBreakdown` from `shared/src/metrics.ts`; `Tokens` from `shared/src/sync.ts`; `CostByKind` from `lib/types.ts`; `QueryCtx` from `_generated/server`.
- Produces: `PriceMap = Map<string, ModelPrice>`, `loadPriceMap(ctx: QueryCtx): Promise<PriceMap>`, `priceTokens(model, tokens, prices): CostBreakdown | null`, `CostSummary = { totalUsd; byKind: CostByKind; cacheSavingsUsd; unpricedModels: string[] }`, `sumCost(byModel: { key: string; tokens: Tokens }[], prices: PriceMap): CostSummary`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/lib/cost.test.ts
import { describe, expect, it } from "vitest";
import type { ModelPrice } from "../../../shared/src/metrics";
import type { Tokens } from "../../../shared/src/sync";
import { setup } from "../test.helpers";
import { loadPriceMap, priceTokens, sumCost, type PriceMap } from "./cost";

const sol: ModelPrice = { inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10 };
const tokens: Tokens = {
  input: 1_000_000,
  cachedInput: 400_000,
  cacheWrite: 0,
  output: 100_000,
  reasoning: 20_000,
  total: 1_100_000,
};

describe("priceTokens", () => {
  it("splits cost into input, cached, output and reasoning", () => {
    const prices: PriceMap = new Map([["gpt-5.6-sol", sol]]);
    const cost = priceTokens("gpt-5.6-sol", tokens, prices);
    expect(cost?.input).toBeCloseTo(1.2, 10);
    expect(cost?.cached).toBeCloseTo(0.08, 10);
    expect(cost?.output).toBeCloseTo(0.8, 10);
    expect(cost?.reasoning).toBeCloseTo(0.2, 10);
    expect(cost?.total).toBeCloseTo(2.28, 10);
  });
  it("returns null for an unpriced model", () => {
    expect(priceTokens("codex-auto-review", tokens, new Map())).toBeNull();
  });
});

describe("sumCost", () => {
  it("adds priced models, flags unpriced ones and reports cache savings", () => {
    const prices: PriceMap = new Map([["gpt-5.6-sol", sol]]);
    const summary = sumCost(
      [
        { key: "gpt-5.6-sol", tokens },
        { key: "codex-auto-review", tokens: { ...tokens, total: 5 } },
        { key: "gpt-5.6-luna", tokens: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 } },
      ],
      prices,
    );
    expect(summary.totalUsd).toBeCloseTo(2.28, 10);
    expect(summary.byKind.input).toBeCloseTo(1.2, 10);
    expect(summary.byKind.reasoning).toBeCloseTo(0.2, 10);
    expect(summary.cacheSavingsUsd).toBeCloseTo(0.72, 10);
    expect(summary.unpricedModels).toEqual(["codex-auto-review"]);
  });
  it("is zero for no models", () => {
    expect(sumCost([], new Map())).toEqual({
      totalUsd: 0,
      byKind: { input: 0, cached: 0, output: 0, reasoning: 0 },
      cacheSavingsUsd: 0,
      unpricedModels: [],
    });
  });
});

describe("loadPriceMap", () => {
  it("reads every modelPrices row into a map", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("modelPrices", {
        model: "gpt-5.6-sol",
        inputUsdPerMTok: 2,
        cachedInputUsdPerMTok: 0.2,
        outputUsdPerMTok: 10,
        source: "seed",
        updatedAt: 1,
      });
    });
    const entries = await t.run(async (ctx) => [...(await loadPriceMap(ctx)).entries()]);
    expect(entries).toEqual([["gpt-5.6-sol", sol]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/lib/cost.test.ts`
Expected: FAIL — `Cannot find module './cost'`.

- [ ] **Step 3: Create `web/convex/lib/cost.ts`**

```ts
import { cacheSavings, costOf, type CostBreakdown, type ModelPrice } from "../../../shared/src/metrics";
import type { Tokens } from "../../../shared/src/sync";
import type { QueryCtx } from "../_generated/server";
import type { CostByKind } from "./types";

export type PriceMap = Map<string, ModelPrice>;

/** Loads every price row once per query (≤ a few dozen documents). */
export async function loadPriceMap(ctx: QueryCtx): Promise<PriceMap> {
  const rows = await ctx.db.query("modelPrices").collect();
  return new Map(
    rows.map((row) => [
      row.model,
      {
        inputUsdPerMTok: row.inputUsdPerMTok,
        cachedInputUsdPerMTok: row.cachedInputUsdPerMTok,
        outputUsdPerMTok: row.outputUsdPerMTok,
      },
    ]),
  );
}

/** Exact-model pricing; `null` means "unpriced" (contracts §9 cost rules). */
export function priceTokens(model: string, tokens: Tokens, prices: PriceMap): CostBreakdown | null {
  const price = prices.get(model);
  return price ? costOf(tokens, price) : null;
}

export type CostSummary = {
  totalUsd: number;
  byKind: CostByKind;
  cacheSavingsUsd: number;
  unpricedModels: string[];
};

/** Folds a by-model token list into cost; unpriced models contribute 0 and are listed (sorted). */
export function sumCost(byModel: { key: string; tokens: Tokens }[], prices: PriceMap): CostSummary {
  const byKind: CostByKind = { input: 0, cached: 0, output: 0, reasoning: 0 };
  let cacheSavingsUsd = 0;
  const unpriced = new Set<string>();
  for (const entry of byModel) {
    const price = prices.get(entry.key);
    if (!price) {
      if (entry.tokens.total > 0) unpriced.add(entry.key);
      continue;
    }
    const cost = costOf(entry.tokens, price);
    byKind.input += cost.input;
    byKind.cached += cost.cached;
    byKind.output += cost.output;
    byKind.reasoning += cost.reasoning;
    cacheSavingsUsd += cacheSavings(entry.tokens, price);
  }
  return {
    totalUsd: byKind.input + byKind.cached + byKind.output + byKind.reasoning,
    byKind,
    cacheSavingsUsd,
    unpricedModels: [...unpriced].sort(),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run --project convex convex/lib/cost.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/lib/cost.ts web/convex/lib/cost.test.ts
git commit -m "Add query-time cost folding over the price table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 5: Pure daily rollup computation (`lib/aggregate.ts` — `computeDayRollup`)

**Files:**
- Create: `web/convex/lib/aggregate.ts`
- Test: `web/convex/lib/aggregate.test.ts`

**Interfaces:**
- Consumes: `MAX_ROLLUP_ENTRIES`, `OTHER_KEY`, `ROLLUP_VERSION`, `TOOL_KINDS` from `shared/src/constants.ts`; `addTokens`, `addTtft`, `emptyTokens`, `emptyTtft` from `shared/src/metrics.ts`; `KeyCount`, `Tokens`, `ToolCounts`, `Ttft` from `shared/src/sync.ts`; `Id` from `_generated/dataModel`.
- Produces: types `RollupModel`, `RollupKeyCount`, `RollupSkill`, `RollupProject`, `RollupTokensSessions`, `RollupBody`, `Rollup` (= `RollupBody & { userId: Id<"users">; day: string; version: number; computedAt: number }`, structurally identical to a `dailyRollups` document without system fields), `EventInput`, `SessionInput`; functions `compareEntries`, `capEntries`, `emptyRollupBody(): RollupBody`, `computeDayRollup(userId: Id<"users">, day: string, events: EventInput[], sessions: SessionInput[], computedAt: number): Rollup`; class `Collector` (reused by `mergeRollups` in Task 6). A `Doc<"tokenEvents">` is assignable to `EventInput` and a `Doc<"sessions">` to `SessionInput`.

Attribution rules implemented here (spec "Convex data model" + Global Constraints sub-agent rule):
- From events: `tokens`, `subagentTokens` (events with `isSubagent`), `responses`, `byHour[hour] += total`, `byModel` at `(model, effort)` grain, `byProject.tokens/responses`.
- From every session (sub-agents included): `byMachine.tokens/sessions`, `bySource.tokens/sessions`, `subagentSessions`.
- From non-sub-agent sessions only: `sessions`, `turns`, `userMessages`, `agentMessages`, `linesAdded`, `linesRemoved`, `filesChanged`, `compactions`, `activeMs`, `wallMs`, `ttft`, `byTool`, `byMcpTool`, `bySkill` (`count` += entry count, `sessions` += 1 per session that used it), `byProject.sessions/userMessages/linesAdded/linesRemoved`.
- Every array is sorted by `key` (then `effort`) with plain code-unit comparison and capped at 100 entries, folding the lowest-ranked remainder into `"(other)"`. `byTool` always holds all nine tool kinds.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/lib/aggregate.test.ts
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { Ttft } from "../../../shared/src/sync";
import {
  computeDayRollup,
  emptyRollupBody,
  type EventInput,
  type SessionInput,
} from "./aggregate";

const userId = "users|alice" as Id<"users">;
const DAY = "2026-08-31";
const AT = 1_756_700_000_000;

function hist(...indexes: number[]): Ttft["hist"] {
  const h = new Array<number>(16).fill(0);
  for (const i of indexes) h[i] = (h[i] ?? 0) + 1;
  return h;
}
const zeroTools = {
  commandRead: 0,
  commandList: 0,
  commandSearch: 0,
  commandOther: 0,
  fileChange: 0,
  webSearch: 0,
  imageView: 0,
  mcpTool: 0,
  other: 0,
};

const events: EventInput[] = [
  { hour: 9, model: "gpt-5.6-sol", effort: "medium", project: "alpha", isSubagent: false, input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200 },
  { hour: 9, model: "gpt-5.6-sol", effort: "medium", project: "alpha", isSubagent: false, input: 500, cachedInput: 100, cacheWrite: 10, output: 100, reasoning: 0, total: 600 },
  { hour: 23, model: "gpt-5.6-luna", effort: "low", project: "beta", isSubagent: false, input: 300, cachedInput: 0, cacheWrite: 0, output: 30, reasoning: 0, total: 330 },
  { hour: 10, model: "codex-auto-review", project: "alpha", isSubagent: true, input: 700, cachedInput: 700, cacheWrite: 0, output: 70, reasoning: 70, total: 770 },
];

const sessions: SessionInput[] = [
  {
    machineId: "m1", project: "alpha", source: "cli", isSubagent: false,
    turns: 2, userMessages: 2, agentMessages: 3, linesAdded: 10, linesRemoved: 2, filesChanged: 1, compactions: 1,
    activeMs: 600_000, wallMs: 3_600_000, ttft: { count: 2, sumMs: 1500, hist: hist(1, 3) },
    toolCounts: { ...zeroTools, commandRead: 3, commandList: 1, commandOther: 2, fileChange: 1, mcpTool: 1 },
    mcpTools: [{ key: "context7/query-docs", count: 1 }],
    skills: [{ key: "dataviz", count: 2 }],
    tokens: { input: 1500, cachedInput: 500, cacheWrite: 10, output: 300, reasoning: 50, total: 1800 },
  },
  {
    machineId: "m2", project: "beta", source: "exec", isSubagent: false,
    turns: 1, userMessages: 1, agentMessages: 1, linesAdded: 0, linesRemoved: 0, filesChanged: 0, compactions: 0,
    activeMs: 120_000, wallMs: 300_000, ttft: { count: 1, sumMs: 250, hist: hist(0) },
    toolCounts: { ...zeroTools, commandRead: 1 },
    mcpTools: [],
    skills: [{ key: "dataviz", count: 1 }, { key: "brainstorming", count: 1 }],
    tokens: { input: 300, cachedInput: 0, cacheWrite: 0, output: 30, reasoning: 0, total: 330 },
  },
  {
    machineId: "m1", project: "alpha", source: "subagent:review", isSubagent: true,
    turns: 1, userMessages: 0, agentMessages: 1, linesAdded: 5, linesRemoved: 5, filesChanged: 1, compactions: 0,
    activeMs: 60_000, wallMs: 60_000, ttft: { count: 1, sumMs: 100, hist: hist(0) },
    toolCounts: { ...zeroTools, commandRead: 4 },
    mcpTools: [],
    skills: [],
    tokens: { input: 700, cachedInput: 700, cacheWrite: 0, output: 70, reasoning: 70, total: 770 },
  },
];

describe("computeDayRollup", () => {
  it("matches the hand-computed fixture", () => {
    const r = computeDayRollup(userId, DAY, events, sessions, AT);
    expect(r.userId).toBe(userId);
    expect(r.day).toBe(DAY);
    expect(r.version).toBe(1);
    expect(r.computedAt).toBe(AT);
    expect(r.tokens).toEqual({ input: 2500, cachedInput: 1200, cacheWrite: 10, output: 400, reasoning: 120, total: 2900 });
    expect(r.subagentTokens).toEqual({ input: 700, cachedInput: 700, cacheWrite: 0, output: 70, reasoning: 70, total: 770 });
    expect(r.responses).toBe(4);
    expect(r.sessions).toBe(2);
    expect(r.subagentSessions).toBe(1);
    expect(r.turns).toBe(3);
    expect(r.userMessages).toBe(3);
    expect(r.agentMessages).toBe(4);
    expect(r.linesAdded).toBe(10);
    expect(r.linesRemoved).toBe(2);
    expect(r.filesChanged).toBe(1);
    expect(r.compactions).toBe(1);
    expect(r.activeMs).toBe(720_000);
    expect(r.wallMs).toBe(3_900_000);
    expect(r.ttft).toEqual({ count: 3, sumMs: 1750, hist: hist(0, 1, 3) });
    const byHour = new Array<number>(24).fill(0);
    byHour[9] = 1800;
    byHour[10] = 770;
    byHour[23] = 330;
    expect(r.byHour).toEqual(byHour);
    expect(r.byModel).toEqual([
      { key: "codex-auto-review", tokens: { input: 700, cachedInput: 700, cacheWrite: 0, output: 70, reasoning: 70, total: 770 }, responses: 1 },
      { key: "gpt-5.6-luna", effort: "low", tokens: { input: 300, cachedInput: 0, cacheWrite: 0, output: 30, reasoning: 0, total: 330 }, responses: 1 },
      { key: "gpt-5.6-sol", effort: "medium", tokens: { input: 1500, cachedInput: 500, cacheWrite: 10, output: 300, reasoning: 50, total: 1800 }, responses: 2 },
    ]);
    expect(r.byTool).toEqual([
      { key: "commandList", count: 1 },
      { key: "commandOther", count: 2 },
      { key: "commandRead", count: 4 },
      { key: "commandSearch", count: 0 },
      { key: "fileChange", count: 1 },
      { key: "imageView", count: 0 },
      { key: "mcpTool", count: 1 },
      { key: "other", count: 0 },
      { key: "webSearch", count: 0 },
    ]);
    expect(r.byMcpTool).toEqual([{ key: "context7/query-docs", count: 1 }]);
    expect(r.bySkill).toEqual([
      { key: "brainstorming", count: 1, sessions: 1 },
      { key: "dataviz", count: 3, sessions: 2 },
    ]);
    expect(r.byProject).toEqual([
      { key: "alpha", tokens: 2570, responses: 3, sessions: 1, userMessages: 2, linesAdded: 10, linesRemoved: 2 },
      { key: "beta", tokens: 330, responses: 1, sessions: 1, userMessages: 1, linesAdded: 0, linesRemoved: 0 },
    ]);
    expect(r.byMachine).toEqual([
      { key: "m1", tokens: 2570, sessions: 2 },
      { key: "m2", tokens: 330, sessions: 1 },
    ]);
    expect(r.bySource).toEqual([
      { key: "cli", tokens: 1800, sessions: 1 },
      { key: "exec", tokens: 330, sessions: 1 },
      { key: "subagent:review", tokens: 770, sessions: 1 },
    ]);
  });

  it("is independent of input order", () => {
    const a = computeDayRollup(userId, DAY, events, sessions, AT);
    const b = computeDayRollup(userId, DAY, [...events].reverse(), [...sessions].reverse(), AT);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("produces the empty rollup for no data", () => {
    const r = computeDayRollup(userId, DAY, [], [], AT);
    expect(r).toEqual({ userId, day: DAY, version: 1, computedAt: AT, ...emptyRollupBody() });
    expect(r.byTool).toHaveLength(9);
    expect(r.byHour).toEqual(new Array(24).fill(0));
  });

  it("counts only tokens for sub-agent sessions", () => {
    const sub = sessions[2]!;
    const r = computeDayRollup(userId, DAY, [events[3]!], [sub], AT);
    expect(r.sessions).toBe(0);
    expect(r.subagentSessions).toBe(1);
    expect(r.turns).toBe(0);
    expect(r.linesAdded).toBe(0);
    expect(r.activeMs).toBe(0);
    expect(r.ttft.count).toBe(0);
    expect(r.byTool.every((t) => t.count === 0)).toBe(true);
    expect(r.tokens.total).toBe(770);
    expect(r.byMachine).toEqual([{ key: "m1", tokens: 770, sessions: 1 }]);
    expect(r.bySource).toEqual([{ key: "subagent:review", tokens: 770, sessions: 1 }]);
  });

  it("caps keyed arrays at 100 entries and folds the rest into (other)", () => {
    const mcpTools = Array.from({ length: 150 }, (_, i) => ({
      key: `mcp-${String(i + 1).padStart(3, "0")}`,
      count: i + 1,
    }));
    const r = computeDayRollup(userId, DAY, [], [{ ...sessions[1]!, mcpTools }], AT);
    expect(r.byMcpTool).toHaveLength(100);
    expect(r.byMcpTool[0]).toEqual({ key: "(other)", count: 1326 });
    expect(r.byMcpTool[1]).toEqual({ key: "mcp-052", count: 52 });
    expect(r.byMcpTool[99]).toEqual({ key: "mcp-150", count: 150 });
    const keys = r.byMcpTool.map((e) => e.key);
    expect([...keys].sort()).toEqual(keys);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/lib/aggregate.test.ts`
Expected: FAIL — `Cannot find module './aggregate'`.

- [ ] **Step 3: Create `web/convex/lib/aggregate.ts`**

```ts
import type { Id } from "../_generated/dataModel";
import {
  MAX_ROLLUP_ENTRIES,
  OTHER_KEY,
  ROLLUP_VERSION,
  TOOL_KINDS,
} from "../../../shared/src/constants";
import { addTokens, addTtft, emptyTokens, emptyTtft } from "../../../shared/src/metrics";
import type { KeyCount, Tokens, ToolCounts, Ttft } from "../../../shared/src/sync";

export type RollupModel = { key: string; effort?: string; tokens: Tokens; responses: number };
export type RollupKeyCount = { key: string; count: number };
export type RollupSkill = { key: string; count: number; sessions: number };
export type RollupProject = {
  key: string;
  tokens: number;
  responses: number;
  sessions: number;
  userMessages: number;
  linesAdded: number;
  linesRemoved: number;
};
export type RollupTokensSessions = { key: string; tokens: number; sessions: number };

export type RollupBody = {
  tokens: Tokens;
  responses: number;
  subagentTokens: Tokens;
  sessions: number;
  subagentSessions: number;
  turns: number;
  userMessages: number;
  agentMessages: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  compactions: number;
  activeMs: number;
  wallMs: number;
  ttft: Ttft;
  byHour: number[];
  byModel: RollupModel[];
  byTool: RollupKeyCount[];
  byMcpTool: RollupKeyCount[];
  bySkill: RollupSkill[];
  byProject: RollupProject[];
  byMachine: RollupTokensSessions[];
  bySource: RollupTokensSessions[];
};

/** A `dailyRollups` document without system fields. */
export type Rollup = RollupBody & {
  userId: Id<"users">;
  day: string;
  version: number;
  computedAt: number;
};

/** Subset of a tokenEvents document the rollup needs (a `Doc<"tokenEvents">` is assignable). */
export type EventInput = {
  hour: number;
  model: string;
  effort?: string;
  project: string;
  isSubagent: boolean;
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
};

/** Subset of a sessions document the rollup needs (a `Doc<"sessions">` is assignable). */
export type SessionInput = {
  machineId: string;
  project: string;
  source: string;
  isSubagent: boolean;
  turns: number;
  userMessages: number;
  agentMessages: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  compactions: number;
  activeMs: number;
  wallMs: number;
  ttft: Ttft;
  toolCounts: ToolCounts;
  mcpTools: KeyCount[];
  skills: KeyCount[];
  tokens: Tokens;
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Code-unit ordering by key, then effort — locale independent, hence byte-identical recomputes. */
export function compareEntries(
  a: { key: string; effort?: string },
  b: { key: string; effort?: string },
): number {
  return cmp(a.key, b.key) || cmp(a.effort ?? "", b.effort ?? "");
}

/**
 * Sorts entries by key and enforces MAX_ROLLUP_ENTRIES: when there are more, the highest-ranked
 * `MAX_ROLLUP_ENTRIES - 1` stay and the remainder is folded into one `OTHER_KEY` entry.
 */
export function capEntries<T extends { key: string; effort?: string }>(
  entries: T[],
  rank: (entry: T) => number,
  fold: (rest: T[]) => T,
): T[] {
  const sorted = [...entries].sort(compareEntries);
  if (sorted.length <= MAX_ROLLUP_ENTRIES) return sorted;
  const byRank = [...sorted].sort((a, b) => rank(b) - rank(a) || compareEntries(a, b));
  const keep = byRank.slice(0, MAX_ROLLUP_ENTRIES - 1);
  const rest = byRank.slice(MAX_ROLLUP_ENTRIES - 1);
  return [...keep, fold(rest)].sort(compareEntries);
}

export function emptyRollupBody(): RollupBody {
  return {
    tokens: emptyTokens(),
    responses: 0,
    subagentTokens: emptyTokens(),
    sessions: 0,
    subagentSessions: 0,
    turns: 0,
    userMessages: 0,
    agentMessages: 0,
    linesAdded: 0,
    linesRemoved: 0,
    filesChanged: 0,
    compactions: 0,
    activeMs: 0,
    wallMs: 0,
    ttft: emptyTtft(),
    byHour: new Array<number>(24).fill(0),
    byModel: [],
    byTool: TOOL_KINDS.map((key) => ({ key, count: 0 })).sort(compareEntries),
    byMcpTool: [],
    bySkill: [],
    byProject: [],
    byMachine: [],
    bySource: [],
  };
}

function eventTokens(event: EventInput): Tokens {
  return {
    input: event.input,
    cachedInput: event.cachedInput,
    cacheWrite: event.cacheWrite,
    output: event.output,
    reasoning: event.reasoning,
    total: event.total,
  };
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}

const foldModels = (rest: RollupModel[]): RollupModel => ({
  key: OTHER_KEY,
  tokens: rest.reduce((acc, m) => addTokens(acc, m.tokens), emptyTokens()),
  responses: sum(rest, (m) => m.responses),
});
const foldKeyCounts = (rest: RollupKeyCount[]): RollupKeyCount => ({
  key: OTHER_KEY,
  count: sum(rest, (e) => e.count),
});
const foldSkills = (rest: RollupSkill[]): RollupSkill => ({
  key: OTHER_KEY,
  count: sum(rest, (s) => s.count),
  sessions: sum(rest, (s) => s.sessions),
});
const foldProjects = (rest: RollupProject[]): RollupProject => ({
  key: OTHER_KEY,
  tokens: sum(rest, (p) => p.tokens),
  responses: sum(rest, (p) => p.responses),
  sessions: sum(rest, (p) => p.sessions),
  userMessages: sum(rest, (p) => p.userMessages),
  linesAdded: sum(rest, (p) => p.linesAdded),
  linesRemoved: sum(rest, (p) => p.linesRemoved),
});
const foldTokensSessions = (rest: RollupTokensSessions[]): RollupTokensSessions => ({
  key: OTHER_KEY,
  tokens: sum(rest, (e) => e.tokens),
  sessions: sum(rest, (e) => e.sessions),
});

/** Accumulates scalar counters and keyed maps; `finish()` turns the maps into capped sorted arrays. */
export class Collector {
  readonly body = emptyRollupBody();
  private readonly models = new Map<string, RollupModel>();
  private readonly tools = new Map<string, number>(TOOL_KINDS.map((kind) => [kind, 0]));
  private readonly mcpTools = new Map<string, number>();
  private readonly skills = new Map<string, RollupSkill>();
  private readonly projects = new Map<string, RollupProject>();
  private readonly machines = new Map<string, RollupTokensSessions>();
  private readonly sources = new Map<string, RollupTokensSessions>();

  addHour(hour: number, total: number): void {
    const index = Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 0;
    this.body.byHour[index] = (this.body.byHour[index] ?? 0) + total;
  }

  addModel(key: string, effort: string | undefined, tokens: Tokens, responses: number): void {
    const mapKey = JSON.stringify([key, effort ?? null]);
    const entry = this.models.get(mapKey) ?? {
      key,
      ...(effort !== undefined ? { effort } : {}),
      tokens: emptyTokens(),
      responses: 0,
    };
    entry.tokens = addTokens(entry.tokens, tokens);
    entry.responses += responses;
    this.models.set(mapKey, entry);
  }

  addTool(key: string, count: number): void {
    this.tools.set(key, (this.tools.get(key) ?? 0) + count);
  }

  addMcpTool(key: string, count: number): void {
    this.mcpTools.set(key, (this.mcpTools.get(key) ?? 0) + count);
  }

  addSkill(key: string, count: number, sessions: number): void {
    const entry = this.skills.get(key) ?? { key, count: 0, sessions: 0 };
    entry.count += count;
    entry.sessions += sessions;
    this.skills.set(key, entry);
  }

  addProject(key: string, delta: Partial<Omit<RollupProject, "key">>): void {
    const entry = this.projects.get(key) ?? {
      key,
      tokens: 0,
      responses: 0,
      sessions: 0,
      userMessages: 0,
      linesAdded: 0,
      linesRemoved: 0,
    };
    entry.tokens += delta.tokens ?? 0;
    entry.responses += delta.responses ?? 0;
    entry.sessions += delta.sessions ?? 0;
    entry.userMessages += delta.userMessages ?? 0;
    entry.linesAdded += delta.linesAdded ?? 0;
    entry.linesRemoved += delta.linesRemoved ?? 0;
    this.projects.set(key, entry);
  }

  addMachine(key: string, tokens: number, sessions: number): void {
    const entry = this.machines.get(key) ?? { key, tokens: 0, sessions: 0 };
    entry.tokens += tokens;
    entry.sessions += sessions;
    this.machines.set(key, entry);
  }

  addSource(key: string, tokens: number, sessions: number): void {
    const entry = this.sources.get(key) ?? { key, tokens: 0, sessions: 0 };
    entry.tokens += tokens;
    entry.sessions += sessions;
    this.sources.set(key, entry);
  }

  finish(): RollupBody {
    const body = this.body;
    body.byModel = capEntries([...this.models.values()], (m) => m.tokens.total, foldModels);
    body.byTool = [...this.tools].map(([key, count]) => ({ key, count })).sort(compareEntries);
    body.byMcpTool = capEntries(
      [...this.mcpTools].map(([key, count]) => ({ key, count })),
      (e) => e.count,
      foldKeyCounts,
    );
    body.bySkill = capEntries([...this.skills.values()], (s) => s.count, foldSkills);
    body.byProject = capEntries([...this.projects.values()], (p) => p.tokens, foldProjects);
    body.byMachine = capEntries([...this.machines.values()], (m) => m.tokens, foldTokensSessions);
    body.bySource = capEntries([...this.sources.values()], (s) => s.tokens, foldTokensSessions);
    return body;
  }
}

/** Pure, deterministic rollup of one (user, day): same inputs in any order → identical output. */
export function computeDayRollup(
  userId: Id<"users">,
  day: string,
  events: EventInput[],
  sessions: SessionInput[],
  computedAt: number,
): Rollup {
  const c = new Collector();
  const body = c.body;

  for (const event of events) {
    const tokens = eventTokens(event);
    body.tokens = addTokens(body.tokens, tokens);
    if (event.isSubagent) body.subagentTokens = addTokens(body.subagentTokens, tokens);
    body.responses += 1;
    c.addHour(event.hour, tokens.total);
    c.addModel(event.model, event.effort, tokens, 1);
    c.addProject(event.project, { tokens: tokens.total, responses: 1 });
  }

  for (const session of sessions) {
    c.addMachine(session.machineId, session.tokens.total, 1);
    c.addSource(session.source, session.tokens.total, 1);
    if (session.isSubagent) {
      body.subagentSessions += 1;
      continue;
    }
    body.sessions += 1;
    body.turns += session.turns;
    body.userMessages += session.userMessages;
    body.agentMessages += session.agentMessages;
    body.linesAdded += session.linesAdded;
    body.linesRemoved += session.linesRemoved;
    body.filesChanged += session.filesChanged;
    body.compactions += session.compactions;
    body.activeMs += session.activeMs;
    body.wallMs += session.wallMs;
    body.ttft = addTtft(body.ttft, session.ttft);
    for (const kind of TOOL_KINDS) c.addTool(kind, session.toolCounts[kind]);
    for (const entry of session.mcpTools) c.addMcpTool(entry.key, entry.count);
    for (const entry of session.skills) c.addSkill(entry.key, entry.count, 1);
    c.addProject(session.project, {
      sessions: 1,
      userMessages: session.userMessages,
      linesAdded: session.linesAdded,
      linesRemoved: session.linesRemoved,
    });
  }

  return { userId, day, version: ROLLUP_VERSION, computedAt, ...c.finish() };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run --project convex convex/lib/aggregate.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/lib/aggregate.ts web/convex/lib/aggregate.test.ts
git commit -m "Add deterministic daily rollup computation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 6: Folding rollups across days and users (`mergeRollups`)

**Files:**
- Modify: `web/convex/lib/aggregate.ts` (append at the end)
- Test: `web/convex/lib/aggregate.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `Collector`, `RollupBody`, `emptyRollupBody` from Task 5; `addTokens`, `addTtft` from `shared/src/metrics.ts`.
- Produces: `Aggregate = RollupBody & { days: number; activeDays: number }`, `DayRollup = RollupBody & { day: string }`, `emptyAggregate(): Aggregate`, `mergeRollups(rollups: DayRollup[]): Aggregate` (a `Doc<"dailyRollups">` and a `Rollup` are both `DayRollup`s). `days` counts folded rollup documents; `activeDays` counts the **distinct calendar days** among the rollups with `tokens.total > 0 || sessions > 0` — two documents for the same `day` (two users, say) count once. Arrays are re-capped after merging.

- [ ] **Step 1: Append the failing tests to `web/convex/lib/aggregate.test.ts`**

Add `emptyAggregate` and `mergeRollups` to the existing import from `./aggregate`, then append:

```ts
describe("mergeRollups", () => {
  const day1 = computeDayRollup(userId, "2026-08-31", events, sessions, AT);
  const day2 = computeDayRollup(userId, "2026-09-01", [events[2]!], [sessions[1]!], AT);
  const empty = computeDayRollup(userId, "2026-09-02", [], [], AT);

  it("returns the empty aggregate for no rollups", () => {
    expect(mergeRollups([])).toEqual(emptyAggregate());
  });

  it("folds a single rollup into itself plus day counts", () => {
    const merged = mergeRollups([day1]);
    expect(merged).toMatchObject({
      tokens: day1.tokens,
      subagentTokens: day1.subagentTokens,
      ttft: day1.ttft,
      byHour: day1.byHour,
      byModel: day1.byModel,
      byTool: day1.byTool,
      byMcpTool: day1.byMcpTool,
      bySkill: day1.bySkill,
      byProject: day1.byProject,
      byMachine: day1.byMachine,
      bySource: day1.bySource,
      sessions: day1.sessions,
      turns: day1.turns,
      activeMs: day1.activeMs,
      days: 1,
      activeDays: 1,
    });
    expect("userId" in merged).toBe(false);
    expect("day" in merged).toBe(false);
  });

  it("sums counters and merges keyed arrays across days", () => {
    const merged = mergeRollups([day1, day2, empty]);
    expect(merged.days).toBe(3);
    expect(merged.activeDays).toBe(2);
    // distinct calendar days, not documents: two rollups for the same day count once
    expect(mergeRollups([day1, day2, day2])).toMatchObject({ days: 3, activeDays: 2 });
    expect(merged.tokens.total).toBe(2900 + 330);
    expect(merged.sessions).toBe(3);
    expect(merged.byHour[23]).toBe(660);
    expect(merged.byModel.find((m) => m.key === "gpt-5.6-luna")).toEqual({
      key: "gpt-5.6-luna",
      effort: "low",
      tokens: { input: 600, cachedInput: 0, cacheWrite: 0, output: 60, reasoning: 0, total: 660 },
      responses: 2,
    });
    expect(merged.bySkill).toEqual([
      { key: "brainstorming", count: 2, sessions: 2 },
      { key: "dataviz", count: 4, sessions: 3 },
    ]);
    expect(merged.byProject.find((p) => p.key === "beta")).toEqual({
      key: "beta", tokens: 660, responses: 2, sessions: 2, userMessages: 2, linesAdded: 0, linesRemoved: 0,
    });
    expect(merged.byMachine).toEqual([
      { key: "m1", tokens: 2570, sessions: 2 },
      { key: "m2", tokens: 660, sessions: 2 },
    ]);
    expect(merged.byTool.find((t) => t.key === "commandRead")?.count).toBe(5);
  });

  it("is order independent and re-caps folded arrays", () => {
    const a = mergeRollups([day1, day2]);
    const b = mergeRollups([day2, day1]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const many = (offset: number) =>
      computeDayRollup(userId, "2026-08-30", [], [{
        ...sessions[1]!,
        mcpTools: Array.from({ length: 60 }, (_, i) => ({
          key: `tool-${String(offset + i).padStart(3, "0")}`,
          count: 1,
        })),
      }], AT);
    const capped = mergeRollups([many(0), many(60)]);
    expect(capped.byMcpTool).toHaveLength(100);
    expect(capped.byMcpTool[0]).toEqual({ key: "(other)", count: 21 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/lib/aggregate.test.ts`
Expected: FAIL — `mergeRollups is not a function` (import resolves to undefined).

- [ ] **Step 3: Append to `web/convex/lib/aggregate.ts`**

```ts
/** A fold of several rollups (any users, any days). */
export type Aggregate = RollupBody & { days: number; activeDays: number };

/** A rollup body tagged with its calendar day (a `Doc<"dailyRollups">` and a `Rollup` both are). */
export type DayRollup = RollupBody & { day: string };

export function emptyAggregate(): Aggregate {
  return { ...emptyRollupBody(), days: 0, activeDays: 0 };
}

/**
 * Sums every counter, merges keyed arrays by key (and effort) and re-applies the 100-entry cap.
 * `days` counts the folded documents; `activeDays` counts the distinct calendar days that carry
 * data, so two users' rollups for the same day count as one active day.
 */
export function mergeRollups(rollups: DayRollup[]): Aggregate {
  const c = new Collector();
  const body = c.body;
  let days = 0;
  const activeDayKeys = new Set<string>();
  for (const r of rollups) {
    days += 1;
    if (r.tokens.total > 0 || r.sessions > 0) activeDayKeys.add(r.day);
    body.tokens = addTokens(body.tokens, r.tokens);
    body.subagentTokens = addTokens(body.subagentTokens, r.subagentTokens);
    body.responses += r.responses;
    body.sessions += r.sessions;
    body.subagentSessions += r.subagentSessions;
    body.turns += r.turns;
    body.userMessages += r.userMessages;
    body.agentMessages += r.agentMessages;
    body.linesAdded += r.linesAdded;
    body.linesRemoved += r.linesRemoved;
    body.filesChanged += r.filesChanged;
    body.compactions += r.compactions;
    body.activeMs += r.activeMs;
    body.wallMs += r.wallMs;
    body.ttft = addTtft(body.ttft, r.ttft);
    for (let hour = 0; hour < 24; hour++) c.addHour(hour, r.byHour[hour] ?? 0);
    for (const m of r.byModel) c.addModel(m.key, m.effort, m.tokens, m.responses);
    for (const t of r.byTool) c.addTool(t.key, t.count);
    for (const t of r.byMcpTool) c.addMcpTool(t.key, t.count);
    for (const s of r.bySkill) c.addSkill(s.key, s.count, s.sessions);
    for (const p of r.byProject) c.addProject(p.key, p);
    for (const m of r.byMachine) c.addMachine(m.key, m.tokens, m.sessions);
    for (const s of r.bySource) c.addSource(s.key, s.tokens, s.sessions);
  }
  return { ...c.finish(), days, activeDays: activeDayKeys.size };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run --project convex convex/lib/aggregate.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/lib/aggregate.ts web/convex/lib/aggregate.test.ts
git commit -m "Add rollup merging across days and users

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 7: Test fixtures, auth wrappers and `users`

**Files:**
- Modify: `web/convex/test.helpers.ts` (replace whole file)
- Create: `web/convex/lib/auth.ts`
- Create: `web/convex/users.ts`
- Test: `web/convex/users.test.ts`

**Interfaces:**
- Consumes: `customQuery`, `customMutation`, `customCtx` from `convex-helpers/server/customFunctions`; `ConvexError` from `convex/values`; `UserIdentity` from `convex/server`; `sha256Hex`, `tokenPrefix` from `lib/hash.ts`; `computeDayRollup`, `EventInput`, `SessionInput` from `lib/aggregate.ts`; `MeResult`, `UserRef` from `lib/types.ts`.
- Produces:
  - `lib/auth.ts`: `AuthedContext = { identity: UserIdentity; user: Doc<"users"> }`, `requireUser(ctx: QueryCtx | MutationCtx): Promise<AuthedContext>` (throws `ConvexError({ code: "unauthenticated" })` / `ConvexError({ code: "user_not_registered" })`), `authedQuery`, `authedMutation` (handlers receive `ctx.user` and `ctx.identity`).
  - `users.ts`: `displayName(user: { name?: string; email?: string }): string`, `ensure` (mutation, `{}` → `Id<"users">`), `me` (`MeResult`), `list` (`UserRef[]` sorted by name).
  - `test.helpers.ts`: `modules`, `setup()`, `Harness`, `IDENTITIES`, `Who`, `withUser(t, who)`, `registerUser(t, who): Promise<Id<"users">>`, `RAW_TOKENS`, `createToken(t, userId, raw, name?)`, `userWithToken(t, who): Promise<{ userId; raw; tokenId }>`, `T0`, `ZERO_TOOLS`, `makeMachine(overrides?)`, `makeSession(overrides)`, `makeEvent(overrides)`, `makeBatch(overrides?)`, `postSync(t, raw | null, body)`, `getRollup(t, userId, day)`, `seedRollup(t, userId, day, events, sessions)`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/users.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { withUser, registerUser, setup } from "./test.helpers";

afterEach(() => vi.useRealTimers());

describe("users.ensure", () => {
  it("creates the user once and refreshes lastSeenAt on repeat calls", async () => {
    const t = setup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T09:00:00Z"));
    const first = await withUser(t, "alice").mutation(api.users.ensure, {});
    vi.setSystemTime(new Date("2026-08-31T10:00:00Z"));
    const second = await withUser(t, "alice").mutation(api.users.ensure, {});
    expect(second).toBe(first);
    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      clerkId: "user_alice",
      tokenIdentifier: "https://clerk.example|user_alice",
      name: "Alice",
      email: "alice@example.com",
      createdAt: Date.UTC(2026, 7, 31, 9),
      lastSeenAt: Date.UTC(2026, 7, 31, 10),
    });
  });

  it("rejects anonymous callers", async () => {
    const t = setup();
    await expect(t.mutation(api.users.ensure, {})).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
  });
});

describe("authed functions", () => {
  it("require a Clerk identity and a registered user", async () => {
    const t = setup();
    await expect(t.query(api.users.me, {})).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    await expect(withUser(t, "alice").query(api.users.me, {})).rejects.toMatchObject({
      data: { code: "user_not_registered" },
    });
  });
});

describe("users.me / users.list", () => {
  it("returns the caller and lists everyone sorted by name", async () => {
    const t = setup();
    const bobId = await registerUser(t, "bob");
    const aliceId = await registerUser(t, "alice");
    const me = await withUser(t, "alice").query(api.users.me, {});
    expect(me).toMatchObject({
      _id: aliceId,
      clerkId: "user_alice",
      name: "Alice",
      email: "alice@example.com",
      imageUrl: null,
    });
    const list = await withUser(t, "bob").query(api.users.list, {});
    expect(list).toEqual([
      { userId: aliceId, name: "Alice", imageUrl: null },
      { userId: bobId, name: "Bob", imageUrl: null },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/users.test.ts`
Expected: FAIL — `withUser`/`registerUser` are not exported from `./test.helpers`.

- [ ] **Step 3: Replace `web/convex/test.helpers.ts`**

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { MachineInfo, SessionSummary, SyncBatch, TokenEvent } from "../../shared/src/sync";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { computeDayRollup, type EventInput, type SessionInput } from "./lib/aggregate";
import { sha256Hex, tokenPrefix } from "./lib/hash";
import schema from "./schema";

// Every module under convex/ (tests included; convex-test only loads what a function reference needs).
export const modules = import.meta.glob("./**/*.*s");

export function setup() {
  return convexTest(schema, modules);
}
export type Harness = ReturnType<typeof setup>;

export const IDENTITIES = {
  alice: {
    subject: "user_alice",
    tokenIdentifier: "https://clerk.example|user_alice",
    name: "Alice",
    email: "alice@example.com",
  },
  bob: {
    subject: "user_bob",
    tokenIdentifier: "https://clerk.example|user_bob",
    name: "Bob",
    email: "bob@example.com",
  },
} as const;
export type Who = keyof typeof IDENTITIES;

/** A harness acting as the given Clerk identity. */
export function withUser(t: Harness, who: Who) {
  return t.withIdentity(IDENTITIES[who]);
}

export async function registerUser(t: Harness, who: Who): Promise<Id<"users">> {
  return await withUser(t, who).mutation(api.users.ensure, {});
}

export const RAW_TOKENS = {
  alice: "ck_alice0000000000000000000000000000000000000",
  bob: "ck_bob000000000000000000000000000000000000000",
} as const;

/** Inserts a sync token row for `raw` (the server only ever sees its sha256). */
export async function createToken(
  t: Harness,
  userId: Id<"users">,
  raw: string,
  name = "test",
): Promise<Id<"syncTokens">> {
  const tokenHash = await sha256Hex(raw);
  return await t.run(async (ctx) =>
    ctx.db.insert("syncTokens", {
      userId,
      tokenHash,
      prefix: tokenPrefix(raw),
      name,
      createdAt: 1_756_000_000_000,
    }),
  );
}

export async function userWithToken(t: Harness, who: Who) {
  const userId = await registerUser(t, who);
  const raw = RAW_TOKENS[who];
  const tokenId = await createToken(t, userId, raw);
  return { userId, raw, tokenId };
}

/** 2026-08-31T09:00:00Z */
export const T0 = Date.UTC(2026, 7, 31, 9, 0, 0);

export const ZERO_TOOLS = {
  commandRead: 0,
  commandList: 0,
  commandSearch: 0,
  commandOther: 0,
  fileChange: 0,
  webSearch: 0,
  imageView: 0,
  mcpTool: 0,
  other: 0,
};

export function makeMachine(overrides: Partial<MachineInfo> = {}): MachineInfo {
  return {
    machineId: "machine-1",
    label: "brisk-otter",
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "24.17.0",
    codexVersion: "0.150.1",
    codexLatestVersion: "0.150.1",
    hostname: null,
    tz: "UTC",
    ...overrides,
  };
}

export function makeSession(
  overrides: Partial<SessionSummary> & { sessionId: string },
): SessionSummary {
  return {
    threadId: overrides.sessionId,
    startedAt: T0,
    endedAt: T0 + 3_600_000,
    wallMs: 3_600_000,
    day: "2026-08-31",
    timezone: "UTC",
    project: "project-a",
    originator: "codex-tui",
    source: "cli",
    isSubagent: false,
    model: "gpt-5.6-sol",
    effort: "medium",
    cliVersion: "0.150.1",
    turns: 2,
    completedTurns: 2,
    userMessages: 2,
    agentMessages: 2,
    reasoningItems: 1,
    toolCounts: { ...ZERO_TOOLS, commandRead: 3 },
    mcpTools: [],
    skills: [],
    linesAdded: 10,
    linesRemoved: 2,
    filesChanged: 1,
    compactions: 0,
    activeMs: 600_000,
    ttft: { count: 2, sumMs: 1500, hist: [0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    tokens: { input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200 },
    responses: 2,
    inProgress: false,
    lineCount: 40,
    generation: 0,
    parseErrors: 0,
    parserVersion: 1,
    summaryHash: "a".repeat(40),
    ...overrides,
  };
}

export function makeEvent(
  overrides: Partial<TokenEvent> & { sessionId: string; seq: number },
): TokenEvent {
  return {
    ts: T0 + 60_000,
    day: "2026-08-31",
    hour: 9,
    model: "gpt-5.6-sol",
    effort: "medium",
    project: "project-a",
    isSubagent: false,
    input: 500,
    cachedInput: 200,
    cacheWrite: 0,
    output: 100,
    reasoning: 25,
    total: 600,
    ...overrides,
  };
}

export function makeBatch(overrides: Partial<SyncBatch> = {}): SyncBatch {
  return {
    schemaVersion: 1,
    parserVersion: 1,
    cliVersion: "0.1.0-test",
    batchId: "batch-1",
    sentAt: T0 + 3_600_000,
    machine: makeMachine(),
    sessions: [],
    tokenEvents: [],
    ...overrides,
  };
}

/** POSTs to /api/v1/sync; `raw === null` sends no Authorization header; a string body is sent verbatim. */
export async function postSync(t: Harness, raw: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (raw !== null) headers.authorization = `Bearer ${raw}`;
  const response = await t.fetch("/api/v1/sync", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await response.json();
  return { status: response.status, json, headers: response.headers };
}

export async function getRollup(t: Harness, userId: Id<"users">, day: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("dailyRollups")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
      .unique(),
  );
}

/** Inserts a rollup computed from raw inputs, bypassing ingest (for stats tests). */
export async function seedRollup(
  t: Harness,
  userId: Id<"users">,
  day: string,
  events: EventInput[],
  sessions: SessionInput[],
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("dailyRollups", computeDayRollup(userId, day, events, sessions, T0));
  });
}
```

- [ ] **Step 4: Create `web/convex/lib/auth.ts`**

```ts
import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import type { Doc } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";

export type AuthedContext = { identity: UserIdentity; user: Doc<"users"> };

/** Clerk identity → users row. `users.ensure` must have run once for this identity. */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<AuthedContext> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "unauthenticated" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (!user) throw new ConvexError({ code: "user_not_registered" });
  return { identity, user };
}

export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => requireUser(ctx)),
);

export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => requireUser(ctx)),
);
```

- [ ] **Step 5: Create `web/convex/users.ts`**

```ts
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/users.test.ts convex/schema.test.ts`
Expected: 7 tests PASS (codegen must run first so `api.users` exists).

- [ ] **Step 7: Commit**

```bash
git add web/convex/test.helpers.ts web/convex/lib/auth.ts web/convex/users.ts web/convex/users.test.ts
git commit -m "Add authed function wrappers, users functions and test fixtures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 8: Sync tokens (`syncTokens.ts`)

**Files:**
- Create: `web/convex/syncTokens.ts`
- Test: `web/convex/syncTokens.test.ts`

**Interfaces:**
- Consumes: `authedQuery`, `authedMutation` (Task 7); `generateRawToken`, `sha256Hex`, `tokenPrefix` (Task 2); `TOKEN_LAST_USED_THROTTLE_MS` (Task 3); `displayName` (Task 7); `SyncTokenRow` (contracts §9).
- Produces: `TokenLookup = { tokenId; userId; name; prefix; revokedAt: number | null; lastUsedAt: number | null; user: { name: string; email: string | null } }`; plain helpers `findTokenByHash(ctx: QueryCtx, tokenHash): Promise<TokenLookup | null>` and `touchToken(ctx: MutationCtx, tokenId, now): Promise<boolean>`; functions `lookupByHash` (internalQuery `{ tokenHash }` → `TokenLookup | null`), `touchLastUsed` (internalMutation `{ tokenId, now }` → `boolean`), `insert` (internalMutation `{ clerkId, tokenHash, prefix, name }` → `Id<"syncTokens">`), `list` (authedQuery → `SyncTokenRow[]`, newest first), `create` (action `{ name }` → `{ id, token, prefix }`), `revoke` (authedMutation `{ tokenId }` → `null`, `ConvexError({ code: "forbidden" })` for another user's token).

The HTTP-level check "revoked token → 401 `token_revoked`" is asserted in Task 11 once the router exists.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/syncTokens.test.ts
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { sha256Hex } from "./lib/hash";
import { withUser, registerUser, setup, userWithToken } from "./test.helpers";

describe("syncTokens.create", () => {
  it("returns the raw token once and stores only its hash", async () => {
    const t = setup();
    const aliceId = await registerUser(t, "alice");
    const created = await withUser(t, "alice").action(api.syncTokens.create, { name: "  laptop " });
    expect(created.token).toMatch(/^ck_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.token.slice(0, 9));
    const rows = await t.run(async (ctx) => ctx.db.query("syncTokens").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: created.id,
      userId: aliceId,
      name: "laptop",
      prefix: created.prefix,
      tokenHash: await sha256Hex(created.token),
    });
    expect(JSON.stringify(rows[0])).not.toContain(created.token);
    const listed = await withUser(t, "alice").query(api.syncTokens.list, {});
    expect(listed).toEqual([
      {
        _id: created.id,
        name: "laptop",
        prefix: created.prefix,
        createdAt: expect.any(Number),
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain("tokenHash");
  });

  it("rejects anonymous callers, unregistered users and blank names", async () => {
    const t = setup();
    await expect(t.action(api.syncTokens.create, { name: "x" })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    await expect(withUser(t, "alice").action(api.syncTokens.create, { name: "x" })).rejects.toMatchObject({
      data: { code: "user_not_registered" },
    });
    await registerUser(t, "alice");
    await expect(withUser(t, "alice").action(api.syncTokens.create, { name: "   " })).rejects.toMatchObject({
      data: { code: "bad_name" },
    });
  });
});

describe("syncTokens.list", () => {
  it("shows only the caller's tokens, newest first", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    await userWithToken(t, "bob");
    const second = await withUser(t, "alice").action(api.syncTokens.create, { name: "desktop" });
    const listed = await withUser(t, "alice").query(api.syncTokens.list, {});
    expect(listed.map((row) => row._id)).toEqual([second.id, alice.tokenId]);
  });
});

describe("syncTokens.revoke", () => {
  it("revokes own tokens only", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    await registerUser(t, "bob");
    await expect(
      withUser(t, "bob").mutation(api.syncTokens.revoke, { tokenId: alice.tokenId }),
    ).rejects.toMatchObject({ data: { code: "forbidden" } });
    expect(await withUser(t, "alice").mutation(api.syncTokens.revoke, { tokenId: alice.tokenId })).toBeNull();
    const listed = await withUser(t, "alice").query(api.syncTokens.list, {});
    expect(listed[0]?.revokedAt).toEqual(expect.any(Number));
    const lookup = await t.query(internal.syncTokens.lookupByHash, {
      tokenHash: await sha256Hex(alice.raw),
    });
    expect(lookup?.revokedAt).toEqual(expect.any(Number));
  });
});

describe("lookupByHash / touchLastUsed", () => {
  it("resolves a token to its user without the hash and throttles lastUsedAt to once a minute", async () => {
    const t = setup();
    const { userId, raw, tokenId } = await userWithToken(t, "alice");
    const found = await t.query(internal.syncTokens.lookupByHash, { tokenHash: await sha256Hex(raw) });
    expect(found).toEqual({
      tokenId,
      userId,
      name: "test",
      prefix: "ck_alice0",
      revokedAt: null,
      lastUsedAt: null,
      user: { name: "Alice", email: "alice@example.com" },
    });
    expect(await t.query(internal.syncTokens.lookupByHash, { tokenHash: "0".repeat(64) })).toBeNull();

    expect(await t.mutation(internal.syncTokens.touchLastUsed, { tokenId, now: 1_000_000 })).toBe(true);
    expect(await t.mutation(internal.syncTokens.touchLastUsed, { tokenId, now: 1_059_999 })).toBe(false);
    expect(await t.mutation(internal.syncTokens.touchLastUsed, { tokenId, now: 1_060_000 })).toBe(true);
    const row = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(row?.lastUsedAt).toBe(1_060_000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/syncTokens.test.ts`
Expected: FAIL — `api.syncTokens` is undefined / module not found.

- [ ] **Step 3: Create `web/convex/syncTokens.ts`**

```ts
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
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
  handler: async (ctx, { name }): Promise<{ id: Id<"syncTokens">; token: string; prefix: string }> => {
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/syncTokens.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/syncTokens.ts web/convex/syncTokens.test.ts
git commit -m "Add sync token creation, listing, revocation and lookup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 9: Rollup recompute inside mutations (`rollups.ts`)

**Files:**
- Create: `web/convex/rollups.ts`
- Test: `web/convex/rollups.test.ts`

**Interfaces:**
- Consumes: `computeDayRollup` (Task 5); `MutationCtx`, `Id`.
- Produces: `RecomputeOutcome = "inserted" | "replaced" | "deleted" | "none"`, `recomputeDay(ctx: MutationCtx, userId: Id<"users">, day: string, now: number): Promise<RecomputeOutcome>`, `recomputeDays(ctx, userId, days: Iterable<string>, now): Promise<Record<RecomputeOutcome, number>>`. Task 18 adds `rebuildAll` to this file.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/rollups.test.ts
import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import { recomputeDay, recomputeDays } from "./rollups";
import { getRollup, makeEvent, makeSession, registerUser, setup, T0, type Harness } from "./test.helpers";

async function insertData(t: Harness, userId: Id<"users">) {
  await t.run(async (ctx) => {
    await ctx.db.insert("sessions", {
      ...makeSession({ sessionId: "s1" }),
      userId,
      machineId: "machine-1",
      syncedAt: T0,
    });
    await ctx.db.insert("tokenEvents", { ...makeEvent({ sessionId: "s1", seq: 5 }), userId });
    await ctx.db.insert("tokenEvents", {
      ...makeEvent({ sessionId: "s1", seq: 9, day: "2026-09-01", hour: 0, ts: T0 + 15 * 3_600_000 }),
      userId,
    });
  });
}

async function clearData(t: Harness) {
  await t.run(async (ctx) => {
    for (const doc of await ctx.db.query("tokenEvents").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("sessions").collect()) await ctx.db.delete(doc._id);
  });
}

describe("recomputeDay", () => {
  it("inserts, replaces and deletes the rollup of a (user, day)", async () => {
    const t = setup();
    const userId = await registerUser(t, "alice");
    await insertData(t, userId);

    expect(await t.run(async (ctx) => recomputeDay(ctx, userId, "2026-08-31", T0))).toBe("inserted");
    const first = await getRollup(t, userId, "2026-08-31");
    expect(first).toMatchObject({ sessions: 1, responses: 1, computedAt: T0 });
    expect(first?.tokens.total).toBe(600);

    expect(await t.run(async (ctx) => recomputeDay(ctx, userId, "2026-08-31", T0 + 1))).toBe("replaced");
    const second = await getRollup(t, userId, "2026-08-31");
    expect(second?._id).toBe(first?._id);
    expect({ ...second, computedAt: 0 }).toEqual({ ...first, computedAt: 0 });

    await clearData(t);
    expect(await t.run(async (ctx) => recomputeDay(ctx, userId, "2026-08-31", T0))).toBe("deleted");
    expect(await getRollup(t, userId, "2026-08-31")).toBeNull();
    expect(await t.run(async (ctx) => recomputeDay(ctx, userId, "2026-08-31", T0))).toBe("none");
  });

  it("attributes a midnight-spanning session's events to their own days", async () => {
    const t = setup();
    const userId = await registerUser(t, "alice");
    await insertData(t, userId);
    const outcomes = await t.run(async (ctx) =>
      recomputeDays(ctx, userId, ["2026-09-01", "2026-08-31", "2026-08-31"], T0),
    );
    expect(outcomes).toEqual({ inserted: 2, replaced: 0, deleted: 0, none: 0 });

    const day1 = await getRollup(t, userId, "2026-08-31");
    expect(day1).toMatchObject({ sessions: 1, turns: 2, responses: 1 });
    expect(day1?.tokens.total).toBe(600);
    expect(day1?.byHour[9]).toBe(600);

    const day2 = await getRollup(t, userId, "2026-09-01");
    expect(day2).toMatchObject({ sessions: 0, turns: 0, responses: 1 });
    expect(day2?.tokens.total).toBe(600);
    expect(day2?.byHour[0]).toBe(600);
    expect(day2?.byProject).toEqual([
      { key: "project-a", tokens: 600, responses: 1, sessions: 0, userMessages: 0, linesAdded: 0, linesRemoved: 0 },
    ]);
    expect(day2?.byMachine).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/rollups.test.ts`
Expected: FAIL — `Cannot find module './rollups'`.

- [ ] **Step 3: Create `web/convex/rollups.ts`**

```ts
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { computeDayRollup } from "./lib/aggregate";

export type RecomputeOutcome = "inserted" | "replaced" | "deleted" | "none";

/**
 * Recomputes one (user, day) rollup from scratch out of that day's tokenEvents and sessions.
 * Mutations see their own writes, so this runs at the end of every upsert mutation.
 */
export async function recomputeDay(
  ctx: MutationCtx,
  userId: Id<"users">,
  day: string,
  now: number,
): Promise<RecomputeOutcome> {
  const events = await ctx.db
    .query("tokenEvents")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
    .collect();
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
    .collect();
  const existing = await ctx.db
    .query("dailyRollups")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
    .unique();

  if (events.length === 0 && sessions.length === 0) {
    if (!existing) return "none";
    await ctx.db.delete(existing._id);
    return "deleted";
  }

  const rollup = computeDayRollup(userId, day, events, sessions, now);
  if (existing) {
    await ctx.db.replace(existing._id, rollup);
    return "replaced";
  }
  await ctx.db.insert("dailyRollups", rollup);
  return "inserted";
}

/** Recomputes each distinct day once, in ascending order. */
export async function recomputeDays(
  ctx: MutationCtx,
  userId: Id<"users">,
  days: Iterable<string>,
  now: number,
): Promise<Record<RecomputeOutcome, number>> {
  const outcomes: Record<RecomputeOutcome, number> = { inserted: 0, replaced: 0, deleted: 0, none: 0 };
  for (const day of [...new Set(days)].sort()) {
    outcomes[await recomputeDay(ctx, userId, day, now)] += 1;
  }
  return outcomes;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run --project convex convex/rollups.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/rollups.ts web/convex/rollups.test.ts
git commit -m "Add per-day rollup recompute used by ingest mutations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 10: Ingest internal mutations and chunking (`ingest.ts`, part 1)

**Files:**
- Create: `web/convex/ingest.ts`
- Test: `web/convex/ingest.internal.test.ts`

**Interfaces:**
- Consumes: `MAX_DAYS_PER_EVENT_CHUNK`, `MAX_EVENTS_PER_MUTATION`, `MAX_SESSIONS_PER_MUTATION` from `shared/src/constants.ts`; `SessionSummary`, `TokenEvent`, `UpsertCounts` from `shared/src/sync.ts`; validators from Task 1; `recomputeDays` (Task 9); `touchToken` (Task 8).
- Produces: pure helpers `zeroCounts(): UpsertCounts`, `addCounts(target, delta): void`, `chunkByDays<T extends { day: string }>(items: T[], maxItems: number): T[][]`, `chunkEvents(events: TokenEvent[]): TokenEvent[][]`, `chunkSessions(sessions: SessionSummary[]): SessionSummary[][]`, `eventsEqual(a: TokenEvent, b: TokenEvent): boolean`; internal mutations `upsertMachine({ userId, machine, cliVersion, now })` → `{ conflict: boolean; created: boolean }`, `upsertSessions({ userId, machineId, sessions, now })` → `{ counts: UpsertCounts; conflicts: string[] }`, `upsertEvents({ userId, events, now })` → `{ counts: UpsertCounts; conflicts: number }`, `finishSync({ userId, machineId, tokenId, rateLimit?, now })` → `{ rateLimitStored: boolean; tokenTouched: boolean }`. Task 11 appends the HTTP handlers to this file.

Rules (spec "Functions" + contracts §7/§8): the machine `label` is written on first registration only (later renames happen in the dashboard via `machines.rename`; the CLI's `--machine-name` matters only at first sync — Plan 1 must document this). `hostname: null` is stored as absent. A session whose `summaryHash` matches is "unchanged" but its `inProgress`, `lineCount` and `generation` are still patched (they are excluded from the hash and never affect rollups). Sessions and events of another user are never merged or overwritten; they are reported as conflicts. Both chunkers also cap the **distinct `day` values** a single mutation touches at `MAX_DAYS_PER_EVENT_CHUNK` (30), because each touched day costs one `recomputeDay` (a full re-read of that day's `tokenEvents`) inside the same mutation.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/ingest.internal.test.ts
import { describe, expect, it } from "vitest";
import { addDays } from "../../shared/src/days";
import { internal } from "./_generated/api";
import { chunkEvents, chunkSessions, eventsEqual } from "./ingest";
import {
  getRollup,
  makeEvent,
  makeMachine,
  makeSession,
  registerUser,
  setup,
  T0,
  userWithToken,
} from "./test.helpers";

describe("chunkEvents", () => {
  it("splits by 1,000 events and by 30 distinct days, preserving order", () => {
    const sameDay = Array.from({ length: 2500 }, (_, i) => makeEvent({ sessionId: "s", seq: i }));
    expect(chunkEvents(sameDay).map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(chunkEvents(sameDay).flat().map((e) => e.seq)).toEqual(sameDay.map((e) => e.seq));
    const manyDays = Array.from({ length: 35 }, (_, i) =>
      makeEvent({ sessionId: "s", seq: i, day: addDays("2026-06-01", i) }),
    );
    expect(chunkEvents(manyDays).map((c) => c.length)).toEqual([30, 5]);
    expect(chunkEvents([])).toEqual([]);
  });
});

describe("chunkSessions", () => {
  it("splits by 200 sessions and by 30 distinct days, preserving order", () => {
    const sameDay = Array.from({ length: 450 }, (_, i) => makeSession({ sessionId: `s-${i}` }));
    expect(chunkSessions(sameDay).map((c) => c.length)).toEqual([200, 200, 50]);
    const manyDays = Array.from({ length: 45 }, (_, i) =>
      makeSession({ sessionId: `d-${i}`, day: addDays("2026-06-01", i) }),
    );
    expect(chunkSessions(manyDays).map((c) => c.length)).toEqual([30, 15]);
    expect(chunkSessions(manyDays).flat().map((s) => s.sessionId)).toEqual(
      manyDays.map((s) => s.sessionId),
    );
    expect(chunkSessions([])).toEqual([]);
  });
});

describe("eventsEqual", () => {
  it("compares every payload field, treating absent optionals as equal", () => {
    const a = makeEvent({ sessionId: "s", seq: 1 });
    expect(eventsEqual(a, { ...a })).toBe(true);
    expect(eventsEqual(a, { ...a, output: a.output + 1 })).toBe(false);
    const noEffort = { ...a };
    delete noEffort.effort;
    expect(eventsEqual(a, noEffort)).toBe(false);
    expect(eventsEqual(noEffort, { ...noEffort })).toBe(true);
  });
});

describe("upsertMachine", () => {
  it("registers, updates versions but never the label, clears hostname on null, rejects other users", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    const first = await t.mutation(internal.ingest.upsertMachine, {
      userId: alice, machine: makeMachine(), cliVersion: "0.1.0", now: T0,
    });
    expect(first).toEqual({ conflict: false, created: true });

    const second = await t.mutation(internal.ingest.upsertMachine, {
      userId: alice,
      machine: makeMachine({ label: "renamed-by-cli", hostname: "mac.local", codexVersion: "0.151.0" }),
      cliVersion: "0.2.0",
      now: T0 + 1,
    });
    expect(second).toEqual({ conflict: false, created: false });
    const rows = await t.run(async (ctx) => ctx.db.query("machines").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      machineId: "machine-1", userId: alice, label: "brisk-otter", hostname: "mac.local",
      codexVersion: "0.151.0", cliVersion: "0.2.0", firstSeenAt: T0, lastSyncAt: T0 + 1,
    });

    await t.mutation(internal.ingest.upsertMachine, {
      userId: alice, machine: makeMachine({ hostname: null }), cliVersion: "0.2.0", now: T0 + 2,
    });
    const cleared = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(cleared?.hostname).toBeUndefined();

    const conflict = await t.mutation(internal.ingest.upsertMachine, {
      userId: bob, machine: makeMachine({ label: "stolen" }), cliVersion: "0.2.0", now: T0 + 3,
    });
    expect(conflict).toEqual({ conflict: true, created: false });
    const after = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(after).toMatchObject({ userId: alice, lastSyncAt: T0 + 2 });
  });
});

describe("upsertSessions", () => {
  it("inserts, skips unchanged hashes, replaces changed sessions and reports conflicts", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    const s1 = makeSession({ sessionId: "s1" });

    const r1 = await t.mutation(internal.ingest.upsertSessions, {
      userId: alice, machineId: "machine-1", sessions: [s1], now: T0,
    });
    expect(r1).toEqual({ counts: { inserted: 1, updated: 0, unchanged: 0 }, conflicts: [] });
    expect(await getRollup(t, alice, "2026-08-31")).toMatchObject({ sessions: 1, computedAt: T0 });

    const r2 = await t.mutation(internal.ingest.upsertSessions, {
      userId: alice, machineId: "machine-1",
      sessions: [{ ...s1, inProgress: true, lineCount: 41 }], now: T0 + 1,
    });
    expect(r2.counts).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect((await getRollup(t, alice, "2026-08-31"))?.computedAt).toBe(T0);
    const stored = await t.run(async (ctx) =>
      ctx.db.query("sessions").withIndex("by_sessionId", (q) => q.eq("sessionId", "s1")).unique(),
    );
    expect(stored).toMatchObject({ inProgress: true, lineCount: 41, syncedAt: T0 + 1 });

    const moved = {
      ...s1, day: "2026-09-01", startedAt: T0 + 86_400_000, turns: 5, summaryHash: "b".repeat(40),
    };
    const r3 = await t.mutation(internal.ingest.upsertSessions, {
      userId: alice, machineId: "machine-1", sessions: [moved], now: T0 + 2,
    });
    expect(r3.counts).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(await getRollup(t, alice, "2026-08-31")).toBeNull();
    expect(await getRollup(t, alice, "2026-09-01")).toMatchObject({ sessions: 1, turns: 5, computedAt: T0 + 2 });
    expect(await t.run(async (ctx) => ctx.db.query("sessions").collect())).toHaveLength(1);

    const r4 = await t.mutation(internal.ingest.upsertSessions, {
      userId: bob, machineId: "machine-2", sessions: [{ ...moved, turns: 99 }], now: T0 + 3,
    });
    expect(r4).toEqual({ counts: { inserted: 0, updated: 0, unchanged: 0 }, conflicts: ["s1"] });
    expect(await getRollup(t, bob, "2026-09-01")).toBeNull();
    expect((await getRollup(t, alice, "2026-09-01"))?.turns).toBe(5);
  });
});

describe("upsertEvents", () => {
  it("inserts, skips identical events, replaces modified ones touching both days, reports conflicts", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    const e1 = makeEvent({ sessionId: "s1", seq: 1 });
    const e2 = makeEvent({ sessionId: "s1", seq: 2, hour: 10 });

    const r1 = await t.mutation(internal.ingest.upsertEvents, { userId: alice, events: [e1, e2], now: T0 });
    expect(r1).toEqual({ counts: { inserted: 2, updated: 0, unchanged: 0 }, conflicts: 0 });
    expect(await getRollup(t, alice, "2026-08-31")).toMatchObject({ responses: 2, computedAt: T0 });

    const r2 = await t.mutation(internal.ingest.upsertEvents, { userId: alice, events: [e1, e2], now: T0 + 1 });
    expect(r2.counts).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    expect((await getRollup(t, alice, "2026-08-31"))?.computedAt).toBe(T0);

    const movedE2 = { ...e2, day: "2026-09-01", hour: 0, output: 999, total: 1499 };
    const r3 = await t.mutation(internal.ingest.upsertEvents, { userId: alice, events: [movedE2], now: T0 + 2 });
    expect(r3.counts).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(await getRollup(t, alice, "2026-08-31")).toMatchObject({ responses: 1, computedAt: T0 + 2 });
    const day2 = await getRollup(t, alice, "2026-09-01");
    expect(day2).toMatchObject({ responses: 1, computedAt: T0 + 2 });
    expect(day2?.tokens.total).toBe(1499);
    expect(await t.run(async (ctx) => ctx.db.query("tokenEvents").collect())).toHaveLength(2);

    const r4 = await t.mutation(internal.ingest.upsertEvents, {
      userId: bob, events: [{ ...e1, output: 5 }], now: T0 + 3,
    });
    expect(r4).toEqual({ counts: { inserted: 0, updated: 0, unchanged: 0 }, conflicts: 1 });
    expect(await getRollup(t, bob, "2026-08-31")).toBeNull();
  });
});

describe("finishSync", () => {
  it("updates lastSyncAt, keeps the newest snapshot by observedAt with the server receive time, touches the token", async () => {
    const t = setup();
    const { userId, tokenId } = await userWithToken(t, "alice");
    await t.mutation(internal.ingest.upsertMachine, {
      userId, machine: makeMachine(), cliVersion: "0.1.0", now: T0,
    });
    const snapshot = {
      observedAt: T0 - 60_000, usedPercent: 12.5, windowMinutes: 10080,
      resetsAt: T0 + 6 * 86_400_000, planType: "team", limitId: "primary",
    };
    const r1 = await t.mutation(internal.ingest.finishSync, {
      userId, machineId: "machine-1", tokenId, rateLimit: snapshot, now: T0 + 5,
    });
    expect(r1).toEqual({ rateLimitStored: true, tokenTouched: true });
    const m1 = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(m1).toMatchObject({ lastSyncAt: T0 + 5, lastRateLimit: { ...snapshot, receivedAt: T0 + 5 } });

    const older = { ...snapshot, observedAt: T0 - 120_000, usedPercent: 99 };
    const r2 = await t.mutation(internal.ingest.finishSync, {
      userId, machineId: "machine-1", tokenId, rateLimit: older, now: T0 + 10,
    });
    expect(r2).toEqual({ rateLimitStored: false, tokenTouched: false });
    const m2 = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(m2).toMatchObject({ lastSyncAt: T0 + 10, lastRateLimit: { ...snapshot, receivedAt: T0 + 5 } });

    const r3 = await t.mutation(internal.ingest.finishSync, {
      userId, machineId: "machine-1", tokenId, now: T0 + 70_000,
    });
    expect(r3).toEqual({ rateLimitStored: false, tokenTouched: true });
    const token = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(token?.lastUsedAt).toBe(T0 + 70_000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/ingest.internal.test.ts`
Expected: FAIL — `Cannot find module './ingest'`.

- [ ] **Step 3: Create `web/convex/ingest.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/ingest.internal.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/ingest.ts web/convex/ingest.internal.test.ts
git commit -m "Add idempotent session and event upsert mutations with rollup recompute

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 11: HTTP handlers and router (`ingest.ts` part 2, `http.ts`)

**Files:**
- Modify: `web/convex/ingest.ts` (extend imports, append handlers)
- Create: `web/convex/http.ts`
- Test: `web/convex/ingest.http.test.ts`

**Interfaces:**
- Consumes: `SyncBatch` (zod), `ErrorCode`, `ErrorResponse`, `SyncResponse`, `WhoamiResponse` from `shared/src/sync.ts`; `MAX_BODY_BYTES`, `MAX_EVENTS_PER_REQUEST`, `MAX_SESSIONS_PER_MUTATION`, `MAX_SESSIONS_PER_REQUEST`, `SYNC_PATH`, `WHOAMI_PATH`, `HEALTH_PATH` from `shared/src/constants.ts`; `LIMITS`, `latestCliVersion` (Task 3); `parseBearer`, `sha256Hex` (Task 2); `TokenLookup` (Task 8); Task 10 helpers and mutations.
- Produces: `jsonResponse(status, body, extraHeaders?)`, `errorResponse(status, error: ErrorCode, message, extra?: { issues?; limits? }, extraHeaders?)`, `syncHandler`, `whoamiHandler`, `healthHandler` (httpActions); `http.ts` default export routing `POST /api/v1/sync`, `GET /api/v1/whoami`, `GET /api/v1/health` (contracts §7).

Status paths (contracts §7): 401 `unauthorized` (missing/unknown token) / `token_revoked`; 413 `payload_too_large` (declared or measured body > 8 MiB, with `limits`) / `too_many_items` (> 500 sessions or > 5,000 events, with `limits`); 400 `invalid_json` / `invalid_batch` (zod issues as `{ path, message }`, at most 50); 409 `machine_conflict`; 503 `internal` with `Retry-After: 5` for anything unexpected.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/ingest.http.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES } from "../../shared/src/constants";
import { api } from "./_generated/api";
import {
  withUser,
  getRollup,
  makeBatch,
  makeEvent,
  makeMachine,
  makeSession,
  postSync,
  setup,
  T0,
  userWithToken,
} from "./test.helpers";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/v1/health", () => {
  it("answers without auth", async () => {
    const t = setup();
    const res = await t.fetch("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, serverTime: expect.any(Number) });
  });
});

describe("authentication", () => {
  it("rejects missing, unknown and revoked tokens", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");

    const missing = await postSync(t, null, makeBatch());
    expect(missing.status).toBe(401);
    expect(missing.json).toEqual({ ok: false, error: "unauthorized", message: expect.any(String) });

    const unknown = await postSync(t, "ck_nope", makeBatch());
    expect(unknown.status).toBe(401);
    expect(unknown.json.error).toBe("unauthorized");

    const whoamiUnknown = await t.fetch("/api/v1/whoami", { headers: { authorization: "Basic abc" } });
    expect(whoamiUnknown.status).toBe(401);

    await withUser(t, "alice").mutation(api.syncTokens.revoke, { tokenId: alice.tokenId });
    const revoked = await postSync(t, alice.raw, makeBatch());
    expect(revoked.status).toBe(401);
    expect(revoked.json.error).toBe("token_revoked");
    const whoamiRevoked = await t.fetch("/api/v1/whoami", {
      headers: { authorization: `Bearer ${alice.raw}` },
    });
    expect(whoamiRevoked.status).toBe(401);
    expect((await whoamiRevoked.json()).error).toBe("token_revoked");
  });
});

describe("GET /api/v1/whoami", () => {
  it("returns the token owner and marks the token used", async () => {
    const t = setup();
    const { userId, raw, tokenId } = await userWithToken(t, "alice");
    const res = await t.fetch("/api/v1/whoami", { headers: { authorization: `Bearer ${raw}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      userId,
      name: "Alice",
      email: "alice@example.com",
      token: { name: "test", prefix: "ck_alice0" },
      serverTime: expect.any(Number),
    });
    const token = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(token?.lastUsedAt).toEqual(expect.any(Number));
  });
});

describe("POST /api/v1/sync validation", () => {
  it("rejects bodies over 8 MiB with the limits", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const res = await postSync(t, raw, JSON.stringify({ pad: "x".repeat(MAX_BODY_BYTES) }));
    expect(res.status).toBe(413);
    expect(res.json).toMatchObject({
      ok: false,
      error: "payload_too_large",
      limits: { maxBodyBytes: MAX_BODY_BYTES, maxSessions: 500, maxEvents: 5000 },
    });
  });

  it("rejects more than 5,000 events with too_many_items", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const tokenEvents = Array.from({ length: 5001 }, (_, i) => makeEvent({ sessionId: "s", seq: i }));
    const res = await postSync(t, raw, makeBatch({ tokenEvents }));
    expect(res.status).toBe(413);
    expect(res.json).toMatchObject({ ok: false, error: "too_many_items", limits: { maxEvents: 5000 } });
  });

  it("rejects malformed JSON", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const res = await postSync(t, raw, "{not json");
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ ok: false, error: "invalid_json", message: expect.any(String) });
  });

  it("rejects batches that fail the shared schema and lists the issues", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const bad = {
      ...makeBatch({ tokenEvents: [makeEvent({ sessionId: "s", seq: 0, hour: 24 })] }),
      schemaVersion: 2,
    };
    const res = await postSync(t, raw, bad);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_batch");
    const paths = (res.json.issues as { path: string; message: string }[]).map((i) => i.path);
    expect(paths).toContain("schemaVersion");
    expect(paths).toContain("tokenEvents.0.hour");
    expect(await t.run(async (ctx) => ctx.db.query("machines").collect())).toHaveLength(0);
  });

  it("rejects a machine registered to another user with 409 and writes nothing", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    const bob = await userWithToken(t, "bob");
    expect((await postSync(t, bob.raw, makeBatch())).status).toBe(200);
    const res = await postSync(t, alice.raw, makeBatch({ sessions: [makeSession({ sessionId: "s1" })] }));
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ ok: false, error: "machine_conflict", message: expect.any(String) });
    expect(await t.run(async (ctx) => ctx.db.query("sessions").collect())).toHaveLength(0);
  });

  it("answers 503 with Retry-After when a mutation throws unexpectedly", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    // Two documents with the same sessionId violate the by_sessionId invariant; `.unique()` throws.
    await t.run(async (ctx) => {
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("sessions", {
          ...makeSession({ sessionId: "dup" }),
          userId,
          machineId: "machine-1",
          syncedAt: T0,
        });
      }
    });
    const res = await postSync(t, raw, makeBatch({ sessions: [makeSession({ sessionId: "dup" })] }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(res.json).toEqual({ ok: false, error: "internal", message: expect.any(String) });
  });
});

describe("POST /api/v1/sync happy path", () => {
  it("stores machine, sessions, events, rate limit and answers with the contract shape", async () => {
    vi.stubEnv("LATEST_CLI_VERSION", "0.9.0-build.202609011200.abc1234");
    const t = setup();
    const { userId, raw, tokenId } = await userWithToken(t, "alice");
    const batch = makeBatch({
      machine: makeMachine({ hostname: null }),
      sessions: [makeSession({ sessionId: "s1" }), makeSession({ sessionId: "s2", project: "project-b" })],
      tokenEvents: [
        makeEvent({ sessionId: "s1", seq: 3 }),
        makeEvent({ sessionId: "s1", seq: 7, hour: 10 }),
        makeEvent({ sessionId: "s2", seq: 2, project: "project-b" }),
      ],
      rateLimit: { observedAt: T0, usedPercent: 42, windowMinutes: 10080, resetsAt: T0 + 86_400_000 },
    });
    const res = await postSync(t, raw, batch);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      ok: true,
      accepted: {
        sessions: { inserted: 2, updated: 0, unchanged: 0 },
        events: { inserted: 3, updated: 0, unchanged: 0 },
      },
      conflicts: { sessions: [], events: 0 },
      serverTime: expect.any(Number),
      latestCliVersion: "0.9.0-build.202609011200.abc1234",
      limits: { maxBodyBytes: MAX_BODY_BYTES, maxSessions: 500, maxEvents: 5000 },
    });

    const machine = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(machine).toMatchObject({
      machineId: "machine-1",
      userId,
      label: "brisk-otter",
      cliVersion: "0.1.0-test",
      lastRateLimit: { usedPercent: 42, observedAt: T0, receivedAt: res.json.serverTime },
    });
    expect(machine?.hostname).toBeUndefined();

    const rollup = await getRollup(t, userId, "2026-08-31");
    expect(rollup).toMatchObject({ sessions: 2, responses: 3, turns: 4 });
    expect(rollup?.tokens.total).toBe(1800);
    expect(rollup?.byProject.map((p) => p.key)).toEqual(["project-a", "project-b"]);

    const token = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(token?.lastUsedAt).toBe(res.json.serverTime);
  });

  it("reports null latestCliVersion when the env var is unset", async () => {
    vi.stubEnv("LATEST_CLI_VERSION", "");
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const res = await postSync(t, raw, makeBatch());
    expect(res.status).toBe(200);
    expect(res.json.latestCliVersion).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/ingest.http.test.ts`
Expected: FAIL — every `t.fetch` returns 404 (no `http.ts` router yet).

- [ ] **Step 3: Extend the imports at the top of `web/convex/ingest.ts`**

Replace the existing import block with:

```ts
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
import type { Doc } from "./_generated/dataModel";
import { httpAction, internalMutation, type ActionCtx } from "./_generated/server";
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
```

- [ ] **Step 4: Append the HTTP handlers to `web/convex/ingest.ts`**

```ts
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
```

- [ ] **Step 5: Create `web/convex/http.ts`**

```ts
import { httpRouter } from "convex/server";
import { HEALTH_PATH, SYNC_PATH, WHOAMI_PATH } from "../../shared/src/constants";
import { healthHandler, syncHandler, whoamiHandler } from "./ingest";

const http = httpRouter();

http.route({ path: SYNC_PATH, method: "POST", handler: syncHandler });
http.route({ path: WHOAMI_PATH, method: "GET", handler: whoamiHandler });
http.route({ path: HEALTH_PATH, method: "GET", handler: healthHandler });

export default http;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/ingest.http.test.ts convex/ingest.internal.test.ts`
Expected: 18 tests PASS (11 in `ingest.http.test.ts`, 7 in `ingest.internal.test.ts`; the 503 test logs one `codex-kaboo ingest failed` line to stderr — expected).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w web`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add web/convex/ingest.ts web/convex/http.ts web/convex/ingest.http.test.ts
git commit -m "Add /api/v1 sync, whoami and health HTTP endpoints

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 12: End-to-end ingest behaviour through the HTTP endpoint

**Files:**
- Test: `web/convex/ingest.integration.test.ts` (no production code changes; any failure here is a bug in Tasks 8–11 and is fixed in the file that owns it)

**Interfaces:**
- Consumes: everything from Tasks 7–11 via `postSync`, `getRollup`, fixture builders.
- Produces: the behavioural guarantees the CLI relies on — idempotent re-send, replace-on-change, cross-user isolation, chunked ingestion of 2,500 events, throttled `lastUsedAt`, newest-observation rate limit, hostname opt-in/out, in-progress patching.

- [ ] **Step 1: Write the tests**

```ts
// web/convex/ingest.integration.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRollup,
  makeBatch,
  makeEvent,
  makeMachine,
  makeSession,
  postSync,
  setup,
  T0,
  userWithToken,
} from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0 + 7_200_000));
});
afterEach(() => vi.useRealTimers());

function baseBatch() {
  return makeBatch({
    sessions: [makeSession({ sessionId: "s1" }), makeSession({ sessionId: "s2", project: "project-b" })],
    tokenEvents: [
      makeEvent({ sessionId: "s1", seq: 3 }),
      makeEvent({ sessionId: "s1", seq: 7, hour: 10 }),
      makeEvent({ sessionId: "s2", seq: 2, project: "project-b" }),
    ],
  });
}

describe("heartbeat", () => {
  it("accepts an empty batch: machine upserted, lastSyncAt updated, zero counts, no rollups", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const res = await postSync(t, raw, makeBatch({ sessions: [], tokenEvents: [] }));
    expect(res.status).toBe(200);
    expect(res.json.accepted).toEqual({
      sessions: { inserted: 0, updated: 0, unchanged: 0 },
      events: { inserted: 0, updated: 0, unchanged: 0 },
    });
    const machine = await t.run(async (ctx) => ctx.db.query("machines").unique());
    expect(machine?.lastSyncAt).toBe(T0 + 7_200_000);
    expect(await t.run(async (ctx) => ctx.db.query("dailyRollups").collect())).toHaveLength(0);
  });
});

describe("sync idempotence", () => {
  it("re-sending an identical batch inserts nothing and leaves the rollup untouched", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    const first = await postSync(t, raw, baseBatch());
    expect(first.status).toBe(200);
    const before = await getRollup(t, userId, "2026-08-31");

    vi.advanceTimersByTime(5 * 60_000);
    const second = await postSync(t, raw, baseBatch());
    expect(second.status).toBe(200);
    expect(second.json.accepted).toEqual({
      sessions: { inserted: 0, updated: 0, unchanged: 2 },
      events: { inserted: 0, updated: 0, unchanged: 3 },
    });
    const after = await getRollup(t, userId, "2026-08-31");
    expect(after?.computedAt).toBe(first.json.serverTime);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(await t.run(async (ctx) => ctx.db.query("sessions").collect())).toHaveLength(2);
    expect(await t.run(async (ctx) => ctx.db.query("tokenEvents").collect())).toHaveLength(3);
  });

  it("replaces a session whose summaryHash changed and recomputes its day", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    await postSync(t, raw, baseBatch());
    vi.advanceTimersByTime(60_000);
    const changed = baseBatch();
    changed.sessions[0] = makeSession({ sessionId: "s1", turns: 9, summaryHash: "b".repeat(40) });
    const res = await postSync(t, raw, changed);
    expect(res.json.accepted.sessions).toEqual({ inserted: 0, updated: 1, unchanged: 1 });
    expect(await getRollup(t, userId, "2026-08-31")).toMatchObject({
      turns: 11,
      computedAt: res.json.serverTime,
    });
  });

  it("replaces a modified event and recomputes both its old and new day", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    await postSync(t, raw, baseBatch());
    vi.advanceTimersByTime(60_000);
    const changed = baseBatch();
    changed.tokenEvents = [
      makeEvent({ sessionId: "s1", seq: 7, day: "2026-09-01", hour: 1, output: 1000, total: 1500 }),
    ];
    const res = await postSync(t, raw, changed);
    expect(res.json.accepted.events).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(res.json.accepted.sessions).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    expect(await getRollup(t, userId, "2026-08-31")).toMatchObject({
      responses: 2,
      computedAt: res.json.serverTime,
    });
    const day2 = await getRollup(t, userId, "2026-09-01");
    expect(day2).toMatchObject({ responses: 1, sessions: 0 });
    expect(day2?.tokens.total).toBe(1500);
  });

  it("patches inProgress and lineCount when the hash is unchanged", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    await postSync(t, raw, makeBatch({
      sessions: [makeSession({ sessionId: "s1", inProgress: true, lineCount: 10 })],
    }));
    const res = await postSync(t, raw, makeBatch({
      sessions: [makeSession({ sessionId: "s1", inProgress: false, lineCount: 12 })],
    }));
    expect(res.json.accepted.sessions).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    const s1 = await t.run(async (ctx) =>
      ctx.db.query("sessions").withIndex("by_sessionId", (q) => q.eq("sessionId", "s1")).unique(),
    );
    expect(s1).toMatchObject({ inProgress: false, lineCount: 12 });
  });
});

describe("cross-user isolation", () => {
  it("reports another user's sessions and events as conflicts without merging", async () => {
    const t = setup();
    const alice = await userWithToken(t, "alice");
    const bob = await userWithToken(t, "bob");
    expect((await postSync(t, alice.raw, baseBatch())).status).toBe(200);

    const stolen = makeBatch({
      machine: makeMachine({ machineId: "machine-2" }),
      sessions: [
        makeSession({ sessionId: "s1", turns: 99, summaryHash: "c".repeat(40) }),
        makeSession({ sessionId: "s9" }),
      ],
      tokenEvents: [
        makeEvent({ sessionId: "s1", seq: 3, output: 1 }),
        makeEvent({ sessionId: "s9", seq: 1 }),
      ],
    });
    const res = await postSync(t, bob.raw, stolen);
    expect(res.status).toBe(200);
    expect(res.json.accepted).toEqual({
      sessions: { inserted: 1, updated: 0, unchanged: 0 },
      events: { inserted: 1, updated: 0, unchanged: 0 },
    });
    expect(res.json.conflicts).toEqual({ sessions: ["s1"], events: 1 });

    expect((await getRollup(t, alice.userId, "2026-08-31"))?.turns).toBe(4);
    const s1 = await t.run(async (ctx) =>
      ctx.db.query("sessions").withIndex("by_sessionId", (q) => q.eq("sessionId", "s1")).unique(),
    );
    expect(s1).toMatchObject({ userId: alice.userId, turns: 2 });
    expect(await getRollup(t, bob.userId, "2026-08-31")).toMatchObject({ sessions: 1, responses: 1 });
  });
});

describe("chunking", () => {
  it("ingests 2,500 events of one request through three mutations", async () => {
    const t = setup();
    const { userId, raw } = await userWithToken(t, "alice");
    const tokenEvents = Array.from({ length: 2500 }, (_, i) =>
      makeEvent({ sessionId: `s${i % 3}`, seq: i }),
    );
    const res = await postSync(t, raw, makeBatch({ tokenEvents }));
    expect(res.status).toBe(200);
    expect(res.json.accepted.events).toEqual({ inserted: 2500, updated: 0, unchanged: 0 });
    const rollup = await getRollup(t, userId, "2026-08-31");
    expect(rollup?.responses).toBe(2500);
    expect(rollup?.tokens.total).toBe(2500 * 600);
    expect(await t.run(async (ctx) => ctx.db.query("tokenEvents").collect())).toHaveLength(2500);
  }, 60_000);
});

describe("machine bookkeeping", () => {
  it("writes the token's lastUsedAt at most once per minute", async () => {
    const t = setup();
    const { raw, tokenId } = await userWithToken(t, "alice");
    const first = await postSync(t, raw, makeBatch());
    const firstUsed = (await t.run(async (ctx) => ctx.db.get(tokenId)))?.lastUsedAt;
    expect(firstUsed).toBe(first.json.serverTime);

    vi.advanceTimersByTime(30_000);
    await postSync(t, raw, makeBatch());
    expect((await t.run(async (ctx) => ctx.db.get(tokenId)))?.lastUsedAt).toBe(firstUsed);

    vi.advanceTimersByTime(31_000);
    const third = await postSync(t, raw, makeBatch());
    expect((await t.run(async (ctx) => ctx.db.get(tokenId)))?.lastUsedAt).toBe(third.json.serverTime);
  });

  it("keeps the newest rate-limit observation regardless of arrival order", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    const newer = { observedAt: T0 + 100_000, usedPercent: 40, windowMinutes: 10080 };
    const older = { observedAt: T0 + 50_000, usedPercent: 35, windowMinutes: 10080 };
    const first = await postSync(t, raw, makeBatch({ rateLimit: newer }));
    vi.advanceTimersByTime(60_000);
    await postSync(t, raw, makeBatch({ rateLimit: older }));
    const machine = await t.run(async (ctx) => ctx.db.query("machines").first());
    expect(machine?.lastRateLimit).toEqual({ ...newer, receivedAt: first.json.serverTime });
    expect(machine?.lastSyncAt).toBe(first.json.serverTime + 60_000);
  });

  it("stores the hostname only when sent and clears it on null", async () => {
    const t = setup();
    const { raw } = await userWithToken(t, "alice");
    await postSync(t, raw, makeBatch({ machine: makeMachine({ hostname: "mac.local" }) }));
    expect((await t.run(async (ctx) => ctx.db.query("machines").first()))?.hostname).toBe("mac.local");
    await postSync(t, raw, makeBatch({ machine: makeMachine({ hostname: null }) }));
    expect((await t.run(async (ctx) => ctx.db.query("machines").first()))?.hostname).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd web && npx vitest run --project convex convex/ingest.integration.test.ts`
Expected: 10 tests PASS. If one fails, fix the owning module (Tasks 8–11), re-run that module's tests, then this file.

- [ ] **Step 3: Run the whole convex project and typecheck**

Run: `npm run test -w web -- --project convex && npm run typecheck -w web`
Expected: all files PASS, tsc exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/convex/ingest.integration.test.ts
git commit -m "Add end-to-end ingest tests for idempotence, isolation and chunking

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 13: Dashboard stats — `summary` and `leaderboard` (`stats.ts` part 1)

**Files:**
- Create: `web/convex/stats.ts`
- Test: `web/convex/stats.test.ts`

**Interfaces:**
- Consumes: `percentChange`, `ratio`, `ttftMean`, `ttftMedianApprox` from `shared/src/metrics.ts`; `mergeRollups`, `Aggregate` (Task 6); `authedQuery` (Task 7); `loadPriceMap`, `sumCost` (Task 4); `resolvePeriods` (Task 3); `displayName` (Task 7); result types (Task 1).
- Produces: `METRIC_KEYS: MetricKey[]`, `loadRollups(ctx, range, userId?)`, `metricValues(agg, costUsd): Record<MetricKey, number | null>`, `buildMetrics(current, previous | null): Record<MetricKey, Metric>`, `userRef(ctx, userId): Promise<UserRef>`, `groupByUser(docs)`, `cmpKey` and `byTotalThenName` comparators, and the public queries `stats.summary` and `stats.leaderboard` exactly as contracts §9. Tasks 14–15 append the remaining queries to this file and the test file.

Semantics: team scope reads `dailyRollups.by_day`, user scope `by_user_day`; `previous` defaults to true; a rate metric whose denominator is 0 has `current: 0`, `previous: null-or-value`, `change: null`; `change` is `percentChange(current, previous)` and therefore `null` when the previous value is 0 or absent. Leaderboard ranks by `tokens.total` desc, ties by name asc; `previousRank`/`previousTokens`/`change` are `null` for users without previous-period data or when `previous: false`; users with previous data but no current data are not listed.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/stats.test.ts
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { EventInput, SessionInput } from "./lib/aggregate";
import { withUser, registerUser, seedRollup, setup, ZERO_TOOLS, type Harness } from "./test.helpers";

const ev = (o: Partial<EventInput> = {}): EventInput => ({
  hour: 9, model: "gpt-5.6-sol", effort: "medium", project: "alpha", isSubagent: false,
  input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200,
  ...o,
});
const ses = (o: Partial<SessionInput> = {}): SessionInput => ({
  machineId: "machine-1", project: "alpha", source: "cli", isSubagent: false,
  turns: 2, userMessages: 2, agentMessages: 2, linesAdded: 10, linesRemoved: 2, filesChanged: 1,
  compactions: 0, activeMs: 600_000, wallMs: 3_600_000,
  ttft: { count: 2, sumMs: 1500, hist: [0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  toolCounts: { ...ZERO_TOOLS, commandRead: 3 }, mcpTools: [], skills: [],
  tokens: { input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200 },
  ...o,
});

async function seedPrices(t: Harness) {
  await t.run(async (ctx) => {
    await ctx.db.insert("modelPrices", {
      model: "gpt-5.6-sol", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10,
      source: "seed", updatedAt: 1,
    });
  });
}

/** alice: 08-29 (1 event), 08-30 (1 event + 1 session), 08-31 (2 events + 1 session); bob: 08-31 sub-agent only. */
async function seedTeam(t: Harness): Promise<{ alice: Id<"users">; bob: Id<"users"> }> {
  const alice = await registerUser(t, "alice");
  const bob = await registerUser(t, "bob");
  await seedPrices(t);
  await seedRollup(t, alice, "2026-08-29", [ev()], []);
  await seedRollup(t, alice, "2026-08-30", [ev()], [ses()]);
  await seedRollup(t, alice, "2026-08-31", [ev(), ev({ hour: 10 })], [ses({ project: "beta" })]);
  await seedRollup(
    t, bob, "2026-08-31",
    [ev({ model: "codex-auto-review", effort: undefined, isSubagent: true })],
    [ses({ isSubagent: true, source: "subagent:review", machineId: "machine-2" })],
  );
  return { alice, bob };
}

describe("stats.summary", () => {
  it("folds the team's rollups and compares with the previous period", async () => {
    const t = setup();
    await seedTeam(t);
    const s = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-30", to: "2026-08-31" });
    expect(s.range).toEqual({ from: "2026-08-30", to: "2026-08-31" });
    expect(s.previousRange).toEqual({ from: "2026-08-28", to: "2026-08-29" });
    expect(s.tokens).toEqual({ input: 4000, cachedInput: 1600, cacheWrite: 0, output: 800, reasoning: 200, total: 4800 });
    expect(s.previousTokens?.total).toBe(1200);
    expect(s.metrics.totalTokens).toEqual({ current: 4800, previous: 1200, change: 3 });
    expect(s.metrics.sessions).toEqual({ current: 2, previous: 0, change: null });
    expect(s.metrics.subagentTokens.current).toBe(1200);
    expect(s.metrics.messages.current).toBe(8);
    expect(s.metrics.tokensPerTurn.current).toBe(1200);
    expect(s.metrics.tokensPerLine.current).toBe(240);
    expect(s.metrics.cacheHitRate).toEqual({ current: 0.4, previous: 0.4, change: 0 });
    expect(s.metrics.activeDays).toEqual({ current: 2, previous: 1, change: 1 });
    expect(s.metrics.ttftAvgMs.current).toBe(750);
    expect(s.metrics.ttftP50Ms.current).toBeGreaterThan(0);
    expect(s.metrics.costUsd.current).toBeCloseTo(0.00984, 8);
    expect(s.metrics.costUsd.previous).toBeCloseTo(0.00328, 8);
    expect(s.metrics.costUsd.change).toBeCloseTo(2, 8);
    expect(s.costByKind.reasoning).toBeCloseTo(0.0015, 8);
    expect(s.cacheSavingsUsd).toBeCloseTo(0.00216, 8);
    expect(s.unpricedModels).toEqual(["codex-auto-review"]);
  });

  it("scopes to one user and can skip the previous period", async () => {
    const t = setup();
    const { alice } = await seedTeam(t);
    const mine = await withUser(t, "bob").query(api.stats.summary, { from: "2026-08-30", to: "2026-08-31", userId: alice });
    expect(mine.metrics.totalTokens).toEqual({ current: 3600, previous: 1200, change: 2 });
    expect(mine.metrics.sessions.current).toBe(2);
    expect(mine.unpricedModels).toEqual([]);

    const all = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-30", to: "2026-08-31", previous: false });
    expect(all.previousRange).toBeNull();
    expect(all.previousTokens).toBeNull();
    expect(all.metrics.totalTokens).toEqual({ current: 4800, previous: null, change: null });
  });

  it("returns zeros for an empty range and rejects bad ranges and anonymous callers", async () => {
    const t = setup();
    await seedTeam(t);
    const empty = await withUser(t, "alice").query(api.stats.summary, { from: "2025-01-01", to: "2025-01-07" });
    expect(empty.metrics.totalTokens).toEqual({ current: 0, previous: 0, change: null });
    expect(empty.metrics.cacheHitRate).toEqual({ current: 0, previous: null, change: null });
    await expect(
      withUser(t, "alice").query(api.stats.summary, { from: "2026-08-31", to: "2026-08-30" }),
    ).rejects.toMatchObject({ data: { code: "bad_range" } });
    await expect(t.query(api.stats.summary, { from: "2026-08-30", to: "2026-08-31" })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
  });
});

describe("stats.leaderboard", () => {
  it("ranks users by tokens with previous-period ranks and null for newcomers", async () => {
    const t = setup();
    const { alice, bob } = await seedTeam(t);
    const board = await withUser(t, "alice").query(api.stats.leaderboard, { from: "2026-08-30", to: "2026-08-31" });
    expect(board.previousRange).toEqual({ from: "2026-08-28", to: "2026-08-29" });
    expect(board.rows).toHaveLength(2);
    expect(board.rows[0]).toMatchObject({
      userId: alice, name: "Alice", imageUrl: null, rank: 1, previousRank: 1, previousTokens: 1200, change: 2,
      sessions: 2, turns: 4, messages: 8, userMessages: 4, linesAdded: 20, linesRemoved: 4,
      tokensPerLine: 180, cacheHitRate: 0.4, activeMs: 1_200_000, unpriced: false,
    });
    expect(board.rows[0]?.tokens.total).toBe(3600);
    expect(board.rows[0]?.costUsd).toBeCloseTo(0.00984, 8);
    expect(board.rows[1]).toMatchObject({
      userId: bob, name: "Bob", rank: 2, previousRank: null, previousTokens: null, change: null,
      sessions: 0, costUsd: 0, unpriced: true, tokensPerLine: null,
    });
    expect(board.rows[1]?.tokens.total).toBe(1200);
  });

  it("breaks ties by name and omits previous ranks when previous is false", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    await seedRollup(t, bob, "2026-08-31", [ev()], []);
    await seedRollup(t, alice, "2026-08-31", [ev()], []);
    const board = await withUser(t, "alice").query(api.stats.leaderboard, { from: "2026-08-31", to: "2026-08-31", previous: false });
    expect(board.previousRange).toBeNull();
    expect(board.rows.map((r) => [r.name, r.rank, r.previousRank])).toEqual([["Alice", 1, null], ["Bob", 2, null]]);
    expect(await withUser(t, "alice").query(api.stats.leaderboard, { from: "2025-01-01", to: "2025-01-01" })).toMatchObject({ rows: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/stats.test.ts`
Expected: FAIL — `api.stats` is undefined.

- [ ] **Step 3: Create `web/convex/stats.ts`**

```ts
import { v } from "convex/values";
import { percentChange, ratio, ttftMean, ttftMedianApprox } from "../../shared/src/metrics";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mergeRollups, type Aggregate } from "./lib/aggregate";
import { authedQuery } from "./lib/auth";
import { loadPriceMap, sumCost } from "./lib/cost";
import { resolvePeriods } from "./lib/days";
import type {
  LeaderboardResult,
  LeaderboardRow,
  Metric,
  MetricKey,
  Range,
  SummaryResult,
  UserRef,
} from "./lib/types";
import { displayName } from "./users";

export const METRIC_KEYS: MetricKey[] = [
  "totalTokens", "inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens",
  "subagentTokens", "costUsd", "linesAdded", "linesRemoved", "filesChanged",
  "sessions", "turns", "responses", "messages", "userMessages", "agentMessages",
  "cacheHitRate", "tokensPerTurn", "tokensPerLine", "avgSessionActiveMs", "activeRate",
  "activeMs", "wallMs", "ttftAvgMs", "ttftP50Ms", "compactions", "activeDays",
];

// ---------- shared helpers (also used by Tasks 14–15) ----------

/** Team scope reads by_day, user scope by_user_day; both inclusive on [from, to]. */
export async function loadRollups(
  ctx: QueryCtx,
  range: Range,
  userId?: Id<"users">,
): Promise<Doc<"dailyRollups">[]> {
  if (userId !== undefined) {
    return await ctx.db
      .query("dailyRollups")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).gte("day", range.from).lte("day", range.to),
      )
      .collect();
  }
  return await ctx.db
    .query("dailyRollups")
    .withIndex("by_day", (q) => q.gte("day", range.from).lte("day", range.to))
    .collect();
}

/** Every card metric as a plain number; `null` marks an undefined rate (division by zero). */
export function metricValues(agg: Aggregate, costUsd: number): Record<MetricKey, number | null> {
  const t = agg.tokens;
  return {
    totalTokens: t.total,
    inputTokens: t.input,
    cachedInputTokens: t.cachedInput,
    outputTokens: t.output,
    reasoningTokens: t.reasoning,
    subagentTokens: agg.subagentTokens.total,
    costUsd,
    linesAdded: agg.linesAdded,
    linesRemoved: agg.linesRemoved,
    filesChanged: agg.filesChanged,
    sessions: agg.sessions,
    turns: agg.turns,
    responses: agg.responses,
    messages: agg.userMessages + agg.agentMessages,
    userMessages: agg.userMessages,
    agentMessages: agg.agentMessages,
    cacheHitRate: ratio(t.cachedInput, t.input),
    tokensPerTurn: ratio(t.total, agg.turns),
    tokensPerLine: ratio(t.total, agg.linesAdded),
    avgSessionActiveMs: ratio(agg.activeMs, agg.sessions),
    activeRate: ratio(agg.activeMs, agg.wallMs),
    activeMs: agg.activeMs,
    wallMs: agg.wallMs,
    ttftAvgMs: ttftMean(agg.ttft),
    ttftP50Ms: ttftMedianApprox(agg.ttft),
    compactions: agg.compactions,
    activeDays: agg.activeDays,
  };
}

export function buildMetrics(
  current: Record<MetricKey, number | null>,
  previous: Record<MetricKey, number | null> | null,
): Record<MetricKey, Metric> {
  const out = {} as Record<MetricKey, Metric>;
  for (const key of METRIC_KEYS) {
    const cur = current[key];
    const prev = previous ? previous[key] : null;
    out[key] = {
      current: cur ?? 0,
      previous: prev,
      change: cur === null || prev === null ? null : percentChange(cur, prev),
    };
  }
  return out;
}

export async function userRef(ctx: QueryCtx, userId: Id<"users">): Promise<UserRef> {
  const user = await ctx.db.get(userId);
  return {
    userId,
    name: user ? displayName(user) : "Unknown",
    imageUrl: user?.imageUrl ?? null,
  };
}

export function groupByUser(docs: Doc<"dailyRollups">[]): Map<Id<"users">, Doc<"dailyRollups">[]> {
  const groups = new Map<Id<"users">, Doc<"dailyRollups">[]>();
  for (const doc of docs) {
    const list = groups.get(doc.userId);
    if (list) list.push(doc);
    else groups.set(doc.userId, [doc]);
  }
  return groups;
}

export function cmpKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function byTotalThenName(a: { total: number; name: string }, b: { total: number; name: string }): number {
  return b.total - a.total || cmpKey(a.name, b.name);
}

// ---------- queries ----------

export const summary = authedQuery({
  args: {
    from: v.string(),
    to: v.string(),
    userId: v.optional(v.id("users")),
    previous: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SummaryResult> => {
    const { range, previousRange } = resolvePeriods(args.from, args.to, args.previous);
    const prices = await loadPriceMap(ctx);
    const current = mergeRollups(await loadRollups(ctx, range, args.userId));
    const previous = previousRange
      ? mergeRollups(await loadRollups(ctx, previousRange, args.userId))
      : null;
    const currentCost = sumCost(current.byModel, prices);
    const previousValues = previous
      ? metricValues(previous, sumCost(previous.byModel, prices).totalUsd)
      : null;
    return {
      range,
      previousRange,
      tokens: current.tokens,
      previousTokens: previous ? previous.tokens : null,
      metrics: buildMetrics(metricValues(current, currentCost.totalUsd), previousValues),
      costByKind: currentCost.byKind,
      cacheSavingsUsd: currentCost.cacheSavingsUsd,
      unpricedModels: currentCost.unpricedModels,
    };
  },
});

export const leaderboard = authedQuery({
  args: { from: v.string(), to: v.string(), previous: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<LeaderboardResult> => {
    const { range, previousRange } = resolvePeriods(args.from, args.to, args.previous);
    const prices = await loadPriceMap(ctx);
    const current = groupByUser(await loadRollups(ctx, range));
    const previous = previousRange ? groupByUser(await loadRollups(ctx, previousRange)) : null;

    const refs = new Map<Id<"users">, UserRef>();
    for (const userId of [...current.keys(), ...(previous ? previous.keys() : [])]) {
      if (!refs.has(userId)) refs.set(userId, await userRef(ctx, userId));
    }
    const refFor = (userId: Id<"users">): UserRef =>
      refs.get(userId) ?? { userId, name: "Unknown", imageUrl: null };

    const previousRanks = new Map<Id<"users">, { rank: number; total: number }>();
    if (previous) {
      const prevRows = [...previous].map(([userId, docs]) => ({
        userId,
        name: refFor(userId).name,
        total: mergeRollups(docs).tokens.total,
      }));
      prevRows.sort(byTotalThenName);
      prevRows.forEach((row, index) => previousRanks.set(row.userId, { rank: index + 1, total: row.total }));
    }

    const rows: LeaderboardRow[] = [...current].map(([userId, docs]) => {
      const agg = mergeRollups(docs);
      const cost = sumCost(agg.byModel, prices);
      const prev = previousRanks.get(userId) ?? null;
      return {
        ...refFor(userId),
        tokens: agg.tokens,
        costUsd: cost.totalUsd,
        unpriced: cost.unpricedModels.length > 0,
        sessions: agg.sessions,
        turns: agg.turns,
        messages: agg.userMessages + agg.agentMessages,
        userMessages: agg.userMessages,
        linesAdded: agg.linesAdded,
        linesRemoved: agg.linesRemoved,
        tokensPerLine: ratio(agg.tokens.total, agg.linesAdded),
        cacheHitRate: ratio(agg.tokens.cachedInput, agg.tokens.input),
        activeMs: agg.activeMs,
        rank: 0,
        previousRank: prev ? prev.rank : null,
        previousTokens: prev ? prev.total : null,
        change: prev ? percentChange(agg.tokens.total, prev.total) : null,
      };
    });
    rows.sort((a, b) => b.tokens.total - a.tokens.total || cmpKey(a.name, b.name));
    rows.forEach((row, index) => {
      row.rank = index + 1;
    });
    return { range, previousRange, rows };
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/stats.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/stats.ts web/convex/stats.test.ts
git commit -m "Add summary and leaderboard stats queries over daily rollups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 14: Dashboard stats — `trends` and `breakdowns` (`stats.ts` part 2)

**Files:**
- Modify: `web/convex/stats.ts` (extend imports, append two queries)
- Test: `web/convex/stats.test.ts` (append describe blocks)

**Interfaces:**
- Consumes: `bucketStart`, `eachBucket` from `shared/src/days.ts`; `addTokens`, `emptyTokens` from `shared/src/metrics.ts`; `assertRange` (Task 3); `priceTokens` (Task 4); Task 13 helpers.
- Produces: `stats.trends({ from, to, bucket, userId? }): TrendsResult` (zero-filled buckets, `byUser` keyed by userId string, `byModel` folded over efforts, `users` sorted by name, `models` by total tokens desc, `peak` = first bucket with the highest non-zero total) and `stats.breakdowns({ from, to, userId? }): BreakdownsResult` (all arrays sorted by their primary value desc then key asc; `byTool` always has 9 entries; `byMachine.label` from the `machines` table, falling back to the key).

- [ ] **Step 1: Append the failing tests to `web/convex/stats.test.ts`**

```ts
describe("stats.trends", () => {
  it("zero-fills daily buckets and reports per-user, per-model series and the peak", async () => {
    const t = setup();
    const { alice, bob } = await seedTeam(t);
    const r = await withUser(t, "alice").query(api.stats.trends, { from: "2026-08-29", to: "2026-08-31", bucket: "day" });
    expect(r.bucket).toBe("day");
    expect(r.points.map((p) => [p.bucket, p.total])).toEqual([
      ["2026-08-29", 1200],
      ["2026-08-30", 1200],
      ["2026-08-31", 3600],
    ]);
    const last = r.points[2]!;
    expect(last.sessions).toBe(1);
    expect(last.activeMs).toBe(600_000);
    expect(last.costUsd).toBeCloseTo(0.00656, 8);
    expect(last.byUser).toHaveLength(2);
    expect(last.byUser.find((u) => u.key === alice)).toMatchObject({ tokens: 2400, activeMs: 600_000 });
    expect(last.byUser.find((u) => u.key === bob)).toMatchObject({ tokens: 1200, costUsd: 0, activeMs: 0 });
    expect(last.byModel).toEqual([
      { key: "gpt-5.6-sol", tokens: 2400 },
      { key: "codex-auto-review", tokens: 1200 },
    ]);
    expect(r.users.map((u) => u.name)).toEqual(["Alice", "Bob"]);
    expect(r.models).toEqual(["gpt-5.6-sol", "codex-auto-review"]);
    expect(r.peak).toEqual({ bucket: "2026-08-31", total: 3600 });
  });

  it("buckets by week and month, scopes to a user and handles empty ranges", async () => {
    const t = setup();
    const { alice } = await seedTeam(t);
    const weekly = await withUser(t, "alice").query(api.stats.trends, { from: "2026-08-24", to: "2026-09-06", bucket: "week" });
    expect(weekly.points.map((p) => [p.bucket, p.total])).toEqual([
      ["2026-08-24", 2400],
      ["2026-08-31", 3600],
    ]);
    const monthly = await withUser(t, "alice").query(api.stats.trends, { from: "2026-07-01", to: "2026-09-30", bucket: "month" });
    expect(monthly.points.map((p) => [p.bucket, p.total])).toEqual([
      ["2026-07-01", 0],
      ["2026-08-01", 6000],
      ["2026-09-01", 0],
    ]);
    expect(monthly.peak).toEqual({ bucket: "2026-08-01", total: 6000 });

    const mine = await withUser(t, "bob").query(api.stats.trends, { from: "2026-08-31", to: "2026-08-31", bucket: "day", userId: alice });
    expect(mine.points[0]?.total).toBe(2400);
    expect(mine.points[0]?.byUser).toHaveLength(1);
    expect(mine.models).toEqual(["gpt-5.6-sol"]);

    const empty = await withUser(t, "alice").query(api.stats.trends, { from: "2025-01-01", to: "2025-01-03", bucket: "day" });
    expect(empty.points.map((p) => p.total)).toEqual([0, 0, 0]);
    expect(empty.users).toEqual([]);
    expect(empty.models).toEqual([]);
    expect(empty.peak).toBeNull();
  });
});

describe("stats.breakdowns", () => {
  it("returns every breakdown sorted by size with shares and machine labels", async () => {
    const t = setup();
    const { alice } = await seedTeam(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "machine-1", userId: alice, label: "brisk-otter", platform: "darwin",
        cliVersion: "0.1.0", firstSeenAt: 1, lastSyncAt: 1,
      });
    });
    const b = await withUser(t, "alice").query(api.stats.breakdowns, { from: "2026-08-30", to: "2026-08-31" });
    expect(b.totalTokens).toBe(4800);
    expect(b.byModelEffort.map((m) => [m.key, m.effort, m.tokens.total, m.share])).toEqual([
      ["gpt-5.6-sol", "medium", 3600, 0.75],
      ["codex-auto-review", null, 1200, 0.25],
    ]);
    expect(b.byModelEffort[0]?.costUsd).toBeCloseTo(0.00984, 8);
    expect(b.byModelEffort[1]?.costUsd).toBeNull();
    expect(b.byModel.map((m) => [m.key, m.effort, m.responses])).toEqual([
      ["gpt-5.6-sol", null, 3],
      ["codex-auto-review", null, 1],
    ]);
    expect(b.byEffort).toEqual([
      { key: "medium", tokens: 3600, responses: 3, share: 0.75 },
      { key: "(none)", tokens: 1200, responses: 1, share: 0.25 },
    ]);
    expect(b.toolCalls).toBe(6);
    expect(b.byTool).toHaveLength(9);
    expect(b.byTool[0]).toEqual({ key: "commandRead", count: 6, share: 1 });
    expect(b.byMcpTool).toEqual([]);
    expect(b.bySkill).toEqual([]);
    expect(b.byProject).toEqual([
      { key: "alpha", tokens: 4800, responses: 4, sessions: 1, userMessages: 2, linesAdded: 10, linesRemoved: 2, share: 1 },
      { key: "beta", tokens: 0, responses: 0, sessions: 1, userMessages: 2, linesAdded: 10, linesRemoved: 2, share: 0 },
    ]);
    expect(b.byMachine).toEqual([
      { key: "machine-1", label: "brisk-otter", tokens: 2400, sessions: 2, share: 0.5 },
      { key: "machine-2", label: "machine-2", tokens: 1200, sessions: 1, share: 0.25 },
    ]);
    expect(b.bySource).toEqual([
      { key: "cli", tokens: 2400, sessions: 2, share: 0.5 },
      { key: "subagent:review", tokens: 1200, sessions: 1, share: 0.25 },
    ]);
    expect(b.byHour[9]).toBe(3600);
    expect(b.byHour[10]).toBe(1200);
    expect(b.byHour).toHaveLength(24);
  });

  it("is empty but well-formed without data", async () => {
    const t = setup();
    await registerUser(t, "alice");
    const b = await withUser(t, "alice").query(api.stats.breakdowns, { from: "2025-01-01", to: "2025-01-01" });
    expect(b.totalTokens).toBe(0);
    expect(b.byModel).toEqual([]);
    expect(b.byTool.every((t) => t.count === 0 && t.share === 0)).toBe(true);
    expect(b.byHour).toEqual(new Array(24).fill(0));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/stats.test.ts`
Expected: FAIL — `api.stats.trends` / `api.stats.breakdowns` undefined.

- [ ] **Step 3: Extend the imports of `web/convex/stats.ts`**

Replace the first two import lines with:

```ts
import { v } from "convex/values";
import { bucketStart, eachBucket } from "../../shared/src/days";
import { addTokens, emptyTokens, percentChange, ratio, ttftMean, ttftMedianApprox } from "../../shared/src/metrics";
import type { Tokens } from "../../shared/src/sync";
```

extend the `./lib/days` import to `import { assertRange, resolvePeriods } from "./lib/days";`, the `./lib/cost` import to `import { loadPriceMap, priceTokens, sumCost } from "./lib/cost";`, and add `BreakdownsResult`, `ModelRow`, `TrendPoint`, `TrendsResult` to the `./lib/types` import.

- [ ] **Step 4: Append to `web/convex/stats.ts`**

```ts
export const trends = authedQuery({
  args: {
    from: v.string(),
    to: v.string(),
    bucket: v.union(v.literal("day"), v.literal("week"), v.literal("month")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<TrendsResult> => {
    const range = assertRange(args.from, args.to);
    const prices = await loadPriceMap(ctx);
    const docs = await loadRollups(ctx, range, args.userId);

    const byBucket = new Map<string, Doc<"dailyRollups">[]>();
    for (const doc of docs) {
      const key = bucketStart(doc.day, args.bucket);
      const list = byBucket.get(key);
      if (list) list.push(doc);
      else byBucket.set(key, [doc]);
    }

    const userIds = new Set<Id<"users">>();
    const modelTotals = new Map<string, number>();
    const points: TrendPoint[] = eachBucket(range.from, range.to, args.bucket).map((bucket) => {
      const bucketDocs = byBucket.get(bucket) ?? [];
      const agg = mergeRollups(bucketDocs);
      const byUser = [...groupByUser(bucketDocs)]
        .map(([userId, userDocs]) => {
          userIds.add(userId);
          const u = mergeRollups(userDocs);
          return {
            key: userId as string,
            tokens: u.tokens.total,
            costUsd: sumCost(u.byModel, prices).totalUsd,
            activeMs: u.activeMs,
          };
        })
        .sort((a, b) => cmpKey(a.key, b.key));
      const models = new Map<string, number>();
      for (const m of agg.byModel) models.set(m.key, (models.get(m.key) ?? 0) + m.tokens.total);
      const byModel = [...models]
        .map(([key, tokens]) => ({ key, tokens }))
        .sort((a, b) => b.tokens - a.tokens || cmpKey(a.key, b.key));
      for (const m of byModel) modelTotals.set(m.key, (modelTotals.get(m.key) ?? 0) + m.tokens);
      return {
        bucket,
        total: agg.tokens.total,
        tokens: agg.tokens,
        costUsd: sumCost(agg.byModel, prices).totalUsd,
        activeMs: agg.activeMs,
        sessions: agg.sessions,
        byUser,
        byModel,
      };
    });

    const users: UserRef[] = [];
    for (const userId of userIds) users.push(await userRef(ctx, userId));
    users.sort((a, b) => cmpKey(a.name, b.name));
    const models = [...modelTotals]
      .sort((a, b) => b[1] - a[1] || cmpKey(a[0], b[0]))
      .map(([key]) => key);
    let peak: TrendsResult["peak"] = null;
    for (const point of points) {
      if (point.total > 0 && (peak === null || point.total > peak.total)) {
        peak = { bucket: point.bucket, total: point.total };
      }
    }
    return { bucket: args.bucket, points, users, models, peak };
  },
});

export const breakdowns = authedQuery({
  args: { from: v.string(), to: v.string(), userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<BreakdownsResult> => {
    const range = assertRange(args.from, args.to);
    const prices = await loadPriceMap(ctx);
    const agg = mergeRollups(await loadRollups(ctx, range, args.userId));
    const totalTokens = agg.tokens.total;
    const share = (n: number) => ratio(n, totalTokens) ?? 0;
    const tokensDesc = <T extends { key: string; tokens: number }>(a: T, b: T) =>
      b.tokens - a.tokens || cmpKey(a.key, b.key);
    const countDesc = <T extends { key: string; count: number }>(a: T, b: T) =>
      b.count - a.count || cmpKey(a.key, b.key);
    const modelRowsDesc = (a: ModelRow, b: ModelRow) =>
      b.tokens.total - a.tokens.total || cmpKey(a.key, b.key) || cmpKey(a.effort ?? "", b.effort ?? "");

    const byModelEffort: ModelRow[] = agg.byModel
      .map((m) => ({
        key: m.key,
        effort: m.effort ?? null,
        tokens: m.tokens,
        responses: m.responses,
        costUsd: priceTokens(m.key, m.tokens, prices)?.total ?? null,
        share: share(m.tokens.total),
      }))
      .sort(modelRowsDesc);

    const models = new Map<string, { tokens: Tokens; responses: number }>();
    const efforts = new Map<string, { tokens: number; responses: number }>();
    for (const m of agg.byModel) {
      const model = models.get(m.key) ?? { tokens: emptyTokens(), responses: 0 };
      model.tokens = addTokens(model.tokens, m.tokens);
      model.responses += m.responses;
      models.set(m.key, model);
      const effortKey = m.effort ?? "(none)";
      const effort = efforts.get(effortKey) ?? { tokens: 0, responses: 0 };
      effort.tokens += m.tokens.total;
      effort.responses += m.responses;
      efforts.set(effortKey, effort);
    }
    const byModel: ModelRow[] = [...models]
      .map(([key, m]) => ({
        key,
        effort: null,
        tokens: m.tokens,
        responses: m.responses,
        costUsd: priceTokens(key, m.tokens, prices)?.total ?? null,
        share: share(m.tokens.total),
      }))
      .sort(modelRowsDesc);
    const byEffort = [...efforts]
      .map(([key, e]) => ({ key, tokens: e.tokens, responses: e.responses, share: share(e.tokens) }))
      .sort(tokensDesc);

    const toolCalls = agg.byTool.reduce((sum, t) => sum + t.count, 0);
    const byTool = agg.byTool
      .map((t) => ({ key: t.key, count: t.count, share: ratio(t.count, toolCalls) ?? 0 }))
      .sort(countDesc);
    const byMcpTool = [...agg.byMcpTool].sort(countDesc);
    const bySkill = [...agg.bySkill].sort(countDesc);
    const byProject = agg.byProject.map((p) => ({ ...p, share: share(p.tokens) })).sort(tokensDesc);

    const byMachine = [];
    for (const m of agg.byMachine) {
      const machine = await ctx.db
        .query("machines")
        .withIndex("by_machineId", (q) => q.eq("machineId", m.key))
        .unique();
      byMachine.push({
        key: m.key,
        label: machine?.label ?? m.key,
        tokens: m.tokens,
        sessions: m.sessions,
        share: share(m.tokens),
      });
    }
    byMachine.sort(tokensDesc);
    const bySource = agg.bySource.map((s) => ({ ...s, share: share(s.tokens) })).sort(tokensDesc);

    return {
      totalTokens,
      byModel,
      byModelEffort,
      byEffort,
      byTool,
      byMcpTool,
      bySkill,
      byProject,
      byMachine,
      bySource,
      byHour: agg.byHour,
      toolCalls,
    };
  },
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/stats.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/convex/stats.ts web/convex/stats.test.ts
git commit -m "Add trends and breakdowns stats queries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 15: Dashboard stats — heatmaps, quota and bounds (`stats.ts` part 3)

**Files:**
- Modify: `web/convex/stats.ts` (extend imports, append four queries)
- Test: `web/convex/stats.test.ts` (append describe blocks)

**Interfaces:**
- Consumes: `weekdayOf` from `shared/src/days.ts` (0 = Monday … 6 = Sunday); Task 13 helpers.
- Produces: `stats.activityHeatmap({ userId, from, to }): ActivityHeatmapResult` (only days with `tokens.total > 0 || sessions > 0`, ascending), `stats.dayHourHeatmap({ from, to, userId? }): DayHourHeatmapResult` (7 × 24 grid of total tokens; `peak*` null when `max` is 0), `stats.quota(): QuotaResult` (machine with the newest `lastRateLimit.receivedAt`, ties by `observedAt`), `stats.bounds({ userId? }): BoundsResult` (first/last rollup day).

- [ ] **Step 1: Append the failing tests to `web/convex/stats.test.ts`**

```ts
describe("stats.activityHeatmap", () => {
  it("lists only days with data for one user, with cost and maxima", async () => {
    const t = setup();
    const { alice, bob } = await seedTeam(t);
    await seedRollup(t, alice, "2026-08-15", [], [ses({ isSubagent: true, source: "subagent:review" })]);
    const r = await withUser(t, "alice").query(api.stats.activityHeatmap, { userId: alice, from: "2026-08-01", to: "2026-08-31" });
    expect(r.range).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(r.days.map((d) => [d.day, d.tokens, d.sessions])).toEqual([
      ["2026-08-29", 1200, 0],
      ["2026-08-30", 1200, 1],
      ["2026-08-31", 2400, 1],
    ]);
    expect(r.days[2]?.costUsd).toBeCloseTo(0.00656, 8);
    expect(r.activeDays).toBe(3);
    expect(r.maxTokens).toBe(2400);

    const b = await withUser(t, "alice").query(api.stats.activityHeatmap, { userId: bob, from: "2026-08-01", to: "2026-08-31" });
    expect(b.days).toEqual([{ day: "2026-08-31", tokens: 1200, sessions: 0, costUsd: 0 }]);
  });
});

describe("stats.dayHourHeatmap", () => {
  it("accumulates hourly tokens per weekday (Monday = 0) and finds the peak cell", async () => {
    const t = setup();
    await seedTeam(t);
    const r = await withUser(t, "alice").query(api.stats.dayHourHeatmap, { from: "2026-08-29", to: "2026-08-31" });
    expect(r.grid).toHaveLength(7);
    expect(r.grid.every((row) => row.length === 24)).toBe(true);
    expect(r.grid[5]?.[9]).toBe(1200); // Saturday 2026-08-29
    expect(r.grid[6]?.[9]).toBe(1200); // Sunday 2026-08-30
    expect(r.grid[0]?.[9]).toBe(2400); // Monday 2026-08-31 (alice + bob)
    expect(r.grid[0]?.[10]).toBe(1200);
    expect(r.max).toBe(2400);
    expect(r.peakWeekday).toBe(0);
    expect(r.peakHour).toBe(9);
  });

  it("returns an all-zero grid without peaks when there is no data", async () => {
    const t = setup();
    await registerUser(t, "alice");
    const r = await withUser(t, "alice").query(api.stats.dayHourHeatmap, { from: "2025-01-01", to: "2025-01-07" });
    expect(r.grid.flat().every((v) => v === 0)).toBe(true);
    expect(r).toMatchObject({ max: 0, peakHour: null, peakWeekday: null });
  });
});

describe("stats.quota", () => {
  it("returns null without snapshots and otherwise the most recently received one", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    expect(await withUser(t, "alice").query(api.stats.quota, {})).toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "machine-1", userId: alice, label: "brisk-otter", platform: "darwin", cliVersion: "0.1.0",
        firstSeenAt: 1, lastSyncAt: 100,
        lastRateLimit: { observedAt: 90, usedPercent: 10, windowMinutes: 10080, resetsAt: 1000, planType: "team", receivedAt: 100 },
      });
      await ctx.db.insert("machines", {
        machineId: "machine-2", userId: bob, label: "calm-heron", platform: "linux", cliVersion: "0.1.0",
        firstSeenAt: 1, lastSyncAt: 200,
        lastRateLimit: { observedAt: 80, usedPercent: 55, windowMinutes: 10080, receivedAt: 200 },
      });
      await ctx.db.insert("machines", {
        machineId: "machine-3", userId: bob, label: "no-snapshot", platform: "win32", cliVersion: "0.1.0",
        firstSeenAt: 1, lastSyncAt: 300,
      });
    });
    expect(await withUser(t, "alice").query(api.stats.quota, {})).toEqual({
      usedPercent: 55, windowMinutes: 10080, resetsAt: null, planType: null, limitId: null,
      observedAt: 80, receivedAt: 200,
      machine: { machineId: "machine-2", label: "calm-heron" },
      user: { userId: bob, name: "Bob", imageUrl: null },
    });
  });
});

describe("stats.bounds", () => {
  it("returns the first and last rollup day for the team or one user", async () => {
    const t = setup();
    const { bob } = await seedTeam(t);
    expect(await withUser(t, "alice").query(api.stats.bounds, {})).toEqual({ firstDay: "2026-08-29", lastDay: "2026-08-31" });
    expect(await withUser(t, "alice").query(api.stats.bounds, { userId: bob })).toEqual({ firstDay: "2026-08-31", lastDay: "2026-08-31" });
  });

  it("returns nulls without data", async () => {
    const t = setup();
    await registerUser(t, "alice");
    expect(await withUser(t, "alice").query(api.stats.bounds, {})).toEqual({ firstDay: null, lastDay: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/stats.test.ts`
Expected: FAIL — `api.stats.activityHeatmap` (and the others) undefined.

- [ ] **Step 3: Extend the imports of `web/convex/stats.ts`**

Change the `../../shared/src/days` import to `import { bucketStart, eachBucket, weekdayOf } from "../../shared/src/days";` and add `ActivityHeatmapResult`, `BoundsResult`, `DayHourHeatmapResult`, `QuotaResult` to the `./lib/types` import.

- [ ] **Step 4: Append to `web/convex/stats.ts`**

```ts
export const activityHeatmap = authedQuery({
  args: { userId: v.id("users"), from: v.string(), to: v.string() },
  handler: async (ctx, args): Promise<ActivityHeatmapResult> => {
    const range = assertRange(args.from, args.to);
    const prices = await loadPriceMap(ctx);
    const docs = await loadRollups(ctx, range, args.userId);
    const days = docs
      .filter((doc) => doc.tokens.total > 0 || doc.sessions > 0)
      .map((doc) => ({
        day: doc.day,
        tokens: doc.tokens.total,
        sessions: doc.sessions,
        costUsd: sumCost(doc.byModel, prices).totalUsd,
      }))
      .sort((a, b) => cmpKey(a.day, b.day));
    return {
      range,
      days,
      activeDays: days.length,
      maxTokens: days.reduce((max, d) => Math.max(max, d.tokens), 0),
    };
  },
});

export const dayHourHeatmap = authedQuery({
  args: { from: v.string(), to: v.string(), userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<DayHourHeatmapResult> => {
    const range = assertRange(args.from, args.to);
    const docs = await loadRollups(ctx, range, args.userId);
    const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const doc of docs) {
      const row = grid[weekdayOf(doc.day)];
      if (!row) continue;
      for (let hour = 0; hour < 24; hour++) row[hour] = (row[hour] ?? 0) + (doc.byHour[hour] ?? 0);
    }
    let max = 0;
    let peakHour: number | null = null;
    let peakWeekday: number | null = null;
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let hour = 0; hour < 24; hour++) {
        const value = grid[weekday]?.[hour] ?? 0;
        if (value > max) {
          max = value;
          peakWeekday = weekday;
          peakHour = hour;
        }
      }
    }
    return { grid, max, peakHour, peakWeekday };
  },
});

export const quota = authedQuery({
  args: {},
  handler: async (ctx): Promise<QuotaResult> => {
    const machines = await ctx.db.query("machines").collect();
    let best: Doc<"machines"> | null = null;
    for (const machine of machines) {
      const candidate = machine.lastRateLimit;
      if (!candidate) continue;
      const current = best?.lastRateLimit;
      if (
        !current ||
        candidate.receivedAt > current.receivedAt ||
        (candidate.receivedAt === current.receivedAt && candidate.observedAt > current.observedAt)
      ) {
        best = machine;
      }
    }
    if (!best?.lastRateLimit) return null;
    const snapshot = best.lastRateLimit;
    return {
      usedPercent: snapshot.usedPercent,
      windowMinutes: snapshot.windowMinutes,
      resetsAt: snapshot.resetsAt ?? null,
      planType: snapshot.planType ?? null,
      limitId: snapshot.limitId ?? null,
      observedAt: snapshot.observedAt,
      receivedAt: snapshot.receivedAt,
      machine: { machineId: best.machineId, label: best.label },
      user: await userRef(ctx, best.userId),
    };
  },
});

export const bounds = authedQuery({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<BoundsResult> => {
    const userId = args.userId;
    const ordered = (direction: "asc" | "desc") =>
      userId !== undefined
        ? ctx.db
            .query("dailyRollups")
            .withIndex("by_user_day", (q) => q.eq("userId", userId))
            .order(direction)
            .first()
        : ctx.db.query("dailyRollups").withIndex("by_day").order(direction).first();
    const first = await ordered("asc");
    const last = await ordered("desc");
    return { firstDay: first?.day ?? null, lastDay: last?.day ?? null };
  },
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/stats.test.ts`
Expected: 15 tests PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w web`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/convex/stats.ts web/convex/stats.test.ts
git commit -m "Add activity and day-hour heatmaps, quota and bounds queries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 16: Session listing (`sessions.ts`)

**Files:**
- Create: `web/convex/sessions.ts`
- Test: `web/convex/sessions.test.ts`

**Interfaces:**
- Consumes: `paginationOptsValidator`, `PaginationResult` from `convex/server`; `ratio` from `shared/src/metrics.ts`; `loadPriceMap`, `priceTokens`, `PriceMap` (Task 4); `displayName` (Task 7); `SessionRow` (Task 1).
- Produces: `toSessionRow(ctx, doc, caches): Promise<SessionRow>`, `sessions.listRecent({ userId?, paginationOpts }): PaginationResult<SessionRow>` (newest `startedAt` first; team via `by_startedAt`, user via `by_user_startedAt`), `sessions.get({ sessionId }): SessionRow | null`. `costUsd` prices the whole session with its `model` (null when unpriced); `cacheHitRate = cachedInput / input` or null.

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/sessions.test.ts
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { withUser, makeSession, registerUser, setup, T0, type Harness } from "./test.helpers";

async function seed(t: Harness): Promise<{ alice: Id<"users">; bob: Id<"users"> }> {
  const alice = await registerUser(t, "alice");
  const bob = await registerUser(t, "bob");
  await t.run(async (ctx) => {
    await ctx.db.insert("modelPrices", {
      model: "gpt-5.6-sol", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10,
      source: "seed", updatedAt: 1,
    });
    await ctx.db.insert("machines", {
      machineId: "machine-1", userId: alice, label: "brisk-otter", platform: "darwin",
      cliVersion: "0.1.0", firstSeenAt: 1, lastSyncAt: 1,
    });
    await ctx.db.insert("sessions", {
      ...makeSession({ sessionId: "s1", gitBranch: "main" }), userId: alice, machineId: "machine-1", syncedAt: T0,
    });
    const s2 = makeSession({ sessionId: "s2", startedAt: T0 + 1000, model: "codex-auto-review" });
    delete s2.effort;
    await ctx.db.insert("sessions", { ...s2, userId: alice, machineId: "machine-1", syncedAt: T0 });
    await ctx.db.insert("sessions", {
      ...makeSession({ sessionId: "s3", startedAt: T0 + 2000 }), userId: bob, machineId: "machine-2", syncedAt: T0,
    });
  });
  return { alice, bob };
}

describe("sessions.listRecent", () => {
  it("pages newest-first across the team and joins names, labels and cost", async () => {
    const t = setup();
    const { alice, bob } = await seed(t);
    const first = await withUser(t, "alice").query(api.sessions.listRecent, {
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(first.page.map((s) => s.sessionId)).toEqual(["s3", "s2"]);
    expect(first.isDone).toBe(false);
    expect(first.page[0]).toMatchObject({
      userId: bob, userName: "Bob", machineId: "machine-2", machineLabel: "machine-2",
    });
    expect(first.page[1]).toMatchObject({ model: "codex-auto-review", effort: null, costUsd: null });

    const second = await withUser(t, "alice").query(api.sessions.listRecent, {
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    expect(second.page.map((s) => s.sessionId)).toEqual(["s1"]);
    expect(second.isDone).toBe(true);
    const s1 = second.page[0]!;
    expect(s1).toMatchObject({
      userId: alice, userName: "Alice", machineLabel: "brisk-otter", gitBranch: "main",
      model: "gpt-5.6-sol", effort: "medium", source: "cli", isSubagent: false, turns: 2,
      userMessages: 2, agentMessages: 2, cacheHitRate: 0.4, activeMs: 600_000,
      linesAdded: 10, linesRemoved: 2, inProgress: false, day: "2026-08-31",
    });
    expect(s1.costUsd).toBeCloseTo(0.00328, 8);
    expect(s1.toolCounts.commandRead).toBe(3);
  });

  it("scopes to one user", async () => {
    const t = setup();
    const { alice } = await seed(t);
    const mine = await withUser(t, "bob").query(api.sessions.listRecent, {
      userId: alice, paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(mine.page.map((s) => s.sessionId)).toEqual(["s2", "s1"]);
    expect(mine.isDone).toBe(true);
  });
});

describe("sessions.get", () => {
  it("returns one session row or null", async () => {
    const t = setup();
    await seed(t);
    const row = await withUser(t, "alice").query(api.sessions.get, { sessionId: "s2" });
    expect(row).toMatchObject({ sessionId: "s2", userName: "Alice", costUsd: null });
    expect(await withUser(t, "alice").query(api.sessions.get, { sessionId: "nope" })).toBeNull();
    await expect(t.query(api.sessions.get, { sessionId: "s2" })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/sessions.test.ts`
Expected: FAIL — `api.sessions` is undefined.

- [ ] **Step 3: Create `web/convex/sessions.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/sessions.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/sessions.ts web/convex/sessions.test.ts
git commit -m "Add paginated session listing with user, machine and cost joins

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 17: Machines and model prices (`machines.ts`, `prices.ts`)

**Files:**
- Create: `web/convex/machines.ts`
- Create: `web/convex/prices.ts`
- Test: `web/convex/machines.test.ts`
- Test: `web/convex/prices.test.ts`

**Interfaces:**
- Consumes: `authedQuery`, `authedMutation` (Task 7); `MachineRow`, `PriceRow` (Task 1); `seedRollup`, `registerUser`, `withUser` (Task 7) in tests; `stats.summary` (Task 13) in the price-edit test.
- Produces: `toMachineRow(doc): MachineRow`, `machines.list({ userId? }): MachineRow[]` (all users when omitted; `lastSyncAt` desc, then label), `machines.rename({ machineId, label }): null` (own machines only → `forbidden`; blank/over-64-char label → `bad_label`); `SEED_PRICES` (the spec's 14-row table), `prices.list(): PriceRow[]` (by model), `prices.upsert({ model, inputUsdPerMTok, cachedInputUsdPerMTok, outputUsdPerMTok }): Id<"modelPrices">` (`bad_model` / `bad_price`, source `"manual"`, `updatedBy` = caller), `prices.remove({ model }): null`, `prices.seed` (internalMutation → `{ inserted }`, inserts only missing models with source `"seed"`).

- [ ] **Step 1: Write the failing tests**

```ts
// web/convex/machines.test.ts
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { withUser, registerUser, setup } from "./test.helpers";

describe("machines", () => {
  it("lists machines newest-sync first with null-filled optionals and scopes by user", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    const bob = await registerUser(t, "bob");
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "machine-1", userId: alice, label: "brisk-otter", platform: "darwin", arch: "arm64",
        cliVersion: "0.1.0", firstSeenAt: 1, lastSyncAt: 100,
        lastRateLimit: { observedAt: 90, usedPercent: 10, windowMinutes: 10080, limitId: "primary", receivedAt: 100 },
      });
      await ctx.db.insert("machines", {
        machineId: "machine-2", userId: bob, label: "calm-heron", platform: "linux",
        cliVersion: "0.1.0", firstSeenAt: 1, lastSyncAt: 200,
      });
    });
    const all = await withUser(t, "alice").query(api.machines.list, {});
    expect(all.map((m) => m.machineId)).toEqual(["machine-2", "machine-1"]);
    expect(all[1]).toEqual({
      _id: expect.any(String), machineId: "machine-1", userId: alice, label: "brisk-otter", hostname: null,
      platform: "darwin", arch: "arm64", nodeVersion: null, cliVersion: "0.1.0", codexVersion: null,
      codexLatestVersion: null, tz: null, firstSeenAt: 1, lastSyncAt: 100,
      lastRateLimit: { usedPercent: 10, windowMinutes: 10080, resetsAt: null, planType: null, observedAt: 90, receivedAt: 100 },
    });
    expect(all[0]?.lastRateLimit).toBeNull();
    const mine = await withUser(t, "alice").query(api.machines.list, { userId: bob });
    expect(mine.map((m) => m.machineId)).toEqual(["machine-2"]);
  });

  it("renames own machines only and validates the label", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    await registerUser(t, "bob");
    await t.run(async (ctx) => {
      await ctx.db.insert("machines", {
        machineId: "machine-1", userId: alice, label: "brisk-otter", platform: "darwin",
        cliVersion: "0.1.0", firstSeenAt: 1, lastSyncAt: 1,
      });
    });
    expect(await withUser(t, "alice").mutation(api.machines.rename, { machineId: "machine-1", label: "  work laptop " })).toBeNull();
    expect((await withUser(t, "alice").query(api.machines.list, {}))[0]?.label).toBe("work laptop");
    await expect(withUser(t, "bob").mutation(api.machines.rename, { machineId: "machine-1", label: "x" })).rejects.toMatchObject({
      data: { code: "forbidden" },
    });
    await expect(withUser(t, "alice").mutation(api.machines.rename, { machineId: "machine-1", label: "   " })).rejects.toMatchObject({
      data: { code: "bad_label" },
    });
    await expect(withUser(t, "alice").mutation(api.machines.rename, { machineId: "nope", label: "x" })).rejects.toMatchObject({
      data: { code: "forbidden" },
    });
  });
});
```

```ts
// web/convex/prices.test.ts
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { EventInput } from "./lib/aggregate";
import { withUser, registerUser, seedRollup, setup } from "./test.helpers";

const event: EventInput = {
  hour: 9, model: "gpt-5.6-sol", effort: "medium", project: "alpha", isSubagent: false,
  input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200,
};

describe("prices.seed", () => {
  it("inserts the 14 seed rows once", async () => {
    const t = setup();
    expect(await t.mutation(internal.prices.seed, {})).toEqual({ inserted: 14 });
    expect(await t.mutation(internal.prices.seed, {})).toEqual({ inserted: 0 });
    await registerUser(t, "alice");
    const rows = await withUser(t, "alice").query(api.prices.list, {});
    expect(rows).toHaveLength(14);
    expect(rows.map((r) => r.model)).toEqual([...rows.map((r) => r.model)].sort());
    expect(rows.find((r) => r.model === "gpt-5.6-sol")).toMatchObject({
      inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10, source: "seed",
    });
    expect(rows.find((r) => r.model === "gpt-5.1-codex-mini")).toMatchObject({
      inputUsdPerMTok: 0.25, cachedInputUsdPerMTok: 0.03, outputUsdPerMTok: 2,
    });
    expect(rows.find((r) => r.model === "codex-auto-review")).toBeUndefined();
  });
});

describe("prices.upsert / remove", () => {
  it("creates, updates, validates and removes prices", async () => {
    const t = setup();
    await registerUser(t, "alice");
    const id = await withUser(t, "alice").mutation(api.prices.upsert, {
      model: " gpt-9 ", inputUsdPerMTok: 1, cachedInputUsdPerMTok: 0.1, outputUsdPerMTok: 5,
    });
    const again = await withUser(t, "alice").mutation(api.prices.upsert, {
      model: "gpt-9", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 8,
    });
    expect(again).toBe(id);
    const rows = await withUser(t, "alice").query(api.prices.list, {});
    expect(rows).toEqual([
      { _id: id, model: "gpt-9", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 8, source: "manual", updatedAt: expect.any(Number) },
    ]);
    await expect(withUser(t, "alice").mutation(api.prices.upsert, {
      model: "gpt-9", inputUsdPerMTok: -1, cachedInputUsdPerMTok: 0, outputUsdPerMTok: 0,
    })).rejects.toMatchObject({ data: { code: "bad_price" } });
    await expect(withUser(t, "alice").mutation(api.prices.upsert, {
      model: "  ", inputUsdPerMTok: 1, cachedInputUsdPerMTok: 0, outputUsdPerMTok: 0,
    })).rejects.toMatchObject({ data: { code: "bad_model" } });
    expect(await withUser(t, "alice").mutation(api.prices.remove, { model: "gpt-9" })).toBeNull();
    expect(await withUser(t, "alice").mutation(api.prices.remove, { model: "gpt-9" })).toBeNull();
    expect(await withUser(t, "alice").query(api.prices.list, {})).toEqual([]);
  });

  it("re-prices history in the next stats query", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    await seedRollup(t, alice, "2026-08-31", [event], []);
    const before = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-31", to: "2026-08-31", previous: false });
    expect(before.metrics.costUsd.current).toBe(0);
    expect(before.unpricedModels).toEqual(["gpt-5.6-sol"]);
    await withUser(t, "alice").mutation(api.prices.upsert, {
      model: "gpt-5.6-sol", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10,
    });
    const priced = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-31", to: "2026-08-31", previous: false });
    expect(priced.metrics.costUsd.current).toBeCloseTo(0.00328, 8);
    expect(priced.unpricedModels).toEqual([]);
    await withUser(t, "alice").mutation(api.prices.upsert, {
      model: "gpt-5.6-sol", inputUsdPerMTok: 4, cachedInputUsdPerMTok: 0.4, outputUsdPerMTok: 20,
    });
    const doubled = await withUser(t, "alice").query(api.stats.summary, { from: "2026-08-31", to: "2026-08-31", previous: false });
    expect(doubled.metrics.costUsd.current).toBeCloseTo(0.00656, 8);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/machines.test.ts convex/prices.test.ts`
Expected: FAIL — `api.machines` / `api.prices` undefined.

- [ ] **Step 3: Create `web/convex/machines.ts`**

```ts
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { authedMutation, authedQuery } from "./lib/auth";
import type { MachineRow } from "./lib/types";

export function toMachineRow(doc: Doc<"machines">): MachineRow {
  const rl = doc.lastRateLimit;
  return {
    _id: doc._id,
    machineId: doc.machineId,
    userId: doc.userId,
    label: doc.label,
    hostname: doc.hostname ?? null,
    platform: doc.platform,
    arch: doc.arch ?? null,
    nodeVersion: doc.nodeVersion ?? null,
    cliVersion: doc.cliVersion,
    codexVersion: doc.codexVersion ?? null,
    codexLatestVersion: doc.codexLatestVersion ?? null,
    tz: doc.tz ?? null,
    firstSeenAt: doc.firstSeenAt,
    lastSyncAt: doc.lastSyncAt,
    lastRateLimit: rl
      ? {
          usedPercent: rl.usedPercent,
          windowMinutes: rl.windowMinutes,
          resetsAt: rl.resetsAt ?? null,
          planType: rl.planType ?? null,
          observedAt: rl.observedAt,
          receivedAt: rl.receivedAt,
        }
      : null,
  };
}

export const list = authedQuery({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<MachineRow[]> => {
    const userId = args.userId;
    const docs =
      userId !== undefined
        ? await ctx.db
            .query("machines")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect()
        : await ctx.db.query("machines").collect();
    return docs
      .map(toMachineRow)
      .sort((a, b) => b.lastSyncAt - a.lastSyncAt || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  },
});

export const rename = authedMutation({
  args: { machineId: v.string(), label: v.string() },
  handler: async (ctx, { machineId, label }): Promise<null> => {
    const trimmed = label.trim();
    if (trimmed.length === 0 || trimmed.length > 64) throw new ConvexError({ code: "bad_label" });
    const machine = await ctx.db
      .query("machines")
      .withIndex("by_machineId", (q) => q.eq("machineId", machineId))
      .unique();
    if (!machine || machine.userId !== ctx.user._id) throw new ConvexError({ code: "forbidden" });
    await ctx.db.patch(machine._id, { label: trimmed });
    return null;
  },
});
```

- [ ] **Step 4: Create `web/convex/prices.ts`**

```ts
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/auth";
import type { PriceRow } from "./lib/types";

/** Spec "Seed price table" (USD per million tokens). `codex-auto-review` stays unpriced on purpose. */
export const SEED_PRICES = [
  { model: "gpt-5.6-sol", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10 },
  { model: "gpt-5.6-luna", inputUsdPerMTok: 0.2, cachedInputUsdPerMTok: 0.02, outputUsdPerMTok: 1.2 },
  { model: "gpt-5.6-terra", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 12 },
  { model: "gpt-5.5", inputUsdPerMTok: 5, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 30 },
  { model: "gpt-5.4", inputUsdPerMTok: 2.5, cachedInputUsdPerMTok: 0.25, outputUsdPerMTok: 15 },
  { model: "gpt-5.4-mini", inputUsdPerMTok: 0.75, cachedInputUsdPerMTok: 0.075, outputUsdPerMTok: 4.5 },
  { model: "gpt-5.3-codex", inputUsdPerMTok: 1.75, cachedInputUsdPerMTok: 0.175, outputUsdPerMTok: 14 },
  { model: "gpt-5.2-codex", inputUsdPerMTok: 1.75, cachedInputUsdPerMTok: 0.175, outputUsdPerMTok: 14 },
  { model: "gpt-5.1-codex", inputUsdPerMTok: 1.25, cachedInputUsdPerMTok: 0.13, outputUsdPerMTok: 10 },
  { model: "gpt-5.1-codex-mini", inputUsdPerMTok: 0.25, cachedInputUsdPerMTok: 0.03, outputUsdPerMTok: 2 },
  { model: "gpt-5", inputUsdPerMTok: 1.25, cachedInputUsdPerMTok: 0.125, outputUsdPerMTok: 10 },
  { model: "gpt-5-mini", inputUsdPerMTok: 0.25, cachedInputUsdPerMTok: 0.025, outputUsdPerMTok: 2 },
  { model: "o3", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 8 },
  { model: "o4-mini", inputUsdPerMTok: 1.1, cachedInputUsdPerMTok: 0.275, outputUsdPerMTok: 4.4 },
] as const;

function toRow(doc: Doc<"modelPrices">): PriceRow {
  return {
    _id: doc._id,
    model: doc.model,
    inputUsdPerMTok: doc.inputUsdPerMTok,
    cachedInputUsdPerMTok: doc.cachedInputUsdPerMTok,
    outputUsdPerMTok: doc.outputUsdPerMTok,
    source: doc.source,
    updatedAt: doc.updatedAt,
  };
}

export const list = authedQuery({
  args: {},
  handler: async (ctx): Promise<PriceRow[]> => {
    const docs = await ctx.db.query("modelPrices").withIndex("by_model").order("asc").collect();
    return docs.map(toRow);
  },
});

export const upsert = authedMutation({
  args: {
    model: v.string(),
    inputUsdPerMTok: v.number(),
    cachedInputUsdPerMTok: v.number(),
    outputUsdPerMTok: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"modelPrices">> => {
    const model = args.model.trim();
    if (model.length === 0 || model.length > 256) throw new ConvexError({ code: "bad_model" });
    for (const value of [args.inputUsdPerMTok, args.cachedInputUsdPerMTok, args.outputUsdPerMTok]) {
      if (!Number.isFinite(value) || value < 0) throw new ConvexError({ code: "bad_price" });
    }
    const fields = {
      inputUsdPerMTok: args.inputUsdPerMTok,
      cachedInputUsdPerMTok: args.cachedInputUsdPerMTok,
      outputUsdPerMTok: args.outputUsdPerMTok,
      source: "manual",
      updatedAt: Date.now(),
      updatedBy: ctx.user._id,
    };
    const existing = await ctx.db
      .query("modelPrices")
      .withIndex("by_model", (q) => q.eq("model", model))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("modelPrices", { model, ...fields });
  },
});

export const remove = authedMutation({
  args: { model: v.string() },
  handler: async (ctx, { model }): Promise<null> => {
    const existing = await ctx.db
      .query("modelPrices")
      .withIndex("by_model", (q) => q.eq("model", model.trim()))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/** `npx convex run prices:seed` once per deployment; safe to re-run. */
export const seed = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ inserted: number }> => {
    const now = Date.now();
    let inserted = 0;
    for (const price of SEED_PRICES) {
      const existing = await ctx.db
        .query("modelPrices")
        .withIndex("by_model", (q) => q.eq("model", price.model))
        .unique();
      if (existing) continue;
      await ctx.db.insert("modelPrices", { ...price, source: "seed", updatedAt: now });
      inserted += 1;
    }
    return { inserted };
  },
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/machines.test.ts convex/prices.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/convex/machines.ts web/convex/prices.ts web/convex/machines.test.ts web/convex/prices.test.ts
git commit -m "Add machine listing/rename and model price management with seed table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 18: Full rollup rebuild (`rollups.rebuildAll`)

**Files:**
- Modify: `web/convex/rollups.ts` (extend imports, append the mutation)
- Test: `web/convex/rollups.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `REBUILD_PAGE_SIZE` (Task 3); `recomputeDay` (Task 9); `ctx.scheduler.runAfter`.
- Produces: `rollups.rebuildAll({ cursor?: string; pageSize?: number })` internalMutation → `{ done: boolean; recomputed: number }`; pages through `dailyRollups.by_user_day`, recomputes each page, reschedules itself with `runAfter(0, …)` until done. Run after a `ROLLUP_VERSION` bump with `npx convex run rollups:rebuildAll '{}'`.

- [ ] **Step 1: Append the failing test to `web/convex/rollups.test.ts`**

Extend the imports with `import { afterEach, vi } from "vitest";` (merge into the existing vitest import), `import { addDays } from "../../shared/src/days";` and `import { internal } from "./_generated/api";`, then append:

```ts
afterEach(() => vi.useRealTimers());

describe("rebuildAll", () => {
  it("recomputes every rollup page by page through the scheduler", async () => {
    const t = setup();
    vi.useFakeTimers();
    const userId = await registerUser(t, "alice");
    const days = Array.from({ length: 5 }, (_, i) => addDays("2026-08-01", i));
    await t.run(async (ctx) => {
      for (const [i, day] of days.entries()) {
        await ctx.db.insert("tokenEvents", { ...makeEvent({ sessionId: "s", seq: i, day }), userId });
      }
    });
    await t.run(async (ctx) => recomputeDays(ctx, userId, days, T0));
    await t.run(async (ctx) => {
      for (const rollup of await ctx.db.query("dailyRollups").collect()) {
        await ctx.db.patch(rollup._id, { version: 0, responses: 999 });
      }
    });

    const first = await t.mutation(internal.rollups.rebuildAll, { pageSize: 2 });
    expect(first).toEqual({ done: false, recomputed: 2 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const rollups = await t.run(async (ctx) => ctx.db.query("dailyRollups").collect());
    expect(rollups).toHaveLength(5);
    expect(rollups.every((r) => r.version === 1 && r.responses === 1)).toBe(true);
    expect(await t.mutation(internal.rollups.rebuildAll, {})).toEqual({ done: true, recomputed: 5 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project convex convex/rollups.test.ts`
Expected: FAIL — `internal.rollups.rebuildAll` undefined.

- [ ] **Step 3: Extend `web/convex/rollups.ts`**

Replace the import block with:

```ts
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { computeDayRollup } from "./lib/aggregate";
import { REBUILD_PAGE_SIZE } from "./lib/constants";
```

and append:

```ts
/**
 * Recomputes every existing rollup, REBUILD_PAGE_SIZE per invocation, rescheduling itself until
 * the index is exhausted. Idempotent; run after bumping ROLLUP_VERSION:
 *   npx convex run rollups:rebuildAll '{}'
 */
export const rebuildAll = internalMutation({
  args: { cursor: v.optional(v.string()), pageSize: v.optional(v.number()) },
  handler: async (ctx, { cursor, pageSize }): Promise<{ done: boolean; recomputed: number }> => {
    const page = await ctx.db
      .query("dailyRollups")
      .withIndex("by_user_day")
      .paginate({ cursor: cursor ?? null, numItems: pageSize ?? REBUILD_PAGE_SIZE });
    const now = Date.now();
    for (const rollup of page.page) await recomputeDay(ctx, rollup.userId, rollup.day, now);
    if (page.isDone) return { done: true, recomputed: page.page.length };
    await ctx.scheduler.runAfter(0, internal.rollups.rebuildAll, {
      cursor: page.continueCursor,
      pageSize,
    });
    return { done: false, recomputed: page.page.length };
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx convex codegen && npx vitest run --project convex convex/rollups.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/convex/rollups.ts web/convex/rollups.test.ts
git commit -m "Add self-rescheduling full rollup rebuild

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

---

### Task 19: Dev deployment bring-up

**Files:**
- Modify: none committed. Produces `web/.env.local` (git-ignored by the root `.gitignore`) and a Convex dev deployment.

**Interfaces:**
- Consumes: the Convex CLI login already present on this machine (`~/.convex/config.json`; run `npx convex login` if `npx convex dev --once` says you are not logged in), the Clerk Frontend API URL (`https://<slug>.clerk.accounts.dev`) from the user's Clerk app. If the Clerk app does not exist yet, use the placeholder `https://placeholder.clerk.accounts.dev` now and replace it in Plan 3's deploy task — Convex only needs a syntactically valid domain to push.
- Produces: `CONVEX_DEPLOYMENT=dev:<name>` and `NEXT_PUBLIC_CONVEX_URL=https://<name>.convex.cloud` in `web/.env.local`; the HTTP base URL for the CLI is `https://<name>.convex.site`.

- [ ] **Step 1: Create the project and dev deployment**

Run (from `web/`):

```bash
cd web && npx convex dev --once   # the dev deployment already exists (created during Plan 1 Task 5): team yining044, project codex-kaboo, deployment qualified-nightingale-360; web/.env.local is already written
```

Answer the team prompt if asked. Expected: `.env.local` is written; the first push then FAILS with `Environment variable CLERK_FRONTEND_API_URL is used in auth config file but its value was not set` — that is expected and the deployment already exists.

- [ ] **Step 2: Set the auth env var and push**

```bash
cd web && npx convex env set CLERK_FRONTEND_API_URL https://<slug>.clerk.accounts.dev
cd web && npx convex dev --once
```

If the Clerk application does not exist yet (the user creates it), set a placeholder so pushes succeed and replace it later with the real value: `cd web && npx convex env set CLERK_FRONTEND_API_URL https://placeholder.clerk.accounts.dev`. Nothing in this plan depends on a real Clerk instance: the HTTP sync path authenticates with sync tokens, and convex-test never reads `auth.config.ts`. Browser sign-in only works once the real URL is set (Plan 3, deployment task).

Expected: `✔ Convex functions ready!` (or equivalent) with no errors; `npx convex env list` shows `CLERK_FRONTEND_API_URL`.

- [ ] **Step 3: Seed prices**

```bash
cd web && npx convex run prices:seed '{}'
```

Expected output: `{ "inserted": 14 }`; running it again prints `{ "inserted": 0 }`.

- [ ] **Step 4: Verify the HTTP router is live**

```bash
DEPLOYMENT_URL=$(grep NEXT_PUBLIC_CONVEX_URL web/.env.local | cut -d= -f2)
SITE_URL=${DEPLOYMENT_URL/.convex.cloud/.convex.site}
curl -s "$SITE_URL/api/v1/health"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SITE_URL/api/v1/sync"
```

Expected: `{"ok":true,"serverTime":17…}` then `401`.

- [ ] **Step 5: Confirm nothing sensitive is staged**

```bash
git status --short
```

Expected: no `web/.env.local` in the output (it is ignored). Nothing to commit for this task.

---

### Task 20: Bootstrap token, adoption on first sign-in, and the CLI end-to-end sync

**Files:**
- Modify: `web/convex/syncTokens.ts` (append `mint` + `insertForEmail`)
- Modify: `web/convex/users.ts` (`ensure` adopts a pending user)
- Modify: `web/convex/ingest.ts` (append `counts` internal query)
- Test: `web/convex/syncTokens.test.ts`, `web/convex/users.test.ts`, `web/convex/ingest.internal.test.ts` (append describe blocks)

**Interfaces:**
- Consumes: Task 8 hash helpers, Task 7 `ensure`, the Plan 1 CLI build (`cli/dist/codex-kaboo.js` with `login --server`, `sync`, `sync --full`), the dev deployment from Task 19.
- Produces: `syncTokens.mint` (internalAction `{ email, name? }` → `{ token, prefix, userId }`) for `npx convex run syncTokens:mint` before the web Settings page exists; `syncTokens.insertForEmail` (internalMutation `{ email, name?, tokenHash, prefix }` → `{ userId, tokenId }`) that attaches to the user with that email or creates a **pending user** (`clerkId = "pending:<email lowercased>"`); `users.ensure` now adopts a pending user whose email matches the Clerk identity's email (same `_id`, `clerkId` rewritten); `ingest.counts` (internalQuery `{}` → `{ sessions, tokenEvents, dailyRollups, capped: { sessions, tokenEvents, dailyRollups } }`) for operational checks. Plan 3's `useEnsureUser` gets the adoption for free; Plan 1's CLI needs nothing new.

- [ ] **Step 1: Append the failing tests**

Append to `web/convex/syncTokens.test.ts` (`withUser`, `registerUser` are already imported there; `api`/`internal` too):

```ts
describe("syncTokens.mint (bootstrap)", () => {
  it("creates a pending user that the first Clerk sign-in adopts", async () => {
    const t = setup();
    const minted = await t.action(internal.syncTokens.mint, { email: "Alice@Example.com", name: "Alice" });
    expect(minted.token).toMatch(/^ck_[A-Za-z0-9_-]{43}$/);
    expect(minted.prefix).toBe(minted.token.slice(0, 9));
    const pending = await t.run(async (ctx) => ctx.db.get(minted.userId));
    expect(pending).toMatchObject({ clerkId: "pending:alice@example.com", email: "alice@example.com", name: "Alice" });
    const who = await t.fetch("/api/v1/whoami", { headers: { authorization: `Bearer ${minted.token}` } });
    expect(who.status).toBe(200);
    expect(await who.json()).toMatchObject({ userId: minted.userId, token: { name: "cli-bootstrap" } });

    const adopted = await withUser(t, "alice").mutation(api.users.ensure, {});
    expect(adopted).toBe(minted.userId);
    expect(await t.run(async (ctx) => ctx.db.query("users").collect())).toHaveLength(1);
    expect(await t.run(async (ctx) => ctx.db.get(minted.userId))).toMatchObject({
      clerkId: "user_alice",
      tokenIdentifier: "https://clerk.example|user_alice",
    });
    expect((await withUser(t, "alice").query(api.syncTokens.list, {})).map((r) => r.name)).toEqual(["cli-bootstrap"]);
  });

  it("attaches to an already registered user with the same email", async () => {
    const t = setup();
    const aliceId = await registerUser(t, "alice");
    const minted = await t.action(internal.syncTokens.mint, { email: "alice@example.com" });
    expect(minted.userId).toBe(aliceId);
    expect(await t.run(async (ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });
});
```

Append to `web/convex/users.test.ts`:

```ts
describe("users.ensure adoption", () => {
  it("does not adopt a pending user with a different email", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkId: "pending:someone-else@example.com",
        tokenIdentifier: "pending:someone-else@example.com",
        email: "someone-else@example.com",
        name: "Someone",
        createdAt: 1,
        lastSeenAt: 1,
      });
    });
    await withUser(t, "alice").mutation(api.users.ensure, {});
    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(2);
  });
});
```

Append to `web/convex/ingest.internal.test.ts`:

```ts
describe("counts", () => {
  it("reports table sizes", async () => {
    const t = setup();
    const alice = await registerUser(t, "alice");
    await t.mutation(internal.ingest.upsertSessions, {
      userId: alice, machineId: "machine-1", sessions: [makeSession({ sessionId: "s1" })], now: T0,
    });
    await t.mutation(internal.ingest.upsertEvents, {
      userId: alice, events: [makeEvent({ sessionId: "s1", seq: 1 }), makeEvent({ sessionId: "s1", seq: 2 })], now: T0,
    });
    expect(await t.query(internal.ingest.counts, {})).toEqual({
      sessions: 1,
      tokenEvents: 2,
      dailyRollups: 1,
      capped: { sessions: false, tokenEvents: false, dailyRollups: false },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project convex convex/syncTokens.test.ts convex/users.test.ts convex/ingest.internal.test.ts`
Expected: FAIL — `internal.syncTokens.mint`, `internal.ingest.counts` undefined; the adoption test fails because two users exist... (the "different email" test passes trivially before the change; the syncTokens adoption test is the one that drives the `ensure` change).

- [ ] **Step 3: Append to `web/convex/syncTokens.ts`**

Add `internalAction` to the `./_generated/server` import, then append:

```ts
/** Pre-registers a teammate by email (pending user) and mints a token for the CLI:
 *   npx convex run syncTokens:mint '{"email":"person@example.com","name":"Person"}'
 * The raw token is printed once by the CLI command output and never stored. */
export const mint = internalAction({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { email, name }): Promise<{ token: string; prefix: string; userId: Id<"users"> }> => {
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
```

- [ ] **Step 4: Teach `users.ensure` to adopt a pending user**

In `web/convex/users.ts`, replace the `if (existing) { … } return await ctx.db.insert(…)` tail of `ensure` with:

```ts
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    const email = identity.email?.trim().toLowerCase();
    const pending = email
      ? await ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", `pending:${email}`))
          .unique()
      : null;
    if (pending) {
      await ctx.db.patch(pending._id, { clerkId: identity.subject, ...fields });
      return pending._id;
    }
    return await ctx.db.insert("users", { clerkId: identity.subject, createdAt: now, ...fields });
```

- [ ] **Step 5: Append `counts` to `web/convex/ingest.ts`**

Add `internalQuery` to the `./_generated/server` import, then append:

```ts
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
```

- [ ] **Step 6: Run the whole convex suite and typecheck**

Run: `cd web && npx convex codegen && cd .. && npm run test -w web -- --project convex && npm run typecheck -w web`
Expected: every file PASS, tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/convex/syncTokens.ts web/convex/users.ts web/convex/ingest.ts web/convex/syncTokens.test.ts web/convex/users.test.ts web/convex/ingest.internal.test.ts
git commit -m "Add bootstrap token minting with pending-user adoption and counts query

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt"
```

- [ ] **Step 8: Push the functions and mint a token on the dev deployment**

```bash
cd web && npx convex dev --once
cd web && npx convex run syncTokens:mint '{"email":"yining044@gmail.com","name":"Azealoo"}'
```

Expected: `{ "token": "ck_…", "prefix": "ck_…", "userId": "…" }`. The token is shown only here; do not paste it into any file or commit.

- [ ] **Step 9: Point the CLI at the dev deployment and sync**

```bash
npm run build -w cli
SITE_URL=$(grep NEXT_PUBLIC_CONVEX_URL web/.env.local | cut -d= -f2 | sed 's/\.convex\.cloud/.convex.site/')
node cli/dist/codex-kaboo.js login --server "$SITE_URL" --token '<token from step 8>'
node cli/dist/codex-kaboo.js sync --dry-run --json > /tmp/codex-kaboo-dry.json
node cli/dist/codex-kaboo.js sync
```

Expected: `login` prints the user (`Azealoo`, `yining044@gmail.com`) and the token prefix. The number of sessions and token events `sync` reports as **inserted** must equal the session and event counts the `--dry-run --json` run printed a moment earlier — read those two numbers out of `/tmp/codex-kaboo-dry.json`, never from this plan: they are whatever `~/.codex` holds when the task runs. (At the time of writing that is 11 sessions and 426 token events; the real logs contain 430 `token_count` lines of which 4 are all-zero and skipped by the parser.) Conflicts must be 0 and the machine registered with the CLI's label.

- [ ] **Step 10: Verify idempotence**

```bash
node cli/dist/codex-kaboo.js sync
node cli/dist/codex-kaboo.js sync --full
cd web && npx convex run ingest:counts '{}'
```

Expected: the second `sync` makes no request ("nothing changed") — or at most the hourly machine heartbeat; `sync --full` re-uploads everything and the server answers `accepted.sessions.unchanged` and `accepted.events.unchanged` equal to the same two dry-run counts from Step 9, zero inserted/updated; `counts` prints those two numbers as `sessions` and `tokenEvents`, plus `dailyRollups: <number of distinct days>` and `capped: { sessions: false, tokenEvents: false, dailyRollups: false }`. (At the time of writing the two counts are 11 and 426.)

- [ ] **Step 11: Spot-check a rollup against the CLI's dry run**

```bash
node cli/dist/codex-kaboo.js sync --dry-run --json > /tmp/codex-kaboo-dry.json
cd web && npx convex data dailyRollups --limit 50
```

Expected: for one day, `tokens.input` / `tokens.output` in the rollup equal the sum of that day's events in the dry-run JSON. Compute both sides from the file — no expected total is written here, because it depends on the local `~/.codex` (at the time of writing the session ending in `…1180` contributed input 1,437,354 / output 6,554 to its day). Report any mismatch as a Plan 1 parser bug or a Plan 2 attribution bug before moving on.

---

## Self-review checklist (run after the last task)

- Spec phase 4 coverage: schema + lib (Tasks 1–6), `/api/v1/sync` status paths and idempotency (Tasks 10–12), `computeDayRollup` fixture/idempotence/order/midnight/empty-day (Tasks 5, 9), `rebuildAll` (Task 18), `stats` incl. previous range, `change` null on zero, team vs user scope, `previousRank`, week/month buckets, heatmaps (Tasks 13–15), cost math and price edits (Tasks 4, 17), tokens create/list/revoke → 401 (Tasks 8, 11), `users.ensure` idempotent (Task 7), sessions pagination (Task 16), machines (Task 17), dev bring-up + CLI end-to-end (Tasks 19–20).
- Contracts §9: every function in the table exists with the listed args and returns a `lib/types.ts` type (`users.ensure/me/list`, `stats.*` ×8, `sessions.listRecent/get`, `syncTokens.list/create/revoke`, `machines.list/rename`, `prices.list/upsert/remove/seed`, `rollups.rebuildAll`).
- Additions beyond the contracts (report to Plans 1 and 3): `syncTokens.mint` / `insertForEmail`, pending-user adoption in `users.ensure`, `ingest.counts`, machine `label` written on first registration only, `bad_label` / `bad_name` / `bad_model` / `bad_price` / `bad_email` / `forbidden` error codes.
