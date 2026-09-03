# codex-kaboo

A private usage dashboard for a shared OpenAI Codex account. A small collector CLI reads the
Codex rollout logs on each machine and uploads **metadata only** to a Convex backend; a Next.js
dashboard (Clerk sign-in, deployed on Vercel) shows token volume, estimated cost, cache hit rate,
model/tool/project/skill breakdowns, per-user pages and the shared weekly quota.

```
Codex CLI ──writes──▶ ~/.codex/sessions/**/rollout-*.jsonl
                              │  codex-kaboo sync (every 15 min: launchd / cron / schtasks)
                              ▼  POST /api/v1/sync  (Bearer sync token)
                     Convex backend (sessions, token events, daily rollups)
                              ▲  Clerk JWT
                     Next.js dashboard on Vercel
```

## What is uploaded (and what never is)

Uploaded, grouped so it's easier to check against your own threat model than a flat list would be:

| Group           | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifiers     | machine label (yours to choose), machine ID (random UUID minted at login), session/thread/turn IDs (`sessionId`, `threadId`, `parentThreadId`, `turnId`)                                                                                                                                                                                                                                                                                                                                                                  |
| Token counts    | input / cached-input / cache-write / output / reasoning / total tokens per model response and per session; per-response context window size; which Codex log mechanism produced each number (a `"count"`/`"record"` tag — bookkeeping, not content)                                                                                                                                                                                                                                                                       |
| Models          | the **model name** on every session and every model response (e.g. `gpt-5.6-sol`, `codex-auto-review`) and the **reasoning effort** it ran at (`low` / `medium` / `high` / `xhigh`)                                                                                                                                                                                                                                                                                                                                       |
| Timing          | start/end timestamps, wall-clock and active durations, the session's day and its **IANA time zone** (e.g. `America/Los_Angeles`), the machine's own time zone, time-to-first-token stats                                                                                                                                                                                                                                                                                                                                  |
| Activity counts | turns, completed turns, user/agent messages, reasoning items, token events, compactions, lines added/removed, files changed, tool-kind counts, **MCP tool identifiers** (`server/tool`), **skill names**                                                                                                                                                                                                                                                                                                                  |
| Environment     | how the session started (`cli`, `exec`, `subagent:<kind>`, …) and, separately, its `originator` (the wrapper that set it, e.g. `codex-tui`); the **project folder's basename**; **git branch name**; platform/arch; Node, Codex and collector versions; parser bookkeeping (line counts, parse-error counts, parser/generation version numbers, whether the session was still open when uploaded); per-request envelope (a random batch ID, the moment the batch was sent, and the collector and payload-schema versions) |
| Rate limit      | your weekly usage percentage, **your OpenAI plan tier** (e.g. `"pro"`), the limit window in minutes, when it resets and was last observed, and an opaque limit ID                                                                                                                                                                                                                                                                                                                                                         |

`rateLimit.planType` deserves its own callout, not just a place in the table: it reports your
OpenAI subscription tier verbatim from the log (e.g. `"pro"`) — more than "your weekly rate-limit
percentage" suggests is being sent.

Never uploaded: prompt or response text, command strings, file paths, diff contents, or repository
URLs. **This machine's hostname** is never uploaded either, unless you opt in at login with
`--hostname` — that opt-in is sticky (it stays on for this machine across re-logins) until you run
`--no-hostname` to turn it back off.

That hostname promise is about the machine's own OS hostname. It does not extend to names you
chose yourself: MCP tool identifiers (`server/tool`), skill names, and the project folder's
basename are all uploaded exactly as written, with no scrubbing. Name an MCP server after an
internal host, a skill after a client, or a project directory after one, and that name reaches the
dashboard as typed — decide what to call things with that in mind.

