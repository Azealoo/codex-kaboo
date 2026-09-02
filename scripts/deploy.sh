#!/usr/bin/env bash
#
# One-shot Vercel provisioning and deploy for codex-kaboo.
#
# Everything here is also written out in the README's Deployment section; this exists because the
# order matters (Convex's auth config must be pushed before the web build runs) and because two of
# the values are secrets that should never pass through a terminal transcript. Both are piped: the
# Convex deploy key goes straight from `convex deployment token create` into `vercel env add`, and
# the Vercel API token is read from the CLI's own auth file into a variable that is never echoed.
#
# Usage — everything comes from the environment, so no identifier is committed to this public repo:
#
#   CONVEX_SITE=https://<prod-deployment>.convex.site \
#   CLERK_PUBLISHABLE_KEY=pk_live_... \
#   CLERK_SECRET_KEY=sk_live_... \
#   CLERK_FRONTEND_API_URL=https://<slug>.clerk.accounts.dev \
#   scripts/deploy.sh [project-name]
#
# The three CLERK_* values are optional. Without them the script deploys with format-valid
# PLACEHOLDERS: next.config.ts only checks that the two build-time keys are present, so the build
# succeeds and the pipeline gets exercised, but nobody can sign in until they are replaced. That is
# a deliberate staging mode — re-run with the real values to finish. Nothing is exposed while it is
# in that state, provided production holds no usage data yet.
set -euo pipefail

PROJECT=${1:-codex-kaboo}
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$ROOT"

: "${CONVEX_SITE:?set CONVEX_SITE to the production deployment's .convex.site URL}"

PLACEHOLDER_PK=pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk # decodes to example.clerk.accounts.dev
PLACEHOLDER_SK=sk_test_placeholder_replace_me
PK=${CLERK_PUBLISHABLE_KEY:-$PLACEHOLDER_PK}
SK=${CLERK_SECRET_KEY:-$PLACEHOLDER_SK}
if [ "$PK" = "$PLACEHOLDER_PK" ]; then
  echo "!! No CLERK_PUBLISHABLE_KEY given — deploying with placeholders. Sign-in will NOT work."
  echo "!! Re-run with the real values once the Clerk application exists."
fi

# Convex first: auth.config.ts reads CLERK_FRONTEND_API_URL at push time and Convex refuses to push
# an auth config whose env var is unset, so the web build (which runs `convex deploy`) would fail.
if [ -n "${CLERK_FRONTEND_API_URL:-}" ]; then
  echo "== Convex: CLERK_FRONTEND_API_URL"
  (cd "$ROOT/web" && npx convex env set CLERK_FRONTEND_API_URL "$CLERK_FRONTEND_API_URL" --prod)
fi

echo "== 1/5  create and link the project"
# Two steps, not one. `vercel link --project` only links an EXISTING project ("required for
# non-interactive existing-project links"), and a bare `vercel deploy` in an unlinked directory
# names the project after the current DIRECTORY — which here is the worktree, so it would silently
# create one called `v1-build`. Create it explicitly by name first; `|| true` because re-running
# this script must stay idempotent.
npx vercel project add "$PROJECT" 2>/dev/null || true
npx vercel link --yes --project "$PROJECT"
PROJECT_ID=$(node -p "require('$ROOT/.vercel/project.json').projectId")
ORG_ID=$(node -p "require('$ROOT/.vercel/project.json').orgId")

echo "== 2/5  Root Directory -> web"
# `vercel project update` cannot set this field; the REST API can. Without it the build runs at the
# repo root, where there is no Next.js app.
VC_TOKEN=$(node -p "require(require('os').homedir()+'/Library/Application Support/com.vercel.cli/auth.json').token")
curl -sS -X PATCH "https://api.vercel.com/v9/projects/$PROJECT_ID?teamId=$ORG_ID" \
  -H "Authorization: Bearer $VC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":"web"}' \
  -o /dev/null -w "    HTTP %{http_code}\n"

echo "== 3/5  environment variables"
set_env() {
  npx vercel env rm "$1" production --yes >/dev/null 2>&1 || true
  printf '%s' "$2" | npx vercel env add "$1" production >/dev/null 2>&1
  echo "    set $1"
}
set_env CODEX_KABOO_SERVER "$CONVEX_SITE"
set_env CODEX_KABOO_WEB_ORIGIN "${WEB_ORIGIN:-https://$PROJECT.vercel.app}"
set_env NEXT_PUBLIC_CLERK_SIGN_IN_URL /sign-in
set_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "$PK"
set_env CLERK_SECRET_KEY "$SK"

echo "== 4/5  Convex deploy key (minted and piped; never printed)"
npx vercel env rm CONVEX_DEPLOY_KEY production --yes >/dev/null 2>&1 || true
(cd "$ROOT/web" && npx convex deployment token create vercel --deployment prod 2>/dev/null | tr -d '\n') |
  npx vercel env add CONVEX_DEPLOY_KEY production >/dev/null 2>&1
echo "    set CONVEX_DEPLOY_KEY"

echo "== 5/5  deploy to production"
npx vercel --prod --yes

echo
echo "Done. If this ran with placeholders, the remaining steps are:"
echo "  1. Create the Clerk application and activate its Convex integration."
echo "  2. Re-run this script with CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY and CLERK_FRONTEND_API_URL."
echo "  3. Set Clerk sign-up to Restricted and invite your team BEFORE sharing the URL."
