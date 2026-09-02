# codex-kaboo

A private team dashboard for a shared OpenAI Codex account: token usage, cache hit rate,
model/tool/project breakdowns, per-user pages and the shared weekly quota, modelled on Kaboo.

- `cli/` — collector installed on each machine; parses local Codex rollout logs and uploads metadata only
- `web/` — Next.js dashboard (Clerk auth) with the Convex backend in `web/convex/`
- `shared/` — sync payload schema and metric helpers shared by both

Design: `docs/superpowers/specs/2026-09-01-codex-kaboo-design.md`.

## Collector CLI (`codex-kaboo`)

Each teammate installs the collector once; it parses the local Codex rollout logs
(`~/.codex/sessions`) every 15 minutes and uploads **metadata only** — token counts, model,
effort, tool kinds, skill names, project folder name, git branch, timestamps, line counts,
Codex/CLI versions, platform. It never uploads prompts, responses, command lines, file paths,
diff contents, repository URLs or your hostname (unless you pass `login --hostname`).
Audit exactly what would be sent with `codex-kaboo sync --dry-run --json`. In that JSON, the
`batches` field is exactly the upload payload (what's checked above); the report's other
top-level fields, such as `homes[].path`, are local-only diagnostics for your own terminal and
are never uploaded — so paste only the `batches` field if you share dry-run output publicly,
since the full blob's `homes[].path` discloses your machine's Codex-home directory.

### Install

Open the dashboard → Settings → Sync tokens → "New token", then on your machine:

```bash
npm install -g https://<your-dashboard>/cli/codex-kaboo-cli.tgz   # npm 12+: add --allow-remote=all
codex-kaboo login --token ck_...      # also: --server https://<deployment>.convex.site, --machine-name laptop, --hostname
codex-kaboo install                   # registers the 15-minute schedule and runs the first sync
codex-kaboo status                    # login, Codex homes, last sync, scheduler health
```

Requires Node 18+ (Node 22.15+ to read compressed `.jsonl.zst` rollouts). Re-running
`npm install -g …` upgrades in place; `codex-kaboo doctor` checks Node, the Codex home, the token
and the scheduler.

### Commands

| Command | What it does |
|---|---|
| `login [--token ck_…] [--server URL] [--machine-name NAME] [--hostname]` | stores the token in `~/.codex-kaboo/config.json` (mode 0600) |
| `logout` | removes the token (sync progress in `state.json` is kept) |
| `sync [--full] [--dry-run] [--scheduled] [--codex-home PATH]` | parse new log lines and upload; `--full` re-uploads everything (safe, the server upserts); `--dry-run` shows what would be sent |
| `install [--systemd]` / `uninstall` | background schedule: launchd (macOS), cron or `--systemd` (Linux), Task Scheduler (Windows) |
| `status`, `doctor` | diagnostics; add `--json` to any command for machine-readable output |

Exit codes: 0 ok, 1 partial failure (see the message), 2 not logged in / token rejected.

### Files

`~/.codex-kaboo/` (override with `CODEX_KABOO_HOME`): `config.json`, `state.json` (per-file progress
keyed by session id), `sync.log` (rotated at 1 MB), `sync.lock`, `launchd.log` / `cron.log`,
`sync-hidden.vbs` (Windows). Codex home: `CODEX_HOME` or `~/.codex`.

### Per-OS notes

- **macOS**: `launchctl list | grep codex-kaboo` shows the agent; logs in `~/.codex-kaboo/launchd.log`.
- **Linux**: the crontab block between `# BEGIN codex-kaboo` / `# END codex-kaboo`; use `install --systemd`
  for a user timer (`systemctl --user status codex-kaboo-sync.timer`). If `npm install -g` fails with
  EACCES, use nvm/fnm or `npm config set prefix ~/.npm-global` and add it to `PATH`.
- **Windows**: make sure `%AppData%\npm` is on `PATH`; if PowerShell refuses to run `codex-kaboo`,
  run `codex-kaboo.cmd` or set the execution policy (`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).
  The task runs hidden through `sync-hidden.vbs` (`schtasks /Query /TN codex-kaboo-sync`).
- If Node was upgraded through nvm/fnm and `status` says "schedule broken", run `codex-kaboo install` again.
- First Linux/Windows users: please run `codex-kaboo doctor` and report the output.

### Development

`npm run test -w cli`, `npm run build -w cli` (single-file bundle in `cli/dist/codex-kaboo.js`),
`cli/scripts/make-fixture.mjs` (redacts a real rollout into a synthetic fixture),
`cli/scripts/check-dry-run.mjs` (privacy + totals audit against `cli/scripts/raw-totals.mjs`).
