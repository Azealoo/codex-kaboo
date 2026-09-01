# codex-kaboo

A private team dashboard for a shared OpenAI Codex account: token usage, cache hit rate,
model/tool/project breakdowns, per-user pages and the shared weekly quota, modelled on Kaboo.

- `cli/` — collector installed on each machine; parses local Codex rollout logs and uploads metadata only
- `web/` — Next.js dashboard (Clerk auth) with the Convex backend in `web/convex/`
- `shared/` — sync payload schema and metric helpers shared by both

Design: `docs/superpowers/specs/2026-09-01-codex-kaboo-design.md`.
