# codex-kaboo design spec

_Approved design, 2026-09-01. Source of truth for the implementation plan in `docs/superpowers/plans/`._


## Context

Three people share one OpenAI Codex account. There is no per-person usage view anywhere: Codex
with a ChatGPT login exposes no per-session API, and the only detailed record of usage is the
local rollout log each Codex install writes under `~/.codex/sessions/`. The goal is a private
team dashboard, modelled on ByteDance's internal "Kaboo" (kaboo.bytedance.net), that shows token
volume, cache hit rate, model/tool/project breakdowns, per-user pages, efficiency metrics, and
the shared weekly quota, so the three of you can see who is using what and how efficiently.

Kaboo is the reference, not a spec: the user asked me to keep the features that make sense for a
three-person team and drop the rest. Decisions the user made explicitly:

| Decision | Choice |
|---|---|
| Machines | Mixed: macOS, Linux and Windows. The collector must be cross-platform Node. |
| Access | Anyone who can sign in with Clerk sees everything. No allowlist, no roles. (Recommend flipping Clerk "Restrict sign-ups" once the three accounts exist.) |
| Scope | Full proposed v1 set: overview + shared quota gauge, leaderboard, trends, model/tool/project/skill breakdowns, per-user pages with heatmaps, efficiency cards, estimated cost at API list prices. |
| Repo | New public GitHub repo `Azealoo/codex-kaboo` (gh is authed as Azealoo; Vercel CLI authed as yining044-2988; Convex CLI 1.45 installed). |
| Stack (user-specified) | Clerk auth, Convex storage, Vercel deploy, code on GitHub. Plus Next.js App Router, TypeScript, Tailwind v4, shadcn/ui, Recharts. |

Dropped from Kaboo (not useful for 3 people or not derivable from Codex logs): teams/departments,
gamification badges/journeys, AI weekly, forecast, site traffic, skins, evaluations, autonomy
scoring, "generated lines" as a quality signal (we keep it as a plain count).

## How Kaboo does it (verified in the browser)

- Data reaches Kaboo through a CLI users install themselves: `kaboo-cli login`, `kaboo-cli install`
  (background report every 30 min), `kaboo-cli report --full` (backfill). The backend upserts on a
  unique key so re-reporting is safe. We mirror this exactly.
- Home: range pill (1D/7D/30D/90D/ALL + custom calendar) in the nav; Volume|Efficiency toggle; four
  stat cards with green/red % change pills; tabs Users|Teams|Models|Tools|Skills; podium + ranked
  table with metric toggles (Tokens/Cost/Sessions/Messages/Generated lines/Tokens per line) and
  Linear|Log; below it a daily trend area chart with a "Peak" pill.
- My Page: rank card, 13 small stat cards, GitHub-style 12-month heatmap, token trend
  (Tokens/Cost/Hours, Line/Bars/Both, Daily/Weekly/Monthly), Data Sync card with the CLI commands,
  Breakdown tab (model/tool/project/machine tables + day×hour activity heatmap + time analysis),
  Cost & Efficiency tab (cost structure stacked bar: input/output/cache/reasoning, cache savings,
  cost per line, waste radar).
- Visual language: light off-white page, white cards with 1px border and ~12px radius, green
  accent for bars/lines, monospace numerals in tables, Inter-style UI font.

## What the Codex logs contain (verified on this Mac, Codex CLI 0.150.1)

