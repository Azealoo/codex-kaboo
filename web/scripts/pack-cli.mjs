#!/usr/bin/env node
// Builds the collector CLI, packs it into web/public/cli/, writes version.json and, during a
// Vercel production build (CONVEX_DEPLOY_KEY present), advertises the version to Convex.
// The version is stamped by temporarily rewriting cli/package.json; the file is always restored.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const webDir = path.join(root, "web");
const cliPkgPath = path.join(root, "cli", "package.json");
const outDir = path.join(webDir, "public", "cli");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function capture(cmd, args, cwd = root) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function passthrough(cmd, args, cwd = root) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

// Exported (rather than only used internally) so the "build.<stamp>.<sha7>" shape stays covered by
// a unit test without re-running the packer itself — see pack-cli.test.ts.

/** Short commit sha: `VERCEL_GIT_COMMIT_SHA` (Vercel supplies it) or local `git rev-parse`. */
export function commitSha() {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return capture("git", ["rev-parse", "--short=7", "HEAD"]).trim();
  } catch {
    return "local";
  }
}

/** `yyyymmddHHmm` in UTC, used as the `<stamp>` segment of `<base>-build.<stamp>.<sha7>`. */
export function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}`;
}

/** The full stamped version string reported by `codex-kaboo --version` and `version.json`. */
export function buildVersion(pkgVersion, sha, date) {
  const base = String(pkgVersion).split("-")[0];
  return `${base}-build.${stamp(date)}.${sha}`;
}

/**
 * Build-time values whose absence only bites once the build is SERVED, described in full.
 *
 * The Clerk checks used to live in `next.config.ts`, which looked like the natural home and is the
 * wrong one: `next typegen` — which `npm run typecheck` runs — loads that file with phase
 * `phase-production-build` and NODE_ENV=production, indistinguishable from a real build. A guard
 * there fails typecheck on every checkout without a `.env.local`, which is every CI run, and passes
 * locally for the one reason that has nothing to do with correctness. The prebuild is the real
 * gate: `npm run build` reaches it, on Vercel and in CI alike.
 *
 * Every problem is collected rather than thrown at the first, so one build reports the whole list.
 */
export function buildEnvProblems(env) {
  const problems = [];
  if (!env.CODEX_KABOO_SERVER)
    problems.push("CODEX_KABOO_SERVER is not set; the packed CLI would need `--server` at login.");
  for (const key of ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]) {
    if (!env[key])
      problems.push(`${key} is not set; every route would 500 because Clerk cannot initialize.`);
  }
  return problems;
}

/** Whether this build will be served to someone — the case where the problems above are fatal. */
export function isDeployBuild(env) {
  return Boolean(env.CONVEX_DEPLOY_KEY || env.VERCEL);
}

async function main() {
  const original = readFileSync(cliPkgPath, "utf8");
  const pkg = JSON.parse(original);
  const sha = commitSha();
  const now = new Date();
  const version = buildVersion(pkg.version, sha, now);

  const problems = buildEnvProblems(process.env);
  if (problems.length > 0) {
    const msg = problems.map((p) => `[pack-cli] ${p}`).join("\n");
    if (isDeployBuild(process.env)) throw new Error(msg);
    console.warn(`${msg}\n(local build — continuing)`);
  }

  try {
    writeFileSync(cliPkgPath, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
    passthrough(npm, ["run", "build", "-w", "cli"]);
    const tmp = mkdtempSync(path.join(tmpdir(), "codex-kaboo-pack-"));
    const packed = JSON.parse(
      capture(npm, ["pack", "-w", "cli", "--json", "--pack-destination", tmp]),
    );
    const filename = packed[0].filename;
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    cpSync(path.join(tmp, filename), path.join(outDir, "codex-kaboo-cli.tgz"));
    cpSync(path.join(tmp, filename), path.join(outDir, `codex-kaboo-cli-${version}.tgz`));
    writeFileSync(
      path.join(outDir, "version.json"),
      `${JSON.stringify({ version, builtAt: now.toISOString(), commit: sha }, null, 2)}\n`,
    );
    console.log(`[pack-cli] packed ${filename} as ${version}`);
    if (process.env.CONVEX_DEPLOY_KEY) {
      passthrough(npx, ["convex", "env", "set", "LATEST_CLI_VERSION", version], webDir);
      console.log("[pack-cli] LATEST_CLI_VERSION set on the Convex deployment");
    }
  } finally {
    writeFileSync(cliPkgPath, original);
  }
}

// Only run the packer when this file is executed directly (`node scripts/pack-cli.mjs`, which is
// how both the `prebuild` script and local verification invoke it) — not when pack-cli.test.ts
// imports it for the pure helpers above, which must not trigger a real build/pack as a side effect.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}
