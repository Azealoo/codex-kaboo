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

Uploaded: token counts per model response, model names and reasoning efforts, tool kinds and MCP
tool identifiers (`server/tool`), skill names, the **basename** of the project folder, git branch
names, timestamps and durations, counts of added/removed and changed files, how the session was
started (`cli`, `exec`, `subagent:<kind>`, …), the session's IANA time zone (e.g.
`America/Los_Angeles`), your weekly rate-limit percentage, Codex/collector/Node versions,
platform/arch and the machine label you choose. Never uploaded: prompts, responses, command
strings, file paths, diff contents, repository URLs, hostnames (unless you opt in with
`--hostname`).

Run `codex-kaboo sync --dry-run --json` any time to see the exact payload before you trust it —
it parses your logs and prints what a real sync would send, with no network call and no state
written. In that JSON, the `batches` array *is* the upload payload; the report's other top-level
fields (for example `homes[].path`) are local-only diagnostics for your own terminal and are
never uploaded. So if you paste dry-run output somewhere to ask for help, share the `batches`
field rather than the whole blob — `homes[].path` is a real path on your machine.

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

> **TODO (fill in once known):**
> - `<your-dashboard>` above is a placeholder — there is no production URL until Deployment
>   (below) has been done. Once it has, replace every `<your-dashboard>` in this file with it.
> - How a new teammate gets a dashboard account. Sign-up is open by default; once the Clerk
>   application exists (see Deployment), add the sign-up/invite link here, and update the last
>   paragraph of Deployment once sign-up has been switched to invite-only.

Requires Node 18 or newer (22.15+ recommended: it reads Codex's `.jsonl.zst` archives too).
Re-running `npm install -g …` upgrades the collector in place.

### macOS
`codex-kaboo install` registers a launchd agent (`com.codex-kaboo.sync`) that runs every 15
minutes and runs one sync immediately. Check it with `launchctl list | grep codex-kaboo`; its
log is `~/.codex-kaboo/launchd.log`. If you upgrade Node with nvm/fnm, run `codex-kaboo install`
again — see Troubleshooting below.

### Linux
`codex-kaboo install` adds a crontab block (`# BEGIN codex-kaboo` … `# END codex-kaboo`);
`codex-kaboo install --systemd` uses a user timer instead (`systemctl --user status
codex-kaboo-sync.timer`). If `npm install -g` fails with `EACCES`, use nvm/fnm or
`npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to `PATH`. Please run
`codex-kaboo doctor` after installing and report anything red — Linux is covered by unit tests
only.

### Windows
`codex-kaboo install` creates the scheduled task `codex-kaboo-sync` (every 15 minutes, hidden
window, no password prompt). Make sure `%AppData%\npm` is on `PATH`, and in PowerShell allow npm
scripts with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Please run `codex-kaboo
doctor` and report anything red — Windows is covered by unit tests only.

### Commands
| Command | What it does |
|---|---|
| `codex-kaboo login [--token T] [--server URL] [--machine-name NAME] [--hostname]` | Stores the token in `~/.codex-kaboo/config.json` (mode 0600) after checking it with `/api/v1/whoami` |
| `codex-kaboo sync [--full] [--dry-run] [--scheduled] [--codex-home PATH]` | Parses changed rollout files and uploads new data; `--dry-run --json` prints the payload without any network call |
| `codex-kaboo install [--systemd]` / `codex-kaboo uninstall [--systemd]` | Registers / removes the 15-minute schedule (`--systemd`: a systemd user timer on Linux instead of cron) |
| `codex-kaboo status [--codex-home PATH] [--systemd]` | Login state, Codex homes found, last sync, tracked/parked files, scheduler health, weekly quota |
| `codex-kaboo doctor [--codex-home PATH] [--systemd]` | Checks Node version, Codex home, login, token validity, scheduler and local state |
| `codex-kaboo logout` | Removes the token (`state.json` sync progress is kept, so logging back in resumes where it left off) |

Every command also accepts `--json` (machine-readable output on stdout) and `--verbose` (debug
logging on stderr). Exit codes: `0` ok, `1` partial failure (see the message), `2` not logged in
or the token was rejected.

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
  (time analysis + weekday × hour heatmap + tables), Efficiency (cost structure, cache savings,
  cost per line, per-model pricing), Sessions (newest first).
- **Settings**: sync tokens, install instructions, machines (rename), model prices (USD per
  million tokens; edits re-price everything instantly).

## How the numbers are defined

- **Cache hit rate** = cached input tokens ÷ input tokens.
- **Cost** is an estimate at API list prices (input / cached input / output; reasoning tokens are
  part of output and billed at the output rate) — the team's Codex account is actually billed by
  subscription, not by token, so this is a relative-usage number, not an invoice. Prices live
  under Settings and are editable there; every cost figure on the dashboard re-prices instantly
  when you change one. A model with no price row shows as "unpriced" and contributes $0.
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
cd .. && npm run dev -w web              # http://localhost:3000
```

`web/.env.local` needs `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and
`NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` next to the Convex lines written by `npx convex dev`
(the sign-up URL comes from `<ClerkProvider signUpUrl="/sign-up">`, not from an env var). In the
Clerk dashboard, activate the **Convex** integration (or add a JWT template named `convex`).

Point a locally built collector at the dev deployment with
`codex-kaboo login --server https://<deployment>.convex.site --token ck_…`.

## Deployment

Vercel project with **Root Directory = `web`** (build command from `web/vercel.json`:
`npx convex deploy --cmd "npm run build"`), environment variables `CONVEX_DEPLOY_KEY`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`,
`CODEX_KABOO_SERVER` (= `https://<prod deployment>.convex.site`) and `CODEX_KABOO_WEB_ORIGIN`
(= the dashboard URL — the same placeholder called out under "Install the collector" above). The
build packs the collector into `/cli/codex-kaboo-cli.tgz` and sets `LATEST_CLI_VERSION` on the
Convex deployment so the CLI can hint about upgrades. The Convex production deployment needs
`CLERK_FRONTEND_API_URL` and a one-time `npx convex run prices:seed --prod`.

Anyone who can sign in sees everything. Once the three accounts exist, switch the Clerk instance
to restricted sign-ups (Clerk → User & Authentication → Restrictions) and update the placeholder
sign-up note under "Install the collector" above accordingly.

## Layout

- `shared/` — sync payload schema (zod), day math and metric helpers used by the CLI, backend and UI.
- `cli/` — the collector (`codex-kaboo`), bundled into one file by tsup.
- `web/` — Next.js dashboard; `web/convex/` — Convex schema, HTTP sync endpoint and queries.
- `docs/superpowers/specs/` — the design spec; `docs/superpowers/plans/` — implementation plans.