Run `codex-kaboo sync --dry-run --json` any time to see the exact payload before you trust it — it
parses your logs and prints what a real sync would send, with no network call and no state
written. The `batches` array _is_ that payload; every field in the table above lives inside it.
Everything else the report prints is a **local-only diagnostic** — never uploaded, but often
holding an absolute path from your filesystem: `homes[].path`, `errors[]` and `files[].reason` in
that same dry-run report; both the top-level and the per-file `lastError` in
`~/.codex-kaboo/state.json`; `~/.codex-kaboo/sync.log`; and the plain-text output of `status` and
`doctor`. A permission or parse error, for instance, embeds the full path it choked on
(`EACCES: permission denied, open '/path/to/.codex/sessions/rollout-<id>.jsonl'`). So if you're
pasting output somewhere to ask for help: share the dry-run's `batches` field rather than the
whole blob, and skim `sync.log` first — it's the one file built for exactly that.

## Install the collector

Create a sync token on the dashboard (**Settings → Sync tokens → New token**), then on each
machine where you use Codex:

```bash
npm install -g https://<your-dashboard>/cli/codex-kaboo-cli.tgz
# npm 12 or newer blocks installing a remote tarball URL by default — add the flag right after -g:
# npm install -g --allow-remote=all https://<your-dashboard>/cli/codex-kaboo-cli.tgz
codex-kaboo login --token <token>
codex-kaboo install
codex-kaboo status
```

`<your-dashboard>` is a placeholder for wherever this is deployed — see Deployment below; it gets
filled in once a production URL exists. Sign-up is open to anyone who can reach that URL until the
three teammates' accounts exist (see Deployment), so a new teammate creates their own account at
the dashboard's sign-in page before making a sync token as above.

Requires Node 20 or newer (22.15+ recommended: it reads Codex's `.jsonl.zst` archives too).
Re-running `npm install -g …` upgrades the collector in place.

### macOS

`codex-kaboo install` registers a launchd agent (`com.codex-kaboo.sync`) that runs every 15
minutes and runs one sync immediately. Check it with `launchctl list | grep codex-kaboo`; its
log is `~/.codex-kaboo/launchd.log`. If you upgrade Node with nvm/fnm, run `codex-kaboo install`
again — see Troubleshooting below.

### Linux

`codex-kaboo install` adds a crontab block (`# BEGIN codex-kaboo` … `# END codex-kaboo`); its
output goes to `~/.codex-kaboo/cron.log`. `codex-kaboo install --systemd` uses a user timer
instead (`systemctl --user status codex-kaboo-sync.timer`). If `npm install -g` fails with
`EACCES`, use nvm/fnm or `npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to
`PATH`. Please run `codex-kaboo doctor` after installing and report anything red — Linux is
covered by unit tests only.

### Windows

`codex-kaboo install` creates the scheduled task `codex-kaboo-sync` (every 15 minutes, hidden
window, no password prompt). Make sure `%AppData%\npm` is on `PATH`, and in PowerShell allow npm
scripts with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Please run `codex-kaboo
doctor` and report anything red — Windows is covered by unit tests only.

### Commands

| Command                                                                                            | What it does                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex-kaboo login [--token T] [--server URL] [--machine-name NAME] [--hostname \| --no-hostname]` | Stores the token in `~/.codex-kaboo/config.json` (mode 0600) after checking it with `/api/v1/whoami`; `--hostname` turns the hostname opt-in on, `--no-hostname` turns it off, and a bare `login` keeps whatever was set before |
| `codex-kaboo sync [--full] [--dry-run] [--scheduled] [--codex-home PATH]`                          | Parses changed rollout files and uploads new data; `--dry-run --json` prints the payload without any network call                                                                                                               |
| `codex-kaboo install [--systemd]` / `codex-kaboo uninstall [--systemd]`                            | Registers / removes the 15-minute schedule (`--systemd`: a systemd user timer on Linux instead of cron)                                                                                                                         |
| `codex-kaboo status [--codex-home PATH] [--systemd]`                                               | Login state, Codex homes found, last sync, tracked/parked files, scheduler health, weekly quota                                                                                                                                 |
| `codex-kaboo doctor [--codex-home PATH] [--systemd]`                                               | Checks Node version, Codex home, login, token validity, scheduler and local state                                                                                                                                               |
| `codex-kaboo logout`                                                                               | Removes the token (`state.json` sync progress is kept, so logging back in resumes where it left off)                                                                                                                            |

Every command also accepts `--json` (machine-readable output on stdout) and `--verbose` (debug
logging on stderr). Exit codes are command-specific — check the table below rather than assuming
one scheme covers all of them:

| Command     | Exit codes                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `sync`      | `0` ok · `1` partial failure (see the message) · `2` not logged in or the token was rejected   |
| `login`     | `0` ok · `2` failed (bad/missing token, unreachable or unconfigured server)                    |
| `install`   | `0` ok · `1` the sync it runs right after installing had a partial failure · `2` not logged in |
| `uninstall` | `0` ok · `1` failed to remove the schedule                                                     |
| `doctor`    | `0` all checks passed · `1` any check failed, including not being logged in                    |
| `logout`    | `0` always                                                                                     |
| `status`    | never sets an exit code (always exits `0`) — read the printed state instead                    |

State lives in `~/.codex-kaboo/` (`CODEX_KABOO_HOME` overrides it); the Codex home is
`CODEX_HOME` or `~/.codex`.

### Troubleshooting

`codex-kaboo doctor` runs six checks — Node version, Codex home found, logged in, token still
valid, scheduler installed and healthy, local state uncorrupted — and prints `ok`/`FAIL` next to
each. `codex-kaboo status` is the quieter view: login, machine label, each Codex home with its
rollout-file count, the last sync's time and result, how many files are tracked (and how many
failed and were "parked" after repeated identical failures), scheduler health, and the shared
weekly quota if known.

