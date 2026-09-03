# Convex backend

This is codex-kaboo's Convex deployment: the `codex-kaboo` collector CLI uploads metadata here,
and the Next.js dashboard reads it back. See `docs/superpowers/specs/2026-09-01-codex-kaboo-design.md`
for the full design; this file is just an orientation to what lives in this directory.

## HTTP surface (`http.ts`, handlers in `ingest.ts` and `summary.ts`)

Four routes, authenticated with a **Bearer sync token** (not Clerk — the CLI has no browser
session). The shared plumbing — token lookup, JSON and error responses — lives in `lib/http.ts`:

| Path              | Method | Purpose                                                                                                                         |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/sync`    | `POST` | Accepts a `SyncBatch` (`shared/src/sync.ts`), upserts sessions/token events, recomputes affected daily rollups                  |
| `/api/v1/whoami`  | `GET`  | Validates a token and returns the user/token identity — what `codex-kaboo login` calls to confirm a pasted token                |
| `/api/v1/summary` | `GET`  | The menu bar card's four ranges plus the account quota (`shared/src/summary.ts`); `?today=YYYY-MM-DD` is the client's local day |
| `/api/v1/health`  | `GET`  | Unauthenticated liveness check                                                                                                  |

The dashboard itself talks to Convex through the generated `api` object with a Clerk JWT, via
`authedQuery`/`authedMutation` in `lib/auth.ts` — not through HTTP routes.

## Data model (`schema.ts`)

| Table          | Holds                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `users`        | One row per Clerk identity (`clerkId`, name/email/image, `createdAt`, `lastSeenAt`)                             |
| `syncTokens`   | Sync tokens by their sha256 hash (the raw token is never stored) — `prefix` and `name` are what the UI shows    |
| `machines`     | One row per machine that has ever synced: label, platform/arch/versions, opt-in hostname, last known rate limit |
| `sessions`     | One row per Codex session/thread, denormalised from `SessionSummary`                                            |
| `tokenEvents`  | One row per model response (token counts, day/hour, source/origin tags)                                         |
| `dailyRollups` | Precomputed per-(user, day) aggregates the dashboard actually queries, versioned by `ROLLUP_VERSION`            |
| `modelPrices`  | Editable USD-per-million-token price table used to turn token counts into cost                                  |

`dailyRollups` is the read path for almost everything the dashboard renders — `sessions` and
`tokenEvents` are the source of truth it's built from, not what queries hit directly.

## `lib/`

Pure, unit-tested helpers shared by the functions above: `aggregate.ts` (build/merge a day's
rollup from its events and sessions), `cost.ts` (price a `Tokens` object), `auth.ts`
(`authedQuery`/`authedMutation` wrappers that resolve the Clerk identity into a `users` row),
`validators.ts` (Convex `v.*` validators mirroring the zod shapes in `shared/src/sync.ts` — the two
must be kept in sync by hand), `constants.ts`, `days.ts`, `hash.ts`, `types.ts`.

## Rollups and `ROLLUP_VERSION`

Every upsert recomputes the rollup(s) it touched immediately (`recomputeDay`/`recomputeDays` in
`rollups.ts`), so the dashboard never reads a stale aggregate — for newly-synced data. What it does
_not_ do is touch rollups nothing has re-synced: those keep whatever `ROLLUP_VERSION` they were
last written under. So whenever the aggregation logic changes and `ROLLUP_VERSION` bumps (currently
`2`, in `shared/src/constants.ts` — the `byMachine`/`bySource` tokens went from session-derived to
event-derived), running `npx convex run rollups:rebuildAll` (add `--prod` against production) is a
**required** step on every deployment, not an optional cleanup — see the root README's Deployment
section. It pages through every stored rollup and recomputes it; on a deployment with no rollups
yet, the first call returns `{done: true, recomputed: 0}`, which is success, not a no-op failure.

## Local dev and tests

`npx convex dev` from `web/` links a dev deployment and writes `web/.env.local`. It needs
`CLERK_FRONTEND_API_URL` set on the deployment (`auth.config.ts` reads it) before it will push, and
`npx convex run prices:seed` once to populate `modelPrices`. Every module above has a co-located
`*.test.ts` using `convex-test`; run them with `npm test -w web` (Vitest) — no live deployment
required.