Rollouts live at `<CODEX_HOME or ~/.codex>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, one
file per thread (sub-agent threads such as the auto-review "guardian" are separate files whose
`session_meta.source` is an object containing `subagent`). Each line is
`{timestamp, ordinal?, type, payload}` (`ordinal` is missing in legacy sub-agent files). Events we use:

| Event | Fields used |
|---|---|
| `session_meta` | `id`, `timestamp`, `cwd` (→ project = basename only), `originator` (codex-tui / codex_exec / …), `source` (cli / exec / {subagent}), `cli_version`, `base_instructions.provenance.model`, `git.branch` |
| `turn_context` | `turn_id`, `timezone` (IANA), `model`, `effort` (low/medium/high/xhigh), `collaboration_mode.mode` |
| `event_msg/task_started`, `task_complete` | per-turn `started_at`, `completed_at`, `duration_ms`, `time_to_first_token_ms` |
| `event_msg/token_count` | `info.last_token_usage {input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens}` (one per model response; summing them reproduces the session total, verified on 11 sessions), `info.model_context_window`, `rate_limits {primary.used_percent, primary.window_minutes, primary.resets_at, plan_type}` |
| `event_msg/item_completed` | `item.type` ∈ UserMessage, AgentMessage, Reasoning, CommandExecution (`parsed_cmd[].type`), FileChange (`changes[path].unified_diff` → count +/- lines only), Extension (`kind`, e.g. web.search), ImageView, ContextCompaction |
| `compacted` | context compaction count |
| `response_item/function_call` | non-built-in names → MCP/other tool usage (name only) |

Facts that shape the design:
- `cached_input_tokens` is a subset of `input_tokens`; `reasoning_output_tokens` is a subset of
  `output_tokens`; `total_tokens = input + output`.
- Skill use is visible only as a command that reads `…/skills/<name>/SKILL.md`; we extract the name.
- Files are appended while a session is live, so the last line may be partial.
- Models seen: gpt-5.6-sol, gpt-5.6-luna, codex-auto-review (subagent). Efforts: low/medium/xhigh.

## Metric definitions (single source of truth for CLI, backend and UI)

- input, cachedInput, cacheWrite, output, reasoning, total: sums of the `last_token_usage` fields.
- Cache hit rate = cachedInput / input.
- Estimated cost (USD) = (input − cachedInput)/1e6 × inputPrice + cachedInput/1e6 × cachedPrice
  + output/1e6 × outputPrice (reasoning tokens are inside output and billed at the output price).
  Cost structure shares split output into non-reasoning and reasoning parts. Cache savings =
  cachedInput/1e6 × (inputPrice − cachedPrice). Unknown model ⇒ cost 0 and flagged "unpriced".
- Sessions, turns, messages exclude sub-agent threads; token totals and cost include them (they
  consume the shared quota). Breakdown "by source" shows cli / exec / subagent shares.
- Turns = `task_started` count. userMessages / agentMessages = `item_completed` counts (legacy
  `event_msg` message events only as a fallback). Messages = both.
- Active time = Σ turn durations; wall time = Σ (session end − start); active rate = active/wall.
- Time to first token = mean of `time_to_first_token_ms` over turns, plus an approximate median
  interpolated from a fixed 16-bucket histogram (documented as approximate in the UI).
- Generated lines = Σ '+' lines inside `@@` hunks of FileChange `update` diffs plus the line count
  of `add` contents; removed lines likewise (`-` lines + `delete` contents); net = added − removed.
- Tool kinds (fixed keys): commandRead, commandList, commandSearch, commandOther, fileChange,
  webSearch, imageView, mcpTool, other; MCP tools are also counted by `server/tool` name. Skills:
  counted per invocation and per distinct session.
- Days and hours are computed by the CLI in the session's IANA timezone (fallback: machine local),
  stored as `YYYY-MM-DD` strings and 0–23 integers; the server never converts time zones.
- Range presets: 1D = today, 7D/30D/90D = last N days ending today, ALL = since first data; custom
  from/to. Previous period = the N days immediately before `from`. Deltas are % change of the
  metric; rank movement compares leaderboard rank in the two periods.
- Shared quota gauge = the newest rate-limit snapshot across all machines (used %, resets at,
  plan type, observed-at staleness).

## Seed price table (USD per million tokens, from Kaboo's OpenRouter-sourced price page, 2026-09-01)

| model | input | cached input | output |
|---|---|---|---|
| gpt-5.6-sol | 2.00 | 0.20 | 10.00 |
| gpt-5.6-luna | 0.20 | 0.02 | 1.20 |
| gpt-5.6-terra | 2.00 | 0.20 | 12.00 |
| gpt-5.5 | 5.00 | 0.50 | 30.00 |
| gpt-5.4 | 2.50 | 0.25 | 15.00 |
| gpt-5.4-mini | 0.75 | 0.075 | 4.50 |
| gpt-5.3-codex | 1.75 | 0.175 | 14.00 |
| gpt-5.2-codex | 1.75 | 0.175 | 14.00 |
| gpt-5.1-codex | 1.25 | 0.13 | 10.00 |
| gpt-5.1-codex-mini | 0.25 | 0.03 | 2.00 |
| gpt-5 | 1.25 | 0.125 | 10.00 |
| gpt-5-mini | 0.25 | 0.025 | 2.00 |
| o3 | 2.00 | 0.50 | 8.00 |
| o4-mini | 1.10 | 0.275 | 4.40 |

`codex-auto-review` is unpriced. Prices are editable in the dashboard; cost is computed at query
time from stored token counts, so edits re-price history instantly.

## Additional log facts (deeper structural pass over the 11 real files + the Codex source)

- Files are up to ~9.5 MB and a single JSON line can exceed 1 MB. Parse line by line with
  byte-accurate offsets; a trailing partial line (no `\n`) is neither parsed nor counted; a
  `\n`-terminated line that fails to parse is counted as a parse error and skipped.
- Rollout files are append-only (Codex opens them with `append`), never rewritten in place.
  Forks/reverts create a new file `rollout-<ts>-<threadId>_<rolloutId>.jsonl` with its own
  `session_meta`, so there are no cross-file duplicates; the filename regex must accept the
  optional `_<rolloutId>` suffix. Files older than 7 days may be zstd-compressed to `.jsonl.zst`
  by Codex's maintenance worker; archived threads move to `archived_sessions/`.
- `ordinal` is absent in the 3 sub-agent files (`history_mode: "legacy"`); where present it equals
  the 0-based line index. Dedup key for every event = `(sessionId, seq)` with `seq` = line index.
- `session_meta.id` equals the filename UUID in all files (for sub-agent files `session_id` is the
  root thread): use `id`, fall back to the filename. `task_started` precedes `turn_context`, so a
  response's model/effort are joined by `turn_id`, not "latest turn_context".
- Per event `total_tokens == input + output`; the file's final `total_token_usage.total_tokens`
  exceeds the per-event sum by ~0.4 % only in the two files with compactions. Sum the per-field
  values and derive total = input + output.
- `task_started.started_at`, `task_complete.completed_at`, `rate_limits.primary.resets_at` are Unix
  **seconds**; `duration_ms`, `time_to_first_token_ms` are ms. Primary window = 10080 minutes
  (weekly); `secondary` is null; `plan_type` is a string; `info` and `rate_limits` may be null.
- Main sessions count messages via `item_completed` UserMessage/AgentMessage (no `event_msg`
  user/agent_message events); legacy sub-agent files do the reverse. Count both, prefer items.
- `parsed_cmd[].type` ∈ {read, unknown, search, list_files} (the whole enum). `FileChange.changes
  [path]`: `update` has a `unified_diff` starting at `@@` (no `---/+++` headers) plus `move_path`;
  `add`/`delete` carry full `content` and no diff.
- MCP calls: newer Codex emits item type `McpToolCall {server, tool}`; 0.150.1 shows them as
  `response_item/function_call` named `mcp__<server>__<tool>` (or `<server>__<tool>`). Newer wire
  types to tolerate: `token_usage_record` (per-response usage; when present use it instead of
  `token_count` to avoid double counting), `world_state`, `inter_agent_communication*`,
  `security_risk_score`, `realtime_item`; item types `WebSearch`, `DynamicToolCall`,
  `CollabAgentToolCall`, `SubAgentActivity`, `ImageGeneration`, `Plan`, `HookPrompt`,
  `FunctionCallOutput`, `Entered/ExitedReviewMode`.
- Skills: system skills live at `~/.codex/skills/.system/<name>/SKILL.md`; a skill is the parent
  directory of any `SKILL.md` path in a command (`/(?:^|[\\/])([^\\/\s"']+)[\\/]SKILL\.md\b/i`).
- `version.json` holds the *latest available* Codex version, not the installed one; installed =
  newest `session_meta.cli_version`.
- Privacy traps (never copied): `collaboration_mode.settings.developer_instructions`,
  `task_complete.last_agent_message`, `compacted.message/replacement_history`,
  `Extension.query/results`, `ImageView.path`, `CommandExecution.command/stdout/stderr/*_output/
  cwd`, `parsed_cmd.cmd/path/query/name`, `FileChange` keys and `content`,
  `custom_tool_call.input`, `function_call.arguments`, `session_meta.cwd/git.repository_url/
  commit_hash/base_instructions.text`, `world_state.*`. The parser copies named fields into typed
  records (allow-list); it never forwards whole objects.

## Architecture

```
Codex CLI on each machine ──writes──▶ <CODEX_HOME>/{sessions,archived_sessions}/**/rollout-*.jsonl[.zst]
                                              │
   codex-kaboo sync (Node CLI, every 15 min via launchd / cron / schtasks)
   streams each changed file → session summary + new token events (metadata only, no text)
                                              │  POST /api/v1/sync  (Bearer sync token, JSON)
                                              ▼
                        Convex HTTP action → internal mutations: idempotent upsert of sessions
                        (by sessionId) and tokenEvents (by sessionId+seq), then deterministic
                        recompute of the touched dailyRollups
                                              │                    ▲ Clerk JWT
                        Convex queries (reactive, read rollups only) ◀── Next.js 16 dashboard on Vercel
```

Three deployable units: `cli/` (collector), `web/convex/` (backend, deployed by Convex),
`web/` (dashboard, deployed by Vercel). `shared/` holds the sync payload schema (zod) and metric
helpers so the CLI, backend and UI cannot drift.

Storage decision: raw `tokenEvents` (one per model response, ~250 B) + `sessions` summaries +
per-(user, day) `dailyRollups`. A rollup is a pure function of one day's events and sessions and is
recomputed from scratch inside the same mutation that upserts the data: deterministic, idempotent,
no delta math, `rebuildAll` for version bumps, and raw events allow new breakdowns later. Queries
read rollups only: 3 users × 365 days ≈ 1,100 docs/year against Convex's 32,000-doc / 16 MiB
per-query limits; raw events (~330k/yr, ~100 MB/yr with indexes) are never scanned by dashboard
queries. If one mutation ever nears the limits (a day with > 20k events), switch to the
"mark dirty → scheduled drain" pattern; not needed at this scale.

## Repo layout and tooling (npm workspaces)

```
codex-kaboo/
  package.json              workspaces ["shared","cli","web"]; root scripts: typecheck, lint, test, build
  tsconfig.base.json        strict TS 5.9; ESLint 9 flat config; Prettier
  .github/workflows/ci.yml  npm ci → typecheck → lint → test (vitest 4, all workspaces) → build cli →
                            smoke `node dist/codex-kaboo.js --version` on ubuntu/macos/windows × node 20/22/24
  shared/                   @codex-kaboo/shared (pure TS + zod 4): src/sync.ts (SyncBatch / SessionSummary /
                            TokenEvent schema + inferred types), src/constants.ts (limits, TTFT buckets, ROLLUP_VERSION),
                            src/metrics.ts (cost, cacheHit, tokensPerLine, TTFT histogram median), src/days.ts (UTC
                            day-string math, previous period), tests
  cli/                      codex-kaboo-cli, bin "codex-kaboo"; tsup → dist/codex-kaboo.js (one CJS file, no runtime
                            deps, Node ≥ 18, ≥ 22 recommended for .zst support)
    src/main.ts (hashbang + commander), types.ts, commands/{login,logout,sync,status,install,uninstall,doctor}.ts,
        core/{paths,config,state,discover,jsonl-reader}.ts, parser/{session,classify,diff,time}.ts,
        upload/{batch,client}.ts, schedule/{index,launchd,cron,systemd,schtasks}.ts, util/{log,lock,names,spawn,hash}.ts
    test/ mirrors src; test/fixtures/codex-home/… redacted rollouts produced by scripts/make-fixture.mjs
  web/                      Next.js 16 App Router, TS, Tailwind v4, shadcn/ui (radix), Recharts 3, nuqs, Clerk, Convex
    convex/                 schema.ts, http.ts, ingest.ts, rollups.ts, stats.ts, sessions.ts, users.ts, syncTokens.ts,
                            machines.ts, prices.ts, auth.config.ts, lib/{validators,constants,days,hash,auth,aggregate,cost}.ts,
                            *.test.ts (convex-test, edge-runtime env)
    src/app, src/components, src/hooks, src/lib   (see Web app)
    scripts/pack-cli.mjs    web "prebuild": build + `npm pack` the CLI into public/cli/ (git-ignored)
    vercel.json             buildCommand "npx convex deploy --cmd 'npm run build'"
  docs/superpowers/specs/2026-09-01-codex-kaboo-design.md
  README.md                 setup + per-OS install instructions
```

Pinned versions (npm latest on 2026-09-01, verified): next 16.3.4, react 19.2.8, @clerk/nextjs 7.8.4,
convex 1.45.0, convex-helpers, convex-test, recharts 3.10.1, nuqs 2.10.1, shadcn 4.19.1, tailwindcss
4.3.3, lucide-react 1.39, react-day-picker 10.0.1, date-fns 4.4, zod 4, commander 14, tsup 8,
vitest 4.1.11 (vitest 5 needs Node ≥ 22.12), @testing-library/react 16.3.3, typescript 5.9.3 (TS 7 is
`latest` but not adopted by the toolchain). Local Node is 24.17, npm 11.13.

## Convex data model (`web/convex/schema.ts`)

Keyed sub-aggregates are arrays of `{ key, … }` entries, never object keys: Convex field names must
be ASCII letters/digits/underscores starting with a letter (verified), which model names
(`gpt-5.6-sol`), project basenames and skill names violate. Token fields everywhere are
`{ input, cachedInput, cacheWrite, output, reasoning, total }` (`cachedInput ⊂ input`,
`reasoning ⊂ output`, `total = input + output`). Enum-like strings (source, originator, effort,
tool kinds) are `v.string()`, not literal unions, so a Codex update cannot turn into 400s.
Shared validators live in `convex/lib/validators.ts`.

| Table | Fields | Indexes |
|---|---|---|
| `users` | clerkId (identity.subject), tokenIdentifier, email?, name?, imageUrl?, createdAt, lastSeenAt | by_clerkId |
| `syncTokens` | userId, tokenHash (sha256 hex; raw never stored), prefix (`ck_3f9a1c`), name, createdAt, lastUsedAt?, revokedAt? | by_hash, by_user |
| `machines` | machineId (CLI uuid), userId, label (default adjective-animal, renameable), hostname? (opt-in), platform, arch?, nodeVersion?, cliVersion, codexVersion?, codexLatestVersion?, tz?, firstSeenAt, lastSyncAt (server clock), lastRateLimit? {usedPercent, windowMinutes, resetsAt, planType?, limitId?, observedAt, receivedAt} | by_machineId, by_user |
| `sessions` | userId, machineId, sessionId (`threadId` or `threadId_rolloutId`), threadId, parentThreadId?, startedAt, endedAt, wallMs, day (start day, session tz), timezone?, project, gitBranch?, originator, source, isSubagent, model, cliVersion?, turns, completedTurns, userMessages, agentMessages, reasoningItems, toolCounts {commandRead, commandList, commandSearch, commandOther, fileChange, webSearch, imageView, mcpTool, other}, mcpTools [{key: "server/tool", count}], skills [{key, count}], linesAdded, linesRemoved, filesChanged, compactions, activeMs, ttft {count, sumMs, hist[16]}, tokens, responses, inProgress, lineCount, generation, parseErrors, parserVersion, summaryHash, syncedAt | by_sessionId, by_user_day, by_user_startedAt, by_startedAt |
| `tokenEvents` | userId, sessionId, seq, ts, day, hour, model, effort?, turnId?, project, isSubagent (denormalised by the CLI), input, cachedInput, cacheWrite, output, reasoning, total, contextWindow? | by_session_seq, by_user_day |
| `dailyRollups` | userId, day, version, computedAt, tokens, responses, subagentTokens, sessions, subagentSessions, turns, userMessages, agentMessages, linesAdded, linesRemoved, filesChanged, compactions, activeMs, wallMs, ttft, byHour number[24] (total tokens), byModel [{model, effort?, tokens…, responses}], byTool [{key, count}], byMcpTool [{key, count}], bySkill [{key, count, sessions}], byProject [{key, tokens, responses, sessions, userMessages, linesAdded, linesRemoved}], byMachine [{key, tokens, sessions}], bySource [{key, tokens, sessions}] | by_user_day, by_day |
| `modelPrices` | model (exact match), inputUsdPerMTok, cachedInputUsdPerMTok, outputUsdPerMTok, source ("seed" \| "manual"), updatedAt, updatedBy? | by_model |

Attribution rules: token metrics go to the event's local `day`/`hour`; session-level metrics
(sessions, turns, messages, tools, skills, lines, compactions, active/wall time, TTFT) go to the
session's start `day`. Sub-agent sessions are included in `tokens` (they consume the shared quota)
and tracked separately in `subagentTokens/subagentSessions`; leaderboard sessions/messages exclude
them. Rollup sub-arrays are sorted by key and capped at 100 entries with an `(other)` fold, so
recomputes are byte-identical and documents stay a few KB.

### Functions

| File | Function | Kind | Purpose |
|---|---|---|---|
| `http.ts` | `POST /api/v1/sync`, `GET /api/v1/whoami`, `GET /api/v1/health` | httpRouter | Base URL is the deployment's `.convex.site` domain |
| `ingest.ts` | `syncHandler` | httpAction | Bearer → sha256 (`crypto.subtle`, available in actions) → `internal.syncTokens.lookupByHash` (401 `unauthorized` / `token_revoked`); body ≤ 8 MiB (413); JSON (400); zod `SyncBatch.safeParse` with unknown keys stripped (400 + issues); caps 500 sessions / 5,000 events per request (413 + `limits`); then `upsertMachine` (409 if owned by another user) → `upsertSessions` in chunks of 200 → `upsertEvents` in chunks of ≤ 1,000 grouped so one chunk touches ≤ 30 days → `finishSync`. 200 `{ ok, accepted: { sessions: {inserted, updated, unchanged}, events: {…} }, conflicts: { sessions: [ids], events: n }, serverTime, latestCliVersion, limits }`; unexpected errors → 503 + `Retry-After: 5` |
| `ingest.ts` | `upsertMachine`, `upsertSessions`, `upsertEvents`, `finishSync` | internalMutation | Sessions: `by_sessionId` → insert / conflict (other user; first uploader owns) / unchanged (`summaryHash` equal) / replace (touches old and new `day`). Events: `by_session_seq` → insert / conflict / unchanged (field-equal) / replace. Each mutation ends with `recomputeDays(ctx, userId, touchedDays)` (mutations see their own writes). `finishSync`: `lastSyncAt`, `lastRateLimit` when `receivedAt` is newer (server clock, never the client's), token `lastUsedAt` at most once per 60 s |
| `ingest.ts` | `whoamiHandler` | httpAction | Token → `{ userId, name, email, token: {name, prefix}, serverTime }` for `codex-kaboo login` |
| `rollups.ts` + `lib/aggregate.ts` | `computeDayRollup(userId, day, events, sessions)` (pure), `mergeRollups`, `recomputeDays`, `rebuildAll({cursor?})` | helpers / internalMutation | Recompute = read `tokenEvents.by_user_day` + `sessions.by_user_day` for the day, `replace`/`insert` the rollup, delete it when both are empty. `rebuildAll` pages through `by_user_day` and reschedules itself; run after a `ROLLUP_VERSION` bump (`npx convex run rollups:rebuildAll '{}'`) |
| `lib/auth.ts` | `authedQuery`, `authedMutation` | convex-helpers `customQuery/customMutation` | Inject `{ identity, user }` or throw `ConvexError({code:"unauthenticated"})`. Every public function uses them; internal functions are unreachable from clients |
| `users.ts` | `ensure` (mutation), `me`, `list` (query), `getForToken` (internal) | | `ensure` upserts by `by_clerkId` from `getUserIdentity()` (subject, email, name, picture); OCC makes racing tabs safe |
| `syncTokens.ts` | `list`, `create({name})` (action), `revoke({tokenId})`; internal `insert`, `lookupByHash`, `touchLastUsed` | | `create`: `raw = "ck_" + base64url(crypto.getRandomValues(32 bytes))`, store `sha256(raw)` + prefix, return raw once |
| `machines.ts` | `list`, `rename({machineId, label})` | | Settings page |
| `prices.ts` | `list`, `upsert`, `remove`, `seed` (internal) | | `seed` inserts the price table above once per deployment |
| `stats.ts` | `summary({from,to,userId?})`, `leaderboard({from,to})`, `trends({from,to,bucket,userId?})`, `breakdowns({from,to,userId?})`, `activityHeatmap({userId,endDay})`, `dayHourHeatmap({from,to,userId?})`, `quota()`, `bounds()` | authedQuery | Range args are inclusive day strings, validated (`from ≤ to`, ≤ 1,100 days); previous period computed server-side (`prevTo = from − 1`, same length); team scope reads `dailyRollups.by_day`, user scope `by_user_day`; folds with `mergeRollups`. `summary` returns `{ current, previous, change }` for every card metric plus `costUsd`, `costByKind {input, cached, output, reasoning}`, `cacheSavingsUsd`, `cacheHitRate`, `tokensPerTurn`, `tokensPerLine`, `avgSessionActiveMs`, `activeRate`, `ttftAvgMs`, `ttftP50Ms` (interpolated from the 16-bucket histogram), `unpricedModels`. `leaderboard` ranks by tokens in both periods → `rank`, `previousRank` (null for newcomers). `quota` = the machine with the newest `lastRateLimit.receivedAt`. `bounds` = first/last rollup day (for ALL) |
| `sessions.ts` | `listRecent({userId?, paginationOpts})`, `get({sessionId})` | authedQuery | `by_user_startedAt` / `by_startedAt` desc, `paginate` |
| `lib/cost.ts` | `costOf(tokens, price)`, `sumCost(byModel, priceMap)` | pure | `((input − cachedInput)·in + cachedInput·cached + output·out) / 1e6`; the structure splits output into non-reasoning/reasoning at the output price; `cacheSavings = cachedInput·(in − cached)/1e6`; unknown model → 0 + flagged |
| `auth.config.ts` | — | — | `{ providers: [{ domain: process.env.CLERK_FRONTEND_API_URL, applicationID: "convex" }] } satisfies AuthConfig` |

Shared code (`shared/src/*`) is imported from `web/convex/*.ts` by relative path
(`../../shared/src/...`), which Convex's esbuild bundling supports without configuration (verified);
the CLI bundles the same files with tsup. Queries never call `Date.now()`; the client passes day
strings (cacheable, reactive). Cost is computed at query time from `modelPrices` (≤ 30 docs), so a
price edit re-prices every visible period instantly.

## Sync protocol (`shared/src/sync.ts`, zod 4)

```jsonc
POST https://<deployment>.convex.site/api/v1/sync
Authorization: Bearer ck_…    Content-Type: application/json    X-Codex-Kaboo-Cli: 0.1.0-build…
{
  "schemaVersion": 1, "parserVersion": 1, "cliVersion": "0.1.0-build.202609011400.abc1234",
  "batchId": "uuid", "sentAt": 1756700000000,
  "machine": { "machineId": "uuid", "label": "brisk-otter", "platform": "darwin", "arch": "arm64",
               "nodeVersion": "24.17.0", "codexVersion": "0.150.1", "codexLatestVersion": "0.150.1",
               "hostname": null, "tz": "America/Los_Angeles" },
  "sessions":    [ /* SessionSummary = sessions doc minus userId/machineId/syncedAt, plus `effort`; re-derived in full per changed file */ ],
  "tokenEvents": [ /* TokenEvent = tokenEvents doc minus userId; only seq > lastUploadedSeq */ ],
  "rateLimit":   { "observedAt": 0, "usedPercent": 12.5, "windowMinutes": 10080, "resetsAt": 0, "planType": "…", "limitId": "…" }
}
```

Validation (both ends): `day` is a real `YYYY-MM-DD`, `hour` 0–23, `seq ≥ 0`, token counts finite
non-negative integers, timestamps within [2020, 2100], `ttft.hist.length === 16`, ≤ 64
mcpTools/skills entries, strings ≤ 256 chars; unknown keys stripped. Limits
(`shared/src/constants.ts`): body ≤ 8 MiB, ≤ 500 sessions and ≤ 5,000 events per request, 1,000
events per mutation, `TTFT_BUCKETS_MS = [250,500,750,1000,1500,2000,3000,4000,6000,8000,12000,
16000,24000,32000,60000,∞]`, `ROLLUP_VERSION = 1`. All timestamps are Unix ms. The response
advertises `limits` so the CLI can re-chunk, and `latestCliVersion` (from `public/cli/version.json`,
embedded at deploy) for the upgrade hint. Unchanged data ⇒ no request, except a machine-only
heartbeat at most hourly.

## Collector CLI (`cli/`)

Commands (`codex-kaboo <cmd>`, commander, `--json` everywhere):
- `login [--token ck_…] [--server URL] [--machine-name NAME] [--hostname]` — prompts for the token
  if omitted, calls `/api/v1/whoami`, writes `~/.codex-kaboo/config.json` (mode 0600). The server
  URL is baked in at build time (`CODEX_KABOO_SERVER`); `--server` overrides it for dev. The
  hostname is uploaded only with `--hostname`.
- `sync [--full] [--dry-run] [--scheduled] [--codex-home PATH]` — discover → parse changed files →
  upload. `--dry-run` = full parse, no network, no state write, per-file counts (`--json` prints the
  exact batches: the privacy audit). `--full` resets file state (machineId/config kept) and
  re-uploads everything; the server upserts, so it is safe. `--scheduled` = quiet, file logging,
  exit 0 when not logged in.
- `install [--systemd]` / `uninstall` — register/remove the 15-minute schedule, then run one sync.
- `status` — config, resolved Codex homes + file counts, last sync result, scheduler state, and
  "schedule broken" when the baked node/script paths vanished (nvm upgrades). `doctor` — Node
  version, Codex home found, token valid, scheduler present. `logout`, `--version`.

Files under `~/.codex-kaboo/` (`os.homedir()`, honours `%USERPROFILE%`; override with
`CODEX_KABOO_HOME`): `config.json` {server, token, machineId, label, hostnameOptIn, codexHomes[]},
`state.json`, `sync.log` (rotated at 1 MB), `sync.lock` (pid + timestamp, stale after 10 min),
`launchd.log`/`cron.log` for scheduler output. `state.json` = `{ version, lastSyncAt, lastSyncOk,
lastError, lastHeartbeatAt, latestCliVersion, rateLimit, files: { <sessionId>: { path (local only),
offset, lines, size, mtimeMs, tail (base64 of the last ≤ 64 bytes before offset), lastUploadedSeq,
summaryHash, generation, complete, lastError } } }`, written atomically (`.tmp` + rename) and keyed
by sessionId so a move to `archived_sessions/` or compression keeps progress.

Per run: lock → discover `rollout-*.jsonl[.zst]` under `sessions/**` and `archived_sessions/**` of
each Codex home (`CODEX_HOME` env → config `codexHomes` → `~/.codex`; cap 20,000 files; filename
regex `^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(<uuid>)(?:_(<uuid>))?\.jsonl(\.zst)?$`) → stat
each → skip when `size === offset` and `mtimeMs` unchanged → reset (`offset 0`, `generation++`,
warn) when the file shrank or the bytes at `[offset−64, offset)` differ from `tail` → **one
streaming pass from byte 0** (`filehandle.read` with positions, 256 KiB chunks, byte-accurate
offsets; the trailing partial line is not parsed) that re-derives the full session summary and
emits token events only for `seq > lastUploadedSeq` → upload → advance state only for acked
batches, persist after each file → send the newest rate-limit snapshot (by line timestamp) if newer
than the stored one → machine-only heartbeat at most hourly when nothing changed → log line,
unlock, summary. `.jsonl.zst` files are read through `zlib.createZstdDecompress` when available
(Node ≥ 22.15), otherwise skipped with a one-time warning, and treated as immutable (`complete`
after one pass). Files > 256 MB are skipped with a warning; a run is budgeted at 10 minutes so
scheduled runs never overlap.

Session reducer (`parser/session.ts`, pure `reduce(state, line)` + `finalize()`, used identically
by `--dry-run` and tests). Allow-list mapping:

| Line | Fields copied → output |
|---|---|
| `session_meta` | `id` → threadId; `timestamp` → startedAt (fallback: line ts); `cwd` → project = last segment split on `/[\\/]/`; `git.branch` → gitBranch; `originator`; `source` → `cli` / `exec` / `vscode` / `mcp` / `custom` / `internal` / `subagent:<kind>`; `isSubagent` = sub-agent source or `parent_thread_id` present; `parent_thread_id`; `cli_version`; `base_instructions.provenance.model` (model fallback) |
| `turn_context` | `turn_id` → `turns[turn_id] = {model, effort, mode}`; `timezone` (first seen) |
| `event_msg/task_started` | `turns++`, `currentTurnId`, `started_at·1000`, `model_context_window` |
| `event_msg/task_complete` | `activeMs += duration_ms ?? (completed_at − started_at)·1000`; TTFT `{count, sumMs, hist[16]}` from `time_to_first_token_ms`; `completedTurns++` |
| `event_msg/token_count` | if `info.last_token_usage` exists and is not all-zero → token event `{sessionId, seq, ts, day, hour, model, effort, turnId, project, isSubagent, input, cachedInput, cacheWrite, output, reasoning, total, contextWindow}` with model/effort from `turns[currentTurnId]` (else the session model); `rate_limits` → snapshot candidate (`resets_at·1000`) |
| `token_usage_record` (newer Codex) | token event from `usage.*`; sets `hasUsageRecords`, which drops the `token_count`-derived events at `finalize()` |
| `event_msg/item_completed` | by `item.type`: UserMessage / AgentMessage / Reasoning counts; CommandExecution → per `parsed_cmd[]` entry `read` / `list_files` / `search` / `unknown` → `commandRead/List/Search/Other` (empty → Other), skill detection on `parsed_cmd[].path` and `command[]` (matched, never stored); FileChange → `fileChange++`, `filesChanged += keys`, lines via `countDiffLines` (counts only inside `@@` hunks, ignores `\ No newline`) for `update` and `countLines(content)` for `add`/`delete`; Extension `web.search` / WebSearch → webSearch; ImageView → imageView; McpToolCall → mcpTool + `mcpTools["server/tool"]++`; ContextCompaction → compactions; anything else → other (+ local `itemTypes` diagnostics) |
| `event_msg/user_message` / `agent_message` | legacy counters, used only when the item counts are zero |
| `response_item/function_call` | `name` only: `mcp__…` or `<ns>__<tool>` outside the built-in set → MCP fallback counter (used when a file has no McpToolCall items) |
| `compacted` | compactions = max(compacted lines, ContextCompaction items) |
| any line | `endedAt = max(ts)`; `lineCount`; unknown types ignored and counted locally |

`finalize()` also sets `wallMs = endedAt − startedAt`, `inProgress` (a turn started without
completion, or mtime within 10 min), `summaryHash = sha1(canonical JSON)` and `parserVersion`.
Day/hour use `Intl.DateTimeFormat('en-CA', {timeZone, hourCycle:'h23'}).formatToParts` with the
session zone → machine zone → UTC fallback (verified on Node 24; ICU is built in).

Upload (`upload/client.ts`): per file, events in `seq` order chunked by 1,000 and 3.5 MB serialized;
the summary rides in the file's last batch; small files coalesce into one request. `fetch` +
`AbortSignal.timeout(30 s)`; retries ×5 with 1/2/4/8/16 s ± 25 % jitter honouring `Retry-After`
on network errors, 408/425/429/5xx; 401/403 → stop, exit 2, "run `codex-kaboo login`"; 413 →
halve the batch (min 50); 400/422 → mark the file `lastError`, skip it this run, exit 1. Only
acked batches advance `lastUploadedSeq`.

Scheduling (`schedule/*`: pure generators + an injected spawner, unit-tested; the scheduled
command is `"<process.execPath>" "<realpath of dist/codex-kaboo.js>" sync --scheduled`,
capturing `CODEX_HOME` when set at install time):
- macOS: `~/Library/LaunchAgents/com.codex-kaboo.sync.plist` (ProgramArguments, StartInterval
  900, RunAtLoad, ProcessType Background, StandardOut/ErrPath → `launchd.log`, EnvironmentVariables
  PATH); install = `launchctl bootout gui/<uid>/…` (ignore failure), `launchctl bootstrap gui/<uid>
  <plist>`, `launchctl kickstart -k gui/<uid>/com.codex-kaboo.sync`; status via `launchctl print`;
  XML-escaped paths.
- Linux: crontab block between `# BEGIN codex-kaboo` / `# END codex-kaboo` markers:
  `*/15 * * * * CODEX_KABOO_SCHEDULED=1 "<node>" "<script>" sync --scheduled >> "<home>/.codex-kaboo/cron.log" 2>&1`,
  replaced idempotently via `crontab -l` / `crontab -`; `--systemd` fallback writes a user
  `.service` + `.timer` (`OnUnitActiveSec=15min`, `Persistent=true`).
- Windows: hidden runner `%USERPROFILE%\.codex-kaboo\sync-hidden.vbs` (`WScript.Shell.Run …, 0,
  False`, no console flash) + `schtasks /Create /F /SC MINUTE /MO 15 /TN "codex-kaboo-sync" /TR
  "wscript.exe //B //Nologo \"<vbs>\""` (no `/RU`, hence no password prompt); PowerShell
  `-WindowStyle Hidden` fallback if VBScript is unavailable; status via `schtasks /Query /TN … /FO
  LIST /V` with localized labels matched loosely.

Packaging/distribution: `src/main.ts` starts with `#!/usr/bin/env node`; tsup (`format cjs`,
`platform node`, `target node18`, `noExternal: [/.*/]`, no `banner`, so the shebang is emitted
once and the file is chmod +x); `commander` and `zod` are devDependencies (bundled), so
`dependencies` is empty. `web/scripts/pack-cli.mjs` (web `prebuild`): stamp
`version = <base>-build.<yyyymmddHHmm>.<sha7>` (`VERCEL_GIT_COMMIT_SHA`), `npm run build -w cli`,
`npm pack --json --pack-destination <tmp>`, copy to `web/public/cli/codex-kaboo-cli.tgz` (stable
URL) plus a versioned copy and `public/cli/version.json`. Install:
`npm install -g https://<app>/cli/codex-kaboo-cli.tgz` (npm ≥ 12 needs `--allow-remote=all`; the
CLI's update hint prints the right variant); re-running replaces the installed copy even at the
same version (verified in npm's Arborist). README caveats: `%AppData%\npm` on PATH and the
PowerShell execution policy on Windows; EACCES with system Node on Linux (use nvm/fnm or
`npm config set prefix ~/.npm-global`).

Test fixtures are produced by `cli/scripts/make-fixture.mjs` from a real log, reviewed before
commit: structure and numbers kept, every string rewritten by key (identifiers/enums kept; `cwd` →
`/redacted/project-a`; paths → `/redacted/<n>` unless the basename is `SKILL.md`; `command` →
`["redacted"]`; diffs synthesized with identical `+`/`-` counts; `content` → `"x\n".repeat(n)`;
all other strings → `"<r:len>"`). Cases: paginated CLI session (compaction, web.search, add/update/
delete FileChange, skill read, 2 turns), legacy sub-agent (no ordinals, event_msg messages),
exec without git, partial trailing line, corrupt `\n`-terminated line, future types
(`world_state`, `token_usage_record`, `McpToolCall`, unknown items), `_<rolloutId>` filename, and
a small `.jsonl.zst`.

## Web app (`web/`)

Verified stack facts that shape the code (context7, 2026-09-01): Next 16 renamed the middleware
file to `src/proxy.ts` (Node runtime, named export `proxy`); `useSearchParams` (hence nuqs) needs a
`<Suspense>` boundary or `next build` fails; Clerk 7 (Core 3) removed `SignedIn/SignedOut/Protect`
(use `<Show when="signed-in">`), requires `ClerkProvider` inside `<body>` and pins React `~19.2`;
shadcn 4 defaults to Base UI, so init with `npx shadcn@latest init --base radix`; Recharts 3 renamed
`TooltipProps` → `TooltipContentProps`, stacks z-order by JSX order, needs `react-is`, and
`ResponsiveContainer` renders nothing until measured (SSR-safe); CSS custom properties cannot be
named after model names (dots), so series colors are passed explicitly; TypeScript `latest` is
7.x, pin `^5.9.3`; set `turbopack.root` to the repo root to silence the workspace-lockfile warning.

Auth/plumbing: `src/proxy.ts` with `clerkMiddleware` + `createRouteMatcher(['/sign-in(.*)',
'/sign-up(.*)', '/cli/(.*)'])` public, `auth.protect()` for the rest (`.tgz` is not in Clerk's
static-asset regex, so `/cli/(.*)` must be listed or `npm install -g <url>` gets a redirect).
`src/app/providers.tsx` = `ClerkProvider` → client `ConvexProviderWithClerk(useAuth from
@clerk/nextjs)` → `NuqsAdapter`. Data components render only inside Convex's `<Authenticated>`
(queries fired before the Clerk token reaches Convex would run unauthenticated); `<AuthLoading>`
shows the skeleton shell. `useEnsureUser` calls `users.ensure` once per sign-in (Convex
`useStoreUserEffect` pattern). Fonts: Inter (UI) + JetBrains Mono (table numerals) via
`next/font/google` variables + `@theme inline`.

URL state (nuqs, parsers in `src/lib/search-params.ts` importing from `nuqs/server` so hooks,
hrefs and tests share them): `range` = 1D/7D/30D/90D/ALL (default 30D, kept visible like Kaboo),
`from`/`to` = validated `YYYY-MM-DD` (custom range, `to` clamped to today, span ≤ 400 days, invalid →
30D), `section` (users/models/tools/projects/skills), `view` (volume/efficiency), `tab`
(overview/breakdown/efficiency/sessions); `history: 'push'`. Range survives navigation via
`useRangeHref`; page-local params are dropped. `src/lib/range.ts` is pure: 1D = [today, today];
N-day presets = [today−(N−1), today] with the previous period = the N days before; ALL =
[2000-01-01, today] with `prev = null` (delta pills hidden); day math on strings in UTC.
`today` comes from `useToday()` (`useSyncExternalStore`, null server snapshot → no hydration
mismatch); queries pass `"skip"` until it is known and never call `Date.now()` server-side.
Trend granularity: ≤ 120 days → daily, ≤ 730 → weekly, else monthly (server buckets).

Routes:
- `/` Home: `TopNav` (logo, Insights | My Page links, `RangePicker` pill with preset rows + shadcn
  Calendar range, `UserButton` with a Settings link); Volume | Efficiency toggle; Volume cards =
  Total tokens, Estimated cost (badge "API list price"), Generated lines, Sessions, plus the shared
  weekly quota gauge card (used %, "Resets in 2d 4h", plan, "as of 3 min ago · <machine>", amber
  stale badge when older than 2 h, empty state before the first sync); Efficiency cards = Cache hit
  rate, Tokens per turn, Avg session, TTFT median, Compactions, plus a Cost structure card
  (Input / Cached / Output / Reasoning $ and % as a 100 % bar). Section tabs Users (podium 2-1-3 +
  ranked table with metric toggle Tokens/Cost/Sessions/Messages/Generated lines/Tokens per line,
  Linear | Log bars, rank movement vs previous period) | Models (by model / by effort) | Tools
  (share bar + cards) | Projects | Skills. Below: "Token usage trend" stacked area by user with a
  Peak pill and "Tokens by model" stacked daily bars (top 7 + Other).
- `/users/[userId]` (My Page = own id): header; tabs Overview (rank card "#2 / 3", 13 small stat
  cards: est. cost, tokens, generated lines, tokens/line, input context, output tokens, active days,
  cache hit, active hours, sessions, total hours, messages, user messages; 12-month activity heatmap
  with fixed bins <10M/<100M/<1B/≥1B; token trend card with Tokens|Cost|Hours, Line|Bars|Both,
  Daily|Weekly|Monthly; Data Sync card with install commands + machines) | Breakdown (model, tool,
  skill, project, machine tables; time analysis: total/active hours, active rate, avg session,
  messages/session, peak hour, most active day, weekday × hour heatmap) | Efficiency (cost
  structure, cache savings vs no caching, cost per line, per-model table with "unpriced" flags) |
  Sessions (`usePaginatedQuery`, 20 per page: started, project, branch, model, effort, turns,
  tokens, cache hit, cost, active time, source badge).
- `/settings`: Sync tokens (list; "New token" dialog → raw token shown once in a copy box + a
  prefilled `codex-kaboo login --token …` line; revoke with confirm), Install instructions (macOS /
  Linux / Windows tabs; commands built from `window.location.origin`), Machines (rename), Model
  prices (inline-editable USD per MTok, validation ≥ 0, "unpriced models seen" quick-add).
- `/sign-in`, `/sign-up` (needed for Clerk invitation links), `/cli/codex-kaboo-cli.tgz` static.
- Onboarding: when the signed-in user has no machines yet, Home and My Page show an "Install the
  collector" card with the four commands.

Code layout: `src/lib/` pure, unit-tested modules (`format.ts`, `range.ts`, `search-params.ts`,
`colors.ts` stable entity → color slots, `metrics.ts` derived metrics + deltas with zero guards,
`chart-data.ts` rows/series + peak + top-N folding, `heatmap.ts` weeks × 7 grid, `install.ts`
command strings); `src/hooks/` (`use-range`, `use-today`, `use-now`, `use-stable-query` keeps
previous data while args change so range switches dim instead of flashing skeletons, `use-me`,
`use-entity-colors`); `src/components/{ui,layout,primitives,charts,home,user,settings}`.
Primitives: `StatCard` + `DeltaPill` (icon + text, polarity aware), `SegmentedControl` (shadcn
ToggleGroup, never empty), `DataTable` with optional in-row `BarCell` (linear or `log10(v+1)`),
`Podium`, `RankMovement`, `SectionCard`, `EmptyState`, `SectionErrorBoundary`, `InfoTooltip`
("How to read this data" glossary), `CopyBox`, `Num`, `AvatarName`. Charts: shadcn `ChartContainer`
over Recharts 3 (`TrendChart` stacked `AreaChart` with 2 px line + 12 % wash, `StackedBarChart`
with `maxBarSize 24`, `isAnimationActive={false}` so live updates don't replay animations, solid
hairline grid, `YAxis width="auto"`, custom tooltip listing every series sorted desc + Total);
pure HTML/CSS `StackedShareBar` (100 % bars with 2 px gaps, no pies), `ActivityHeatmap` and
`DayHourHeatmap` (CSS grids, one shared positioned tooltip, per-cell `aria-label`), `QuotaGauge`
(SVG 180° arc: green < 60 %, amber 60–85 %, red ≥ 85 %, always with a label). One axis per chart;
every chart card offers a Table view of the same rows. Visual language mirrors Kaboo: off-white
page `#f8f9fb`, white cards, 1 px `#e5e7eb` border, 12 px radius, no shadows, green accent, mono
tabular numerals; light theme only in v1 (dark tokens defined, not QA'd).
Palette (validated with the dataviz palette checker on white): categorical, fixed order, never
cycled: `#008300 #2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #4a3aa7 #e34948` (validated dark steps
exist); heat ramp `#eceff3` (zero) then `#6cc482 #2f9f55 #1a7a40 #0d532b`; status good `#0ca30c`,
warning `#fab219`, critical `#d03b3b`; delta pills `#006300/#e6f4e6` up, `#b42318/#fdecec` down.
Users get color slots by stable `userId` order, models by the all-time price-table registry (so
colors don't repaint when the range changes). Load the `dataviz` skill before writing chart code.

Backend fields the UI needs beyond raw sums (owned by `stats.ts`): `costUsd`,
`costByKind {input, cached, output, reasoning}`, `cacheSavingsUsd`, `unpricedModels[]`, previous-
period values for every card metric, `rank`/`prevRank` per user, and `users.list()` returning the
`_id` string used in `/users/[userId]`.

Tests: Vitest `unit` project (Node) for every `src/lib` module (formatting tables, range presets
at month/year/leap boundaries, ALL → `prev null`, custom fallback/clamp/cap, color slot stability,
top-N folding, heatmap grid alignment, install strings); `dom` project (jsdom + RTL) for
primitives and `RangePicker` (clicking 7D pushes `?range=7D`; custom writes `from/to`) using
`withNuqsTestingAdapter`. Recharts is never mounted in jsdom (no ResizeObserver); chart data
transforms are tested instead. Playwright + `@clerk/testing` smoke is optional and not in v1.

## Privacy rule (hard)

Uploaded: token counts, model names, efforts, tool kinds, skill names, project = basename(cwd),
git branch, timestamps/durations, line counts, Codex/CLI versions, platform/arch, user-chosen
machine label. Never uploaded: prompt/response text, command strings, file paths, diff contents,
repository URLs, hostnames. Test fixtures are synthetic. `sync --dry-run --json` shows the exact payload.

## Deployment and one-time setup

| Step | Who | Command / action |
|---|---|---|
| Create repo | me | `gh repo create Azealoo/codex-kaboo --public --source . --push` |
| Convex dev + prod | me (user runs `npx convex login` first if the CLI is not authenticated) | `npx convex dev` in `web/` (creates project + dev deployment, writes `.env.local`); later `npx convex deploy` |
| Clerk app | user | Create the app in the Clerk dashboard; enable email + Google; **activate the Convex integration** (current Clerk docs; it replaces the old manual JWT template named `convex`, which is the fallback if the integration switch is absent); copy the publishable key, secret key and Frontend API URL |
| Convex env | me | `npx convex env set CLERK_FRONTEND_API_URL https://…clerk.accounts.dev` (dev and `--prod`) |
| Seed prices | me | `npx convex run prices:seed` (dev and prod) |
| Vercel project | me + user | `vercel link` from repo root; Root Directory = `web` via REST `PATCH /v9/projects/<id> {"rootDirectory":"web"}` with the CLI's token (the CLI's `vercel project update` cannot set it; fallback: user sets it in the dashboard, 1 min). "Include source files outside of the Root Directory" is on by default (needed to pack `../cli`). Build command from `web/vercel.json`: `npx convex deploy --cmd "npm run build"` (this injects `NEXT_PUBLIC_CONVEX_URL` into the build). Env vars via `vercel env add`: `CONVEX_DEPLOY_KEY` (production deploy key from the Convex dashboard or `npx convex deployment token create`), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `CODEX_KABOO_SERVER=https://<deployment>.convex.site`. If workspace deps fail to resolve at build, set `installCommand: "cd .. && npm ci"` in `web/vercel.json`. |
| First real sync | me | Install the tgz on this Mac, `codex-kaboo login`, `install`; confirm 11 sessions appear |
| Lock sign-ups | user | After the three accounts exist: Clerk → User & Authentication → Restrictions → Sign-up mode "Restricted"/invite-only |

## Implementation phases (each phase: failing tests first, then code, then commit)

1. **Bootstrap** — repo, workspaces, TS/ESLint/Prettier/Vitest config, CI, README skeleton, spec
   file (`docs/superpowers/specs/…`), then writing-plans for the detailed task list.
2. **shared** — payload types + validators, metric helpers (cost, cache hit, tokens/line, ranges,
   previous period, TTFT histogram median). Unit tests.
3. **cli** — JSONL reader (byte offsets with multi-byte UTF-8, > 1 MB line, partial trailing line
   not counted, corrupt line skipped but advanced); reducer against the redacted fixtures (every
   mapping row, message-count fallback, `token_usage_record` suppression, MCP items vs fallback,
   skill regex incl. `.system` and backslashes, turn join by `turn_id`, newest rate limit);
   `countDiffLines`/`countLines`; `dayHour` (midnight, DST, invalid zone); state (atomic write,
   reset on shrink/tail mismatch, `--full`, keyed by sessionId across a move); batching and upload
   with stubbed `fetch` (retry/`Retry-After`, no retry on 401, 413 halving, only acked batches
   advance state, hourly heartbeat, dry-run makes no calls); scheduler generators (plist escaping,
   crontab block idempotence, schtasks args, vbs quoting) with a mocked spawner; commands; tsup
   build; `npm pack`. Smoke: `codex-kaboo sync --dry-run --json` against the real `~/.codex` must
   reproduce the verified totals (e.g. session …1180: input 1,437,354 / output 6,554) and contain
   no text or paths.
4. **convex** — schema + `lib/*`; `/api/v1/sync` (401/413/400 paths, idempotent re-send → zero
   inserts and no recompute, changed `summaryHash` → replace, modified event → replace touching
   both days, cross-user session/machine conflicts, chunking of 2,500 events, throttled
   `lastUsedAt`, rate-limit newest-by-`receivedAt`); `computeDayRollup` against a hand-computed
   fixture, recompute idempotence, batch-order independence, midnight-spanning session, empty-day
   deletion, `rebuildAll`; `stats` (previous range over month/leap boundaries, `change` null when
   previous is 0, team vs user scope, leaderboard `previousRank`, week/month buckets, heatmaps);
   `cost` (known math, unknown model flagged, price edit reflected); tokens (`create` returns raw
   once, `list` hides hashes, revoke → 401, cannot revoke another user's); `users.ensure`
   idempotent. All with convex-test in the edge-runtime environment.
5. **web** — scaffold (create-next-app, shadcn init, Clerk, Convex providers, proxy.ts), app shell
   (nav, range picker, user menu), overview page, person page, Data Sync card + tokens, prices page,
   CLI download route + prebuild pack. Component tests for formatters/range logic; visual check in
   Chrome against dev data.
6. **Deploy & verify** — Convex prod, Vercel, Clerk prod keys, real sync from this Mac, README
   install docs for macOS/Linux/Windows, hand-off notes (invite-only toggle).

## Verification

- `npm test` at the root passes (shared, cli, convex, web suites); CI green on GitHub.
- CLI against real data: `--dry-run --json` output contains no text/paths; totals match the
  verified numbers; `sync` to the dev deployment reports 11 inserted sessions and 426 inserted (430 `token_count` lines minus 4 all-zero)
  events; a second run makes no request (nothing changed) and `sync --full` reports everything
  unchanged.
- Dashboard on `localhost:3000`: sign in, see the synced sessions; card totals equal the CLI
  totals; leaderboard shows one user; edit a price → cost updates without reload; create a token,
  revoke it → next sync gets 401.
- Production: open the Vercel URL, sign in, install the tgz on this Mac, `login` + `install`,
  confirm the launchd job runs (`launchctl list | grep codex-kaboo`) and the machine's last-sync
  time updates in the Data Sync card.
- Linux/Windows scheduler paths are covered by unit tests only (no such machines here); the
  README asks the first Linux/Windows user to run `codex-kaboo doctor` and report.

## Risks and follow-ups

- Codex log format drifts with releases: unknown event/item types are ignored and counted in a
  `unknownTypes` debug field; the dashboard flags machines whose Codex version is newer than the
  version the parser was tested on (0.150.1).
- Open sign-up on a public URL until Clerk is switched to invite-only (user action, documented).
- Cross-user sessionId/machineId collision is rejected and reported, never merged.
- Days are local to where the work happened; the viewer's "today" is their browser's date, so the
  1D preset can be off by a day for a viewer in another zone (explained in the glossary tooltip).
- Scheduler fragility: nvm/fnm upgrades change `process.execPath`; `status`/`doctor` detect the
  broken path and say to re-run `install`. Sleeping laptops skip ticks; launchd catches up on wake.
- Rollups older than ~3 years would push an ALL-time query toward the 16 MiB read limit; add
  monthly rollups then. Storage grows ~100 MB/year, fine on Convex's free tier for ~2 years.
- Follow-ups not in v1: quota history chart (needs a snapshots table), dark mode QA, Playwright
  smoke tests, CSV export, per-machine data deletion.