Both commands run the same scheduler check, so both report a broken schedule the same way. The
most common cause on a laptop is switching Node versions with nvm/fnm: the schedule pins the
exact Node binary that was active when you ran `install`, so an upgrade leaves it pointing at a
path that no longer exists. `status`/`doctor` then say `schedule broken: missing <path>; run
codex-kaboo install again` (or `install --systemd` if that's how you scheduled it on Linux) — do
exactly that and the schedule is repinned to the current Node.

## Dashboard

- **Insights** (`/`): range pill (Today / Last 7 days / Last 30 days / Last 90 days / All time /
  custom), Volume and Efficiency cards with change vs. the previous period, the shared weekly
  quota gauge, Users (podium + ranked table), Models, Tools, Projects and Skills, token trend by
  user and by model.
- **My Page** (`/users/<id>`): rank, 13 stat cards, a 12-month activity heatmap, token trend
  (tokens / cost / hours), Data Sync (your machines and the install commands), Breakdown
  (time analysis + weekday × hour heatmap, then model / tool / project / skill / machine and
  source tables), Efficiency (cost structure, cache savings, cost per line, per-model pricing),
  Sessions (newest first).
- **Settings**: sync tokens, install instructions, machines (rename), model prices (USD per
  million tokens; edits re-price everything instantly).

## How the numbers are defined

- **Cache hit rate** = cached input tokens ÷ input tokens.
- **Cost** is an estimate at API list prices (input / cached input / output; reasoning tokens are
  part of output and billed at the output rate) — the team's Codex account is actually billed by
  subscription, not by token, so this is a relative-usage number, not an invoice. Prices live
  under Settings and are editable there; every cost figure on the dashboard re-prices instantly
  when you change one. A model with no price row shows as "unpriced" and contributes $0.
  `codex-auto-review`, the model Codex's own review sub-agent runs on, has no published rate; it
  is seeded at `gpt-5.6-sol`'s so that sub-agent tokens are not silently free. That is an
  assumption — change it under Settings if you have a better number.
- **Sub-agent threads** (for example an automated review pass Codex spawns on its own) count
  toward token totals and cost, because they draw on the same shared weekly quota — but they're
  excluded from session, turn and message counts, so a user's session/message numbers reflect
  only the threads they actually drove.

## Development

```bash
npm ci                                   # workspaces: shared, cli, web
npm run typecheck && npm run lint && npm test
cd web && npx convex dev                 # creates/links the dev deployment, writes web/.env.local
npx convex env set CLERK_FRONTEND_API_URL https://<slug>.clerk.accounts.dev
npx convex run prices:seed
npx convex run rollups:rebuildAll        # required: rebuilds any rollup computed under an older ROLLUP_VERSION
cd .. && npm run dev -w web              # http://localhost:3000
```

Develop on Node 22 or newer. The collector supports Node 20 and CI keeps it covered there, but the
dashboard's jsdom tests cannot run on it — jsdom 30 bundles an undici that needs a Node 22 API — so
`npm test` fails on Node 20 with `webidl.util.markAsUncloneable is not a function`. On Node 20, run
`npm test -w shared -w cli` and `npm run test:no-dom -w web`, which is what CI does.

`web/.env.local` needs `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and
`NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` next to the Convex lines written by `npx convex dev`
(the sign-up URL comes from `<ClerkProvider signUpUrl="/sign-up">`, not from an env var). In the
Clerk dashboard, activate the **Convex** integration (or add a JWT template named `convex`).

Point a locally built collector at the dev deployment with
`codex-kaboo login --server https://<deployment>.convex.site --token ck_…`.

## Deployment

`bash scripts/deploy.sh` does the Vercel half in one pass — links the project, sets Root Directory
(the CLI cannot set that field; the script uses the REST API), sets every environment variable,
mints the Convex deploy key straight into Vercel without it passing through the terminal, and
deploys. It reads the deployment-specific values from the environment so no identifier lives in
this public repo:

```bash
CONVEX_SITE=https://<prod-deployment>.convex.site \
CLERK_PUBLISHABLE_KEY=pk_live_… CLERK_SECRET_KEY=sk_live_… \
CLERK_FRONTEND_API_URL=https://<slug>.clerk.accounts.dev \
bash scripts/deploy.sh
```

The three `CLERK_*` values are optional: without them it deploys with placeholders, which builds and
serves but cannot sign anyone in — useful for proving the pipeline before the Clerk application
exists, and safe only while production holds no data. Re-run with the real values to finish.

The rest of this section is what that script automates, plus the parts only a human can do.

Vercel project with **Root Directory = `web`** (build command from `web/vercel.json`:
`npx convex deploy --cmd "npm run build"`), environment variables `CONVEX_DEPLOY_KEY`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`,
`CODEX_KABOO_SERVER` (= `https://<prod deployment>.convex.site`) and `CODEX_KABOO_WEB_ORIGIN`
(= the dashboard URL — the same placeholder called out under "Install the collector" above). The
build packs the collector into `/cli/codex-kaboo-cli.tgz` and sets `LATEST_CLI_VERSION` on the
Convex deployment so the CLI can hint about upgrades. The Convex production deployment needs
`CLERK_FRONTEND_API_URL` and a one-time `npx convex run prices:seed --prod`.

**Required, every deploy — on both deployments, not just prod:** also run
`npx convex run rollups:rebuildAll` against dev and `npx convex run rollups:rebuildAll --prod`
against production. It recomputes every stored daily rollup under the current
`ROLLUP_VERSION` (`shared/src/constants.ts`), paging until done; until it runs, any rollup still
stored under an older version keeps that version's (possibly wrong) numbers — right now that means
`byMachine`/`bySource` token totals computed the old, session-basis way. On a fresh deployment with
no rollups yet, the first call correctly returns `{done: true, recomputed: 0}`; read that as
"nothing to recompute yet," not a failure to find anything.

A deployment that already holds data from before this version needs one more thing first: Convex
refuses to push a schema that stored documents violate, and `tokenEvents.machineId`, `.source`,
`.origin` and `sessions.eventOrigin` are now required. If `npx convex dev`/`deploy` rejects the
push for that reason, clear the `tokenEvents` and `sessions` tables (Convex dashboard → Data →
_Clear table_) and re-run `codex-kaboo sync --full` on each machine — the rollout logs are the
source of truth, so nothing is lost. Fresh deployments never hit this.

Anyone who can sign in sees everything. Once the three accounts exist, switch the Clerk instance
to restricted sign-ups (Clerk → User & Authentication → Restrictions) and update the sign-up
sentence under "Install the collector" above accordingly.

## Layout

- `shared/` — sync payload schema (zod), day math and metric helpers used by the CLI, backend and UI.
- `cli/` — the collector (`codex-kaboo`), bundled into one file by tsup.
- `web/` — Next.js dashboard; `web/convex/` — Convex schema, HTTP sync endpoint and queries.
- `docs/superpowers/specs/` — the design spec; `docs/superpowers/plans/` — implementation plans.
