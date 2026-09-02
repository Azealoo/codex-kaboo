# codex-kaboo Plan 1: Foundation, `shared/` and the collector CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the npm-workspace repo (root tooling, CI, `shared/`, `cli/`, and the empty `web/` scaffold), implement the shared sync schema + metric helpers, and ship the cross-platform `codex-kaboo` collector CLI that turns local Codex rollout logs into metadata-only sync batches.

**Architecture:** `shared/` is a build-less TypeScript package (zod 4 schema, day math, metric helpers) consumed by the CLI through the `@codex-kaboo/shared` workspace link, by Convex through relative imports, and by the web app through the `@shared/*` alias. `cli/` is a single-file CJS bundle (tsup, no runtime dependencies) built from small pure modules: a byte-accurate JSONL reader, a pure session reducer (`reduce`/`finalize`), an upload batcher + HTTP client with retries, pure scheduler generators with an injected spawner, and thin command modules wired by commander in `main.ts`. State lives in `~/.codex-kaboo/` and is keyed by session id so file moves and compression keep progress.

**Tech Stack:** Node ≥ 20 for development (CLI runtime ≥ 18, ≥ 22.15 for `.zst`), npm workspaces, TypeScript 5.9, zod 4, commander 14, tsup 8, vitest 4, ESLint 9 flat config, Prettier 3, Next.js 16.3.4 scaffold (web), shadcn 4 (`--base radix`), convex 1.45.

**Spec:** `docs/superpowers/specs/2026-09-01-codex-kaboo-design.md` — and the binding contracts document `docs/superpowers/plans/2026-09-01-codex-kaboo-0-contracts.md` (the contracts win over the spec; read both before starting any task).

## Global Constraints

- Pinned versions (spec): next 16.3.4, react 19.2.x, @clerk/nextjs 7.8.4, convex 1.45.0, recharts 3.10.1, nuqs 2.10.1, shadcn 4.19.1, tailwindcss 4.3.x, lucide-react ^1.39, react-day-picker ^10.0.1, date-fns ^4.4, zod ^4, commander ^14, tsup ^8, vitest ^4.1.11 (never vitest 5), @testing-library/react ^16.3.3, typescript ^5.9.3 (never TypeScript 7 / `latest`).
- Node: root `engines.node ">=20"`; CLI `engines.node ">=18"`; `.zst` support only when `zlib.createZstdDecompress` exists (Node ≥ 22.15), otherwise the file is skipped with a one-time warning.
- Imports of `shared/` (contracts §1): CLI → `@codex-kaboo/shared` / `@codex-kaboo/shared/<module>`; `web/convex/**` → relative `../../shared/src/<module>`; `web/src/**` → `@shared/<module>`.
- `shared/src/constants.ts` and `shared/src/sync.ts` are implemented **verbatim** from contracts §2–§3; `days.ts`/`metrics.ts` follow contracts §4–§5 signatures exactly.
- Privacy rule (spec, hard): the CLI uploads only token counts, model names, efforts, tool kinds, skill names, project = basename(cwd), git branch, timestamps/durations, line counts, Codex/CLI versions, platform/arch, the user-chosen machine label, and the hostname only with `login --hostname`. Never prompt/response text, command strings, file paths, diff contents, repository URLs. The parser copies named fields into typed records (allow-list) and never forwards whole objects. Test fixtures are synthetic/redacted; grep them before committing.
- Never read `~/.codex/auth.json`. Never print real log text or paths in test output or commit messages.
- The CLI bundle has an empty `dependencies` map: `commander`, `zod`, `@codex-kaboo/shared` are devDependencies bundled by tsup (`noExternal: [/.*/]`).
- Summary hash (contracts §6): `sha1(JSON.stringify(canonical(summary minus summaryHash/inProgress/lineCount/generation)))`, keys sorted recursively, `undefined` dropped.
- HTTP protocol (contracts §7): `POST /api/v1/sync`, `GET /api/v1/whoami`, `GET /api/v1/health`; headers `Authorization: Bearer ck_…`, `Content-Type: application/json`, `X-Codex-Kaboo-Cli: <cliVersion>`; error codes `unauthorized|token_revoked|payload_too_large|too_many_items|invalid_json|invalid_batch|machine_conflict|internal`.
- Timestamps in payloads are Unix milliseconds; `task_started.started_at`, `task_complete.completed_at`, `rate_limits.primary.resets_at` in the logs are Unix **seconds**; `duration_ms`/`time_to_first_token_ms` are ms and may be `null`.
- Test commands (contracts §1): `npm run test -w shared`, `npm run test -w cli`, `npm run test -w web -- --project convex|unit|dom`, `npm run typecheck`, `npm run lint`.
- Every commit ends with the two trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt`. Commit messages are imperative ("Add …", "Implement …").
- Exit codes of the CLI: `0` success (also "not logged in" under `--scheduled`), `1` partial failure (some files failed, network failure after retries, bad request), `2` auth/config error (401/403, missing token/server).

## File map (what this plan creates)

```
package.json, package-lock.json, tsconfig.base.json, .prettierrc, .prettierignore, eslint.config.mjs
.github/workflows/ci.yml
shared/package.json, shared/tsconfig.json, shared/vitest.config.ts
shared/src/{index,constants,days,sync,metrics}.ts + *.test.ts
web/ (create-next-app scaffold + shadcn init + vitest.config.ts + vitest.setup.ts + convex/tsconfig.json + 3 bootstrap tests)
cli/package.json, cli/tsconfig.json, cli/tsup.config.ts, cli/vitest.config.mts
cli/src/main.ts                 commander wiring, exit codes
cli/src/build-info.ts           build-time constants (version, baked server / web origin)
cli/src/types.ts                Config, FileState, SyncState, shared CLI types
cli/src/util/{hash,version,names,log,lock,spawn}.ts
cli/src/core/{paths,config,state,jsonl-reader,discover,parse-file}.ts
cli/src/parser/{diff,classify,time,session}.ts
cli/src/upload/{batch,client}.ts
cli/src/schedule/{index,launchd,cron,systemd,schtasks}.ts
cli/src/commands/{sync,login,logout,install,uninstall,status,doctor}.ts
cli/test/**                     mirrors src; cli/test/fixtures/codex-home/** redacted + synthetic rollouts
cli/scripts/make-fixture.mjs    redaction script (real log → synthetic fixture)
cli/scripts/check-dry-run.mjs   privacy + totals check for the real-data smoke test
README.md                       CLI section (install, commands, per-OS notes)
```

---

### Task 1: Root workspace, tooling, CI, and the `shared/` + `cli/` skeletons

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.prettierrc`, `.prettierignore`, `eslint.config.mjs`, `.github/workflows/ci.yml`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`, `shared/src/index.ts`
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/tsup.config.ts`, `cli/vitest.config.mts`, `cli/src/main.ts`, `cli/src/build-info.ts`, `cli/test/build-info.test.ts`
- Modify: `.gitignore` (append `cli/test/fixtures/**/*.tmp`)

**Interfaces:**
- Consumes: nothing.
- Produces: the workspace layout every later task assumes; `CLI_VERSION`, `BAKED_SERVER`, `BAKED_WEB_ORIGIN` from `cli/src/build-info.ts`; tsup `define` names `__CLI_VERSION__`, `__CLI_SERVER__`, `__CLI_WEB_ORIGIN__`.

- [ ] **Step 1: Write the root `package.json`** (workspaces list gets `web` in Task 5)

```json
{
  "name": "codex-kaboo",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=20" },
  "workspaces": ["shared", "cli"],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "@types/node": "^24.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`, `.prettierrc`, `.prettierignore`, `eslint.config.mjs`**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "noEmit": true
  }
}
```

`.prettierrc`:

```json
{ "printWidth": 100, "singleQuote": false, "trailingComma": "all" }
```

`.prettierignore`:

```
node_modules
dist
.next
web/public/cli
cli/test/fixtures
package-lock.json
docs
```

`eslint.config.mjs` (root; workspaces point at it with `--config`):

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "web/**",
      "**/coverage/**",
      "cli/test/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: { console: "readonly", process: "readonly", URL: "readonly", Buffer: "readonly" },
    },
  },
);
```

- [ ] **Step 3: Write the `shared/` skeleton**

`shared/package.json`:

```json
{
  "name": "@codex-kaboo/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./*": "./src/*.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint --config ../eslint.config.mjs src",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^4.1.0" },
  "devDependencies": { "typescript": "^5.9.3", "vitest": "^4.1.11" }
}
```

`shared/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022"], "types": [] },
  "include": ["src", "vitest.config.ts"]
}
```

`shared/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node", passWithNoTests: true },
});
```

`shared/src/index.ts` (filled in Tasks 2–4):

```ts
export {};
```

- [ ] **Step 4: Write the `cli/` skeleton**

`cli/package.json`:

```json
{
  "name": "codex-kaboo-cli",
  "version": "0.1.0",
  "description": "Collector that reports Codex CLI usage metadata to a codex-kaboo dashboard",
  "license": "MIT",
  "bin": { "codex-kaboo": "dist/codex-kaboo.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint --config ../eslint.config.mjs src test scripts",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "@codex-kaboo/shared": "*",
    "@types/node": "^24.0.0",
    "commander": "^14.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.11",
    "zod": "^4.1.0"
  }
}
```

`cli/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022"], "types": ["node"] },
  "include": ["src", "test", "scripts", "tsup.config.ts", "vitest.config.ts"]
}
```

`cli/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  entry: { "codex-kaboo": "src/main.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node18",
  outDir: "dist",
  clean: true,
  minify: false,
  sourcemap: false,
  splitting: false,
  noExternal: [/.*/],
  outExtension: () => ({ js: ".js" }),
  define: {
    __CLI_VERSION__: JSON.stringify(process.env.CODEX_KABOO_CLI_VERSION ?? pkg.version),
    __CLI_SERVER__: JSON.stringify(process.env.CODEX_KABOO_SERVER ?? ""),
    __CLI_WEB_ORIGIN__: JSON.stringify(process.env.CODEX_KABOO_WEB_ORIGIN ?? ""),
  },
});
```

`cli/vitest.config.mts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node", passWithNoTests: true, testTimeout: 20000 },
});
```

`cli/src/build-info.ts`:

```ts
declare const __CLI_VERSION__: string | undefined;
declare const __CLI_SERVER__: string | undefined;
declare const __CLI_WEB_ORIGIN__: string | undefined;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Version stamped by tsup (`CODEX_KABOO_CLI_VERSION` or package.json); "0.0.0-dev" under vitest. */
export const CLI_VERSION: string =
  typeof __CLI_VERSION__ === "string" && __CLI_VERSION__.length > 0 ? __CLI_VERSION__ : "0.0.0-dev";
/** Server origin baked at build time from CODEX_KABOO_SERVER, e.g. https://xxx.convex.site */
export const BAKED_SERVER: string | undefined =
  typeof __CLI_SERVER__ === "string" ? nonEmpty(__CLI_SERVER__) : undefined;
/** Dashboard origin baked at build time from CODEX_KABOO_WEB_ORIGIN (for the upgrade hint). */
export const BAKED_WEB_ORIGIN: string | undefined =
  typeof __CLI_WEB_ORIGIN__ === "string" ? nonEmpty(__CLI_WEB_ORIGIN__) : undefined;
```

`cli/src/main.ts` (minimal; replaced in Task 25):

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { CLI_VERSION } from "./build-info";

const program = new Command();
program
  .name("codex-kaboo")
  .description("Report Codex CLI usage metadata to your codex-kaboo dashboard")
  .version(CLI_VERSION);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 5: Write the failing test for `build-info`**

`cli/test/build-info.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BAKED_SERVER, BAKED_WEB_ORIGIN, CLI_VERSION } from "../src/build-info";

describe("build-info", () => {
  it("falls back to a dev version when no build-time define exists", () => {
    expect(CLI_VERSION).toBe("0.0.0-dev");
  });
  it("has no baked server or web origin outside a tsup build", () => {
    expect(BAKED_SERVER).toBeUndefined();
    expect(BAKED_WEB_ORIGIN).toBeUndefined();
  });
});
```

- [ ] **Step 6: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build -w cli
      - run: node cli/dist/codex-kaboo.js --version
```

- [ ] **Step 7: Install and run everything**

Run (repo root):

```bash
npm install
npm run typecheck && npm run lint && npm test
npm run build -w cli && node cli/dist/codex-kaboo.js --version
```

Expected: install succeeds and creates `package-lock.json`; typecheck/lint pass; vitest reports `1 passed` for cli (`build-info.test.ts`) and "No test files found" (exit 0, `passWithNoTests`) for shared; the build prints `dist/codex-kaboo.js` and the last command prints `0.1.0`.

- [ ] **Step 8: Append to `.gitignore` and commit**

```bash
printf '%s\n' 'cli/test/fixtures/**/*.tmp' >> .gitignore
git add -A
git commit -F - <<'MSG'
Add npm workspace, tooling, CI and shared/cli skeletons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 2: `shared/src/constants.ts` and `shared/src/days.ts`

**Files:**
- Create: `shared/src/constants.ts` (verbatim from contracts §2), `shared/src/days.ts`, `shared/src/days.test.ts`, `shared/src/constants.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every constant in contracts §2; `isValidDay(day)`, `dayToUtcMs(day)`, `utcMsToDay(ms)`, `addDays(day, n)`, `daysBetween(from, to)`, `eachDay(from, to)`, `compareDays(a, b)`, `previousPeriod(from, to)`, `weekdayOf(day)` (0 = Monday), `weekStart(day)`, `monthStart(day)`, `type Bucket`, `bucketStart(day, bucket)`, `eachBucket(from, to, bucket)`, `bucketFor(days)`, `dayHourIn(tsMs, timeZone)`.

- [ ] **Step 1: Write the failing tests**

`shared/src/constants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TOOL_KINDS, TTFT_BUCKETS_MS, TTFT_BUCKET_COUNT, SCHEMA_VERSION } from "./constants";

describe("constants", () => {
  it("has 16 TTFT buckets ending in +Infinity", () => {
    expect(TTFT_BUCKETS_MS).toHaveLength(TTFT_BUCKET_COUNT);
    expect(TTFT_BUCKETS_MS[15]).toBe(Number.POSITIVE_INFINITY);
    expect(TTFT_BUCKETS_MS[0]).toBe(250);
  });
  it("lists the nine fixed tool kinds", () => {
    expect(TOOL_KINDS).toEqual([
      "commandRead", "commandList", "commandSearch", "commandOther", "fileChange",
      "webSearch", "imageView", "mcpTool", "other",
    ]);
    expect(SCHEMA_VERSION).toBe(1);
  });
});
```

`shared/src/days.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addDays, bucketFor, bucketStart, compareDays, dayHourIn, daysBetween, dayToUtcMs, eachBucket,
  eachDay, isValidDay, monthStart, previousPeriod, utcMsToDay, weekStart, weekdayOf,
} from "./days";

describe("isValidDay", () => {
  it("accepts real calendar days and rejects the rest", () => {
    expect(isValidDay("2024-02-29")).toBe(true);
    expect(isValidDay("2023-02-29")).toBe(false);
    expect(isValidDay("2026-13-01")).toBe(false);
    expect(isValidDay("2026-04-31")).toBe(false);
    expect(isValidDay("1999-12-31")).toBe(false);
    expect(isValidDay("2100-01-01")).toBe(false);
    expect(isValidDay("2026-9-1")).toBe(false);
    expect(isValidDay("garbage")).toBe(false);
  });
});

describe("day arithmetic", () => {
  it("converts to and from UTC ms", () => {
    expect(dayToUtcMs("2026-09-01")).toBe(Date.UTC(2026, 8, 1));
    expect(utcMsToDay(Date.UTC(2026, 8, 1, 23, 59))).toBe("2026-09-01");
  });
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("counts inclusive days and returns 0 for inverted ranges", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(31);
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-02", "2026-01-01")).toBe(0);
    expect(eachDay("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(eachDay("2026-01-02", "2026-01-01")).toEqual([]);
  });
  it("compares lexically", () => {
    expect(compareDays("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compareDays("2026-01-02", "2026-01-02")).toBe(0);
    expect(compareDays("2026-01-03", "2026-01-02")).toBe(1);
  });
});

describe("previousPeriod", () => {
  it("returns the same-length period immediately before", () => {
    expect(previousPeriod("2026-03-01", "2026-03-30")).toEqual({ from: "2026-01-30", to: "2026-02-28" });
    expect(previousPeriod("2024-03-01", "2024-03-01")).toEqual({ from: "2024-02-29", to: "2024-02-29" });
    expect(previousPeriod("2026-01-01", "2026-01-07")).toEqual({ from: "2025-12-25", to: "2025-12-31" });
  });
});

describe("buckets", () => {
  it("knows weekdays with Monday = 0", () => {
    expect(weekdayOf("2026-09-01")).toBe(1); // Tuesday
    expect(weekdayOf("2026-08-30")).toBe(6); // Sunday
    expect(weekStart("2026-09-01")).toBe("2026-08-31");
    expect(weekStart("2026-08-31")).toBe("2026-08-31");
    expect(monthStart("2026-09-17")).toBe("2026-09-01");
  });
  it("enumerates bucket starts covering the range", () => {
    expect(bucketStart("2026-09-01", "day")).toBe("2026-09-01");
    expect(eachBucket("2026-08-30", "2026-09-02", "week")).toEqual(["2026-08-24", "2026-08-31"]);
    expect(eachBucket("2025-12-15", "2026-02-03", "month")).toEqual(["2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(eachBucket("2026-01-30", "2026-02-01", "day")).toEqual(["2026-01-30", "2026-01-31", "2026-02-01"]);
  });
  it("picks the granularity from the span", () => {
    expect(bucketFor(1)).toBe("day");
    expect(bucketFor(120)).toBe("day");
    expect(bucketFor(121)).toBe("week");
    expect(bucketFor(730)).toBe("week");
    expect(bucketFor(731)).toBe("month");
  });
});

describe("dayHourIn", () => {
  it("formats in the given zone with h23 hours", () => {
    expect(dayHourIn(Date.UTC(2026, 0, 1, 0, 0, 0), "UTC")).toEqual({ day: "2026-01-01", hour: 0 });
    expect(dayHourIn(Date.UTC(2026, 0, 1, 0, 0, 0), "Asia/Tokyo")).toEqual({ day: "2026-01-01", hour: 9 });
    expect(dayHourIn(Date.UTC(2026, 0, 1, 7, 59, 59), "America/Los_Angeles")).toEqual({ day: "2025-12-31", hour: 23 });
    expect(dayHourIn(Date.UTC(2026, 0, 1, 8, 0, 0), "America/Los_Angeles")).toEqual({ day: "2026-01-01", hour: 0 });
  });
  it("handles the DST switch (2026-03-08 in Los Angeles)", () => {
    expect(dayHourIn(Date.UTC(2026, 2, 8, 9, 30, 0), "America/Los_Angeles")).toEqual({ day: "2026-03-08", hour: 1 });
    expect(dayHourIn(Date.UTC(2026, 2, 8, 10, 30, 0), "America/Los_Angeles")).toEqual({ day: "2026-03-08", hour: 3 });
  });
  it("falls back instead of throwing for an invalid or missing zone", () => {
    const a = dayHourIn(Date.UTC(2026, 5, 15, 12, 0, 0), "Mars/Olympus");
    const b = dayHourIn(Date.UTC(2026, 5, 15, 12, 0, 0), undefined);
    for (const r of [a, b]) {
      expect(r.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.hour).toBeGreaterThanOrEqual(0);
      expect(r.hour).toBeLessThanOrEqual(23);
    }
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w shared`
Expected: FAIL — `Cannot find module './constants'` / `'./days'`.

- [ ] **Step 3: Write `shared/src/constants.ts`** — copy contracts §2 verbatim (the block that starts with `export const SCHEMA_VERSION = 1 as const;` and ends with `export const CLI_VERSION_HEADER = "X-Codex-Kaboo-Cli";`). Do not rename, reorder or add anything.

- [ ] **Step 4: Write `shared/src/days.ts`**

```ts
export type Bucket = "day" | "week" | "month";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** True for a real calendar date between 2000-01-01 and 2099-12-31 in YYYY-MM-DD form. */
export function isValidDay(day: string): boolean {
  const m = DAY_RE.exec(day);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function dayToUtcMs(day: string): number {
  const m = DAY_RE.exec(day);
  if (!m) throw new RangeError(`invalid day: ${day}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function utcMsToDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(day: string, n: number): string {
  return utcMsToDay(dayToUtcMs(day) + n * MS_PER_DAY);
}

/** Inclusive day count; 0 when `from` is after `to`. */
export function daysBetween(from: string, to: string): number {
  const diff = Math.round((dayToUtcMs(to) - dayToUtcMs(from)) / MS_PER_DAY);
  return diff < 0 ? 0 : diff + 1;
}

export function eachDay(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

export function compareDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const n = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(n - 1)), to: prevTo };
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(day: string): number {
  return (new Date(dayToUtcMs(day)).getUTCDay() + 6) % 7;
}

export function weekStart(day: string): string {
  return addDays(day, -weekdayOf(day));
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function bucketStart(day: string, bucket: Bucket): string {
  switch (bucket) {
    case "day":
      return day;
    case "week":
      return weekStart(day);
    case "month":
      return monthStart(day);
  }
}

function nextBucketStart(start: string, bucket: Bucket): string {
  if (bucket === "day") return addDays(start, 1);
  if (bucket === "week") return addDays(start, 7);
  const d = new Date(dayToUtcMs(start));
  return utcMsToDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** Ascending bucket starts covering [from, to]; the first is bucketStart(from). */
export function eachBucket(from: string, to: string, bucket: Bucket): string[] {
  const out: string[] = [];
  let cur = bucketStart(from, bucket);
  while (compareDays(cur, to) <= 0) {
    out.push(cur);
    cur = nextBucketStart(cur, bucket);
  }
  return out;
}

export function bucketFor(days: number): Bucket {
  return days <= 120 ? "day" : days <= 730 ? "week" : "month";
}

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone });
  } catch {
    try {
      return new Intl.DateTimeFormat("en-CA", options); // machine zone
    } catch {
      return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" });
    }
  }
}

/** Local calendar day and hour of `tsMs` in `timeZone`; invalid/missing zone → machine zone → UTC. */
export function dayHourIn(tsMs: number, timeZone: string | undefined): { day: string; hour: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(tsMs));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hourRaw = Number(get("hour"));
  const hour = !Number.isFinite(hourRaw) || hourRaw === 24 ? 0 : hourRaw;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour };
}
```

- [ ] **Step 5: Export from `shared/src/index.ts`**

```ts
export * from "./constants";
export * from "./days";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w shared`
Expected: PASS — 2 files, all tests green. Then `npm run typecheck -w shared && npm run lint -w shared` → no errors.

- [ ] **Step 7: Commit**

```bash
git add shared/src
git commit -F - <<'MSG'
Add shared constants and day math helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 3: `shared/src/sync.ts` — the sync payload schema

**Files:**
- Create: `shared/src/sync.ts` (verbatim from contracts §3), `shared/src/sync.test.ts`, `shared/src/test-fixtures.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `isValidDay` from `./days`, constants from `./constants`.
- Produces: zod schemas + types `TokenCounts/Tokens`, `ToolCounts`, `KeyCount`, `Ttft`, `SessionSummary`, `TokenEvent`, `RateLimitSnapshot`, `MachineInfo`, `SyncBatch`, `UpsertCounts`, `SyncLimits`, `SyncResponse`, `ErrorCode`, `ErrorResponse`, `WhoamiResponse`; test builders `makeSummary(overrides?)`, `makeEvent(overrides?)`, `makeBatch(overrides?)` in `shared/src/test-fixtures.ts` (also used by Plans 2 and 3).

- [ ] **Step 1: Write the test builders**

`shared/src/test-fixtures.ts`:

```ts
import type { MachineInfo, SessionSummary, SyncBatch, TokenEvent } from "./sync";

const T0 = Date.UTC(2026, 7, 30, 17, 0, 0); // 2026-08-30T17:00:00Z

export function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "0199a1b2-0000-7000-8000-000000000001",
    threadId: "0199a1b2-0000-7000-8000-000000000001",
    startedAt: T0,
    endedAt: T0 + 600_000,
    wallMs: 600_000,
    day: "2026-08-30",
    timezone: "America/Los_Angeles",
    project: "project-a",
    gitBranch: "main",
    originator: "codex-tui",
    source: "cli",
    isSubagent: false,
    model: "gpt-5.6-sol",
    effort: "xhigh",
    cliVersion: "0.150.1",
    turns: 2,
    completedTurns: 2,
    userMessages: 2,
    agentMessages: 3,
    reasoningItems: 5,
    toolCounts: {
      commandRead: 3, commandList: 1, commandSearch: 1, commandOther: 2, fileChange: 1,
      webSearch: 1, imageView: 0, mcpTool: 0, other: 0,
    },
    mcpTools: [],
    skills: [{ key: "openai-docs", count: 1 }],
    linesAdded: 12,
    linesRemoved: 3,
    filesChanged: 1,
    compactions: 0,
    activeMs: 120_000,
    ttft: { count: 2, sumMs: 3000, hist: [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    tokens: { input: 100_000, cachedInput: 80_000, cacheWrite: 0, output: 2_000, reasoning: 800, total: 102_000 },
    responses: 4,
    inProgress: false,
    lineCount: 40,
    generation: 0,
    parseErrors: 0,
    parserVersion: 1,
    summaryHash: "0123456789abcdef0123456789abcdef01234567",
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<TokenEvent> = {}): TokenEvent {
  return {
    sessionId: "0199a1b2-0000-7000-8000-000000000001",
    seq: 10,
    ts: T0 + 5_000,
    day: "2026-08-30",
    hour: 10,
    model: "gpt-5.6-sol",
    effort: "xhigh",
    turnId: "turn-1",
    project: "project-a",
    isSubagent: false,
    input: 25_000,
    cachedInput: 20_000,
    cacheWrite: 0,
    output: 500,
    reasoning: 200,
    total: 25_500,
    contextWindow: 272_000,
    ...overrides,
  };
}

export function makeMachine(overrides: Partial<MachineInfo> = {}): MachineInfo {
  return {
    machineId: "4d2f7d0e-2d5c-4c0d-9a9c-8e3f0c9b1a11",
    label: "brisk-otter",
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "24.17.0",
    codexVersion: "0.150.1",
    codexLatestVersion: "0.150.1",
    hostname: null,
    tz: "America/Los_Angeles",
    ...overrides,
  };
}

export function makeBatch(overrides: Partial<SyncBatch> = {}): SyncBatch {
  return {
    schemaVersion: 1,
    parserVersion: 1,
    cliVersion: "0.1.0",
    batchId: "7a0b1c2d-1111-4222-8333-444455556666",
    sentAt: T0 + 900_000,
    machine: makeMachine(),
    sessions: [makeSummary()],
    tokenEvents: [makeEvent()],
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests**

`shared/src/sync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ErrorResponse, SessionSummary, SyncBatch, SyncResponse, TokenEvent, WhoamiResponse } from "./sync";
import { makeBatch, makeEvent, makeSummary } from "./test-fixtures";

describe("SyncBatch", () => {
  it("parses a valid batch and strips unknown keys", () => {
    const raw = { ...makeBatch(), extra: "nope", machine: { ...makeBatch().machine, secret: "x" } };
    const result = SyncBatch.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as Record<string, unknown>).extra).toBeUndefined();
    expect((result.data.machine as Record<string, unknown>).secret).toBeUndefined();
    expect(result.data.machine.hostname).toBeNull();
  });
  it("rejects a wrong schema version", () => {
    expect(SyncBatch.safeParse({ ...makeBatch(), schemaVersion: 2 }).success).toBe(false);
  });
  it("rejects more than 5000 events", () => {
    const events = Array.from({ length: 5001 }, (_, i) => makeEvent({ seq: i }));
    expect(SyncBatch.safeParse(makeBatch({ tokenEvents: events })).success).toBe(false);
    expect(SyncBatch.safeParse(makeBatch({ tokenEvents: events.slice(0, 5000) })).success).toBe(true);
  });
  it("accepts an optional rate limit snapshot", () => {
    const batch = makeBatch({
      rateLimit: { observedAt: Date.UTC(2026, 7, 30), usedPercent: 12.5, windowMinutes: 10080, resetsAt: Date.UTC(2026, 8, 5), planType: "pro", limitId: "weekly" },
    });
    expect(SyncBatch.safeParse(batch).success).toBe(true);
  });
});

describe("SessionSummary", () => {
  it("rejects invalid days, short histograms and bad hashes", () => {
    expect(SessionSummary.safeParse(makeSummary({ day: "2026-02-30" })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ ttft: { count: 0, sumMs: 0, hist: new Array(15).fill(0) } })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ summaryHash: "ABCDEF" })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ tokens: { input: -1, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 } })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ startedAt: Date.UTC(2019, 0, 1) })).success).toBe(false);
  });
  it("caps keyed arrays at 64 entries", () => {
    const skills = Array.from({ length: 65 }, (_, i) => ({ key: `s${i}`, count: 1 }));
    expect(SessionSummary.safeParse(makeSummary({ skills })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ skills: skills.slice(0, 64) })).success).toBe(true);
  });
});

describe("TokenEvent", () => {
  it("validates hour and integer counts", () => {
    expect(TokenEvent.safeParse(makeEvent({ hour: 24 })).success).toBe(false);
    expect(TokenEvent.safeParse(makeEvent({ input: 1.5 })).success).toBe(false);
    expect(TokenEvent.safeParse(makeEvent({ effort: undefined, turnId: undefined, contextWindow: undefined })).success).toBe(true);
  });
});

describe("responses", () => {
  it("parses success, error and whoami bodies", () => {
    expect(SyncResponse.safeParse({
      ok: true,
      accepted: { sessions: { inserted: 1, updated: 0, unchanged: 0 }, events: { inserted: 3, updated: 0, unchanged: 0 } },
      conflicts: { sessions: [], events: 0 },
      serverTime: 1,
      latestCliVersion: null,
      limits: { maxBodyBytes: 8388608, maxSessions: 500, maxEvents: 5000 },
    }).success).toBe(true);
    expect(ErrorResponse.safeParse({ ok: false, error: "unauthorized" }).success).toBe(true);
    expect(ErrorResponse.safeParse({ ok: false, error: "brand_new_code", message: "x" }).success).toBe(true);
    expect(WhoamiResponse.safeParse({ ok: true, userId: "u1", name: null, email: "a@b.c", token: { name: "mac", prefix: "ck_3f9a1c" }, serverTime: 1 }).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -w shared`
Expected: FAIL — `Cannot find module './sync'`.

- [ ] **Step 4: Write `shared/src/sync.ts`** — copy contracts §3 verbatim (from `import { z } from "zod";` through `export type WhoamiResponse = z.infer<typeof WhoamiResponse>;`). Then add the exports to `shared/src/index.ts`:

```ts
export * from "./constants";
export * from "./days";
export * from "./sync";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w shared && npm run typecheck -w shared && npm run lint -w shared`
Expected: PASS (3 test files). If typecheck complains that `count` shadows the `count` key inside `z.object({ count, … })`, keep the contracts text as is — `{ count }` shorthand referencing the exported `count` schema is intended and valid.

- [ ] **Step 6: Commit**

```bash
git add shared/src
git commit -F - <<'MSG'
Add shared sync payload schema and test fixture builders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 4: `shared/src/metrics.ts`

**Files:**
- Create: `shared/src/metrics.ts`, `shared/src/metrics.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `TTFT_BUCKETS_MS`, `TTFT_BUCKET_COUNT` from `./constants`; types from `./sync`.
- Produces (contracts §5): `ModelPrice`, `CostBreakdown`, `costOf(tokens, price)`, `cacheSavings(tokens, price)`, `ratio(n, d)`, `cacheHitRate(tokens)`, `percentChange(current, previous)`, `emptyTokens()`, `addTokens(a, b)`, `emptyToolCounts()`, `addToolCounts(a, b)`, `emptyTtft()`, `addTtft(a, b)`, `ttftBucketIndex(ms)`, `ttftMean(t)`, `ttftMedianApprox(t)`, `mergeKeyCounts(lists, cap, otherKey)`, `sortByKey(items)`.

- [ ] **Step 1: Write the failing tests**

`shared/src/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addTokens, addTtft, cacheHitRate, cacheSavings, costOf, emptyTokens, emptyTtft, mergeKeyCounts,
  percentChange, ratio, sortByKey, ttftBucketIndex, ttftMean, ttftMedianApprox,
} from "./metrics";
import type { Ttft } from "./sync";

const price = { inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 10 };
const tokens = { input: 1_000_000, cachedInput: 600_000, cacheWrite: 0, output: 100_000, reasoning: 40_000, total: 1_100_000 };

describe("cost", () => {
  it("prices uncached input, cached input and output (reasoning split at the output price)", () => {
    const c = costOf(tokens, price);
    expect(c.input).toBeCloseTo(0.8, 10); // 400k × $2/M
    expect(c.cached).toBeCloseTo(0.12, 10); // 600k × $0.2/M
    expect(c.output).toBeCloseTo(0.6, 10); // 60k × $10/M
    expect(c.reasoning).toBeCloseTo(0.4, 10); // 40k × $10/M
    expect(c.total).toBeCloseTo(1.92, 10);
  });
  it("computes cache savings versus paying full input price", () => {
    expect(cacheSavings(tokens, price)).toBeCloseTo(0.6 * 1.8, 10);
  });
  it("never goes negative with inconsistent counts", () => {
    const c = costOf({ input: 10, cachedInput: 20, cacheWrite: 0, output: 5, reasoning: 9, total: 15 }, price);
    expect(c.input).toBe(0);
    expect(c.output).toBe(0);
    expect(c.reasoning).toBeCloseTo(5e-5, 12);
  });
});

describe("rates", () => {
  it("returns null for zero denominators", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(2, 4)).toBe(0.5);
    expect(cacheHitRate(tokens)).toBeCloseTo(0.6, 10);
    expect(cacheHitRate(emptyTokens())).toBeNull();
  });
  it("percentChange is null when previous is null or 0", () => {
    expect(percentChange(10, null)).toBeNull();
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(125, 100)).toBeCloseTo(0.25, 10);
    expect(percentChange(50, 100)).toBeCloseTo(-0.5, 10);
  });
});

describe("sums", () => {
  it("adds tokens and ttft field-wise", () => {
    const a = addTokens(tokens, tokens);
    expect(a.input).toBe(2_000_000);
    expect(a.total).toBe(2_200_000);
    const h1: Ttft = { count: 1, sumMs: 300, hist: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    const h2: Ttft = { count: 2, sumMs: 5000, hist: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] };
    const s = addTtft(h1, h2);
    expect(s).toEqual({ count: 3, sumMs: 5300, hist: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] });
    expect(emptyTtft().hist).toHaveLength(16);
  });
});

describe("ttft histogram", () => {
  it("buckets by upper bound", () => {
    expect(ttftBucketIndex(0)).toBe(0);
    expect(ttftBucketIndex(250)).toBe(0);
    expect(ttftBucketIndex(251)).toBe(1);
    expect(ttftBucketIndex(60000)).toBe(14);
    expect(ttftBucketIndex(60001)).toBe(15);
    expect(ttftBucketIndex(10_000_000)).toBe(15);
  });
  it("interpolates the median inside the bucket holding the count/2-th sample", () => {
    const four: Ttft = { count: 4, sumMs: 1500, hist: [0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect(ttftMedianApprox(four)).toBeCloseTo(375, 6); // bucket (250, 500], halfway
    const one: Ttft = { count: 1, sumMs: 900, hist: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect(ttftMedianApprox(one)).toBeCloseTo(875, 6); // (750, 1000], halfway
    const last: Ttft = { count: 1, sumMs: 90000, hist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] };
    expect(ttftMedianApprox(last)).toBeCloseTo(90000, 6); // (60000, 120000]
    const split: Ttft = { count: 4, sumMs: 0, hist: [2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect(ttftMedianApprox(split)).toBeCloseTo(250, 6);
    expect(ttftMedianApprox(emptyTtft())).toBeNull();
    expect(ttftMean(four)).toBe(375);
    expect(ttftMean(emptyTtft())).toBeNull();
  });
});

describe("keyed arrays", () => {
  it("merges, caps and folds into (other), sorted by key", () => {
    const merged = mergeKeyCounts(
      [[{ key: "b", count: 5 }, { key: "a", count: 1 }], [{ key: "c", count: 7 }, { key: "a", count: 4 }]],
      100,
      "(other)",
    );
    expect(merged).toEqual([{ key: "a", count: 5 }, { key: "b", count: 5 }, { key: "c", count: 7 }]);
    const capped = mergeKeyCounts([[{ key: "b", count: 5 }, { key: "a", count: 1 }, { key: "c", count: 7 }]], 2, "(other)");
    expect(capped).toEqual([{ key: "(other)", count: 6 }, { key: "c", count: 7 }]);
    expect(mergeKeyCounts([], 10, "(other)")).toEqual([]);
    expect(sortByKey([{ key: "z" }, { key: "m" }, { key: "a" }]).map((x) => x.key)).toEqual(["a", "m", "z"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w shared`
Expected: FAIL — `Cannot find module './metrics'`.

- [ ] **Step 3: Write `shared/src/metrics.ts`**

```ts
import { TTFT_BUCKETS_MS, TTFT_BUCKET_COUNT } from "./constants";
import type { KeyCount, Tokens, ToolCounts, Ttft } from "./sync";

export interface ModelPrice {
  inputUsdPerMTok: number;
  cachedInputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export interface CostBreakdown {
  total: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

export function costOf(tokens: Tokens, price: ModelPrice): CostBreakdown {
  const uncachedInput = Math.max(0, tokens.input - tokens.cachedInput);
  const reasoningTokens = Math.min(tokens.reasoning, tokens.output);
  const plainOutput = Math.max(0, tokens.output - reasoningTokens);
  const input = (uncachedInput / 1e6) * price.inputUsdPerMTok;
  const cached = (tokens.cachedInput / 1e6) * price.cachedInputUsdPerMTok;
  const output = (plainOutput / 1e6) * price.outputUsdPerMTok;
  const reasoning = (reasoningTokens / 1e6) * price.outputUsdPerMTok;
  return { total: input + cached + output + reasoning, input, cached, output, reasoning };
}

export function cacheSavings(tokens: Tokens, price: ModelPrice): number {
  return (tokens.cachedInput / 1e6) * (price.inputUsdPerMTok - price.cachedInputUsdPerMTok);
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function cacheHitRate(tokens: Tokens): number | null {
  return ratio(tokens.cachedInput, tokens.input);
}

export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

export function emptyTokens(): Tokens {
  return { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };
}

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    total: a.total + b.total,
  };
}

export function emptyToolCounts(): ToolCounts {
  return {
    commandRead: 0, commandList: 0, commandSearch: 0, commandOther: 0, fileChange: 0,
    webSearch: 0, imageView: 0, mcpTool: 0, other: 0,
  };
}

export function addToolCounts(a: ToolCounts, b: ToolCounts): ToolCounts {
  return {
    commandRead: a.commandRead + b.commandRead,
    commandList: a.commandList + b.commandList,
    commandSearch: a.commandSearch + b.commandSearch,
    commandOther: a.commandOther + b.commandOther,
    fileChange: a.fileChange + b.fileChange,
    webSearch: a.webSearch + b.webSearch,
    imageView: a.imageView + b.imageView,
    mcpTool: a.mcpTool + b.mcpTool,
    other: a.other + b.other,
  };
}

export function emptyTtft(): Ttft {
  return { count: 0, sumMs: 0, hist: new Array<number>(TTFT_BUCKET_COUNT).fill(0) };
}

export function addTtft(a: Ttft, b: Ttft): Ttft {
  const hist = new Array<number>(TTFT_BUCKET_COUNT).fill(0);
  for (let i = 0; i < TTFT_BUCKET_COUNT; i++) hist[i] = (a.hist[i] ?? 0) + (b.hist[i] ?? 0);
  return { count: a.count + b.count, sumMs: a.sumMs + b.sumMs, hist };
}

/** Index of the first bucket whose upper bound is ≥ ms (last bucket is open-ended). */
export function ttftBucketIndex(ms: number): number {
  for (let i = 0; i < TTFT_BUCKET_COUNT; i++) {
    if (ms <= (TTFT_BUCKETS_MS[i] ?? Number.POSITIVE_INFINITY)) return i;
  }
  return TTFT_BUCKET_COUNT - 1;
}

export function ttftMean(t: Ttft): number | null {
  return t.count > 0 ? t.sumMs / t.count : null;
}

/** Approximate median: linear interpolation inside the bucket holding the (count/2)-th sample. */
export function ttftMedianApprox(t: Ttft): number | null {
  if (t.count <= 0) return null;
  const target = t.count / 2;
  let cumulative = 0;
  for (let i = 0; i < TTFT_BUCKET_COUNT; i++) {
    const n = t.hist[i] ?? 0;
    if (n === 0) continue;
    if (cumulative + n >= target) {
      const lower = i === 0 ? 0 : (TTFT_BUCKETS_MS[i - 1] ?? 0);
      const upper = i === TTFT_BUCKET_COUNT - 1 ? 120_000 : (TTFT_BUCKETS_MS[i] ?? 0);
      const fraction = (target - cumulative) / n;
      return lower + (upper - lower) * fraction;
    }
    cumulative += n;
  }
  return null;
}

export function sortByKey<T extends { key: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Sum by key, keep the top `cap − 1` by count (ties by key), fold the rest into `otherKey`, sort by key. */
export function mergeKeyCounts(lists: KeyCount[][], cap: number, otherKey: string): KeyCount[] {
  if (cap <= 0) return [];
  const sums = new Map<string, number>();
  for (const list of lists) {
    for (const { key, count } of list) sums.set(key, (sums.get(key) ?? 0) + count);
  }
  const ranked = [...sums.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (ranked.length <= cap) return sortByKey(ranked);
  const kept = ranked.slice(0, cap - 1);
  const rest = ranked.slice(cap - 1).reduce((acc, x) => acc + x.count, 0);
  return sortByKey([...kept, { key: otherKey, count: rest }]);
}
```

Then `shared/src/index.ts`:

```ts
export * from "./constants";
export * from "./days";
export * from "./sync";
export * from "./metrics";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w shared && npm run typecheck -w shared && npm run lint -w shared`
Expected: PASS (4 test files).

- [ ] **Step 5: Commit**

```bash
git add shared/src
git commit -F - <<'MSG'
Add shared metric helpers (cost, rates, TTFT histogram, keyed merges)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 5: `web/` scaffold (Next 16 + shadcn + all dependencies + vitest projects), no app code

**Files:**
- Create (generated): `web/**` via create-next-app; `web/components.json`, `web/src/lib/utils.ts` via shadcn init; `web/convex/tsconfig.json`, `web/convex/README.md`, `web/convex/_generated/**` (git-ignored) via `convex codegen --init`
- Create: `web/vitest.config.mts`, `web/vitest.setup.ts`, `web/src/lib/alias.test.ts`, `web/convex/bootstrap.test.ts`, `web/src/components/bootstrap.test.tsx`
- Modify: `package.json` (root workspaces), `web/package.json` (scripts + deps), `web/tsconfig.json` (`@shared/*` path), `web/next.config.ts` (`turbopack.root`), `web/README.md`

**Interfaces:**
- Consumes: `shared/src/constants.ts`, `shared/src/days.ts` (alias smoke tests).
- Produces: the `web` workspace that Plans 2 and 3 fill; test projects `convex` (edge-runtime), `unit` (node), `dom` (jsdom); scripts `typecheck` (`next typegen && tsc --noEmit`), `test` (`vitest run`), `codegen`.

- [ ] **Step 1: Scaffold the Next app (non-interactive) and register the workspace**

Run (repo root):

```bash
npx create-next-app@16.3.4 web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes --disable-git --skip-install
node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
p.workspaces=["shared","cli","web"];fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");'
npm install
```

Expected: `web/` exists with `src/app/{layout.tsx,page.tsx,globals.css}`, `eslint.config.mjs`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`; `npm install` links three workspaces. Keep the generated `web/AGENTS.md` / `web/CLAUDE.md` if present (they document Next 16 patterns for later plans).

- [ ] **Step 2: Add the pinned dependencies and scripts**

```bash
npm install -w web convex@1.45.0 convex-helpers@latest @clerk/nextjs@7.8.4 recharts@3.10.1 react-is@^19.2.0 nuqs@2.10.1 lucide-react@^1.39.0 react-day-picker@^10.0.1 date-fns@^4.4.0 zod@^4.1.0
npm install -w web -D convex-test@latest @edge-runtime/vm@latest vitest@^4.1.11 jsdom@latest @vitejs/plugin-react@latest @testing-library/react@^16.3.3 @testing-library/dom@latest @testing-library/jest-dom@latest typescript@^5.9.3
node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync("web/package.json","utf8"));
p.name="web";p.private=true;
p.scripts=Object.assign({},p.scripts,{typecheck:"next typegen && tsc --noEmit",test:"vitest run",codegen:"convex codegen"});
fs.writeFileSync("web/package.json",JSON.stringify(p,null,2)+"\n");'
```

Expected: `web/package.json` lists `next` `16.3.4`, `react` `19.2.x`, the packages above, and the three new scripts alongside the generated `dev/build/start/lint`.

- [ ] **Step 3: Initialise shadcn with Radix primitives**

```bash
cd web && npx shadcn@4.19.1 init --base radix --preset nova --yes --no-monorepo --no-rtl --no-pointer --css-variables && cd ..
```

Expected: `web/components.json` with `"style"`/`"base"` reflecting radix, `web/src/lib/utils.ts` exporting `cn`, `globals.css` extended with the theme tokens. If the command still prompts, answer with the defaults (Next.js detected, CSS variables yes).

- [ ] **Step 4: Point TypeScript and Turbopack at `../shared`**

```bash
node -e '
const fs=require("fs");const t=JSON.parse(fs.readFileSync("web/tsconfig.json","utf8"));
t.compilerOptions.paths=Object.assign({},t.compilerOptions.paths,{"@/*":["./src/*"],"@shared/*":["../shared/src/*"]});
t.include=Array.from(new Set([...(t.include||[]),"convex/**/*.ts","vitest.config.ts","vitest.setup.ts"]));
fs.writeFileSync("web/tsconfig.json",JSON.stringify(t,null,2)+"\n");'
```

`web/next.config.ts` (overwrite):

```ts
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root, so `../shared/src` can be compiled by Turbopack.
  turbopack: { root: path.resolve(process.cwd(), "..") },
};

export default nextConfig;
```

- [ ] **Step 5: Write the vitest configuration with three projects**

`web/vitest.config.mts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const alias = {
  "@": path.resolve(here, "src"),
  "@shared": path.resolve(here, "../shared/src"),
};

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        resolve: { alias },
        test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"] },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
```

`web/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Generate the Convex scaffolding**

```bash
cd web && npx convex codegen --init && cd ..
ls web/convex
```

Expected: `README.md  _generated  tsconfig.json` (and `_generated` is committed, as the Convex CLI recommends). If `convex codegen` refuses to run without a configured deployment, run `npx convex dev --once` inside `web/` (this needs `npx convex login`, which Plan 2 requires anyway) and then re-run `npx convex codegen --init`.

- [ ] **Step 7: Write the three bootstrap tests**

`web/src/lib/alias.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "@shared/constants";
import { addDays } from "@shared/days";

describe("@shared alias", () => {
  it("resolves shared modules", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
```

`web/convex/bootstrap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../../shared/src/constants";

describe("convex test environment", () => {
  it("runs in edge-runtime with Web Crypto and the shared package", () => {
    expect(typeof crypto.subtle.digest).toBe("function");
    expect(SCHEMA_VERSION).toBe(1);
  });
});
```

`web/src/components/bootstrap.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

describe("dom test environment", () => {
  it("renders React with jest-dom matchers", () => {
    render(<p>hello codex-kaboo</p>);
    expect(screen.getByText("hello codex-kaboo")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run every check for the web workspace**

```bash
npm run test -w web
npm run typecheck -w web
npm run lint -w web
npm run build -w web
```

Expected: vitest prints three project labels (`convex`, `unit`, `dom`) each with 1 passed; typecheck prints the codegen line and no tsc errors; lint clean; `next build` succeeds (no Clerk/Convex code exists yet, so no env vars are needed).

- [ ] **Step 9: Replace `web/README.md` and commit**

`web/README.md`:

```markdown
# web

Next.js 16 dashboard for codex-kaboo. The Convex backend lives in `convex/`.
See `../docs/superpowers/specs/2026-09-01-codex-kaboo-design.md`.
```

```bash
git add -A
git commit -F - <<'MSG'
Scaffold the web workspace with Next 16, shadcn and vitest projects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 6: CLI types and `util/{hash,version,names}.ts`

**Files:**
- Create: `cli/src/types.ts`, `cli/src/util/hash.ts`, `cli/src/util/version.ts`, `cli/src/util/names.ts`
- Test: `cli/test/util/hash.test.ts`, `cli/test/util/version.test.ts`, `cli/test/util/names.test.ts`

**Interfaces:**
- Consumes: `SessionSummary`, `RateLimitSnapshot` types from `@codex-kaboo/shared`.
- Produces: `Config`, `FileState`, `SyncState` (types.ts); `canonicalize(value)`, `canonicalJson(value)`, `sha1Hex(text)`, `sha256Hex(text)`, `summaryHashOf(summary)`; `parseVersion(v)`, `compareVersions(a, b)`, `newestVersion(list)`, `meetsVersion(actual, required)`; `randomLabel(random?)`.

- [ ] **Step 1: Write `cli/src/types.ts`**

```ts
import type { RateLimitSnapshot } from "@codex-kaboo/shared";

/** ~/.codex-kaboo/config.json (mode 0600). */
export interface Config {
  server: string;
  token: string;
  machineId: string;
  label: string;
  hostnameOptIn: boolean;
  codexHomes: string[];
  userId?: string;
  userName?: string | null;
  userEmail?: string | null;
  tokenName?: string;
  loggedInAt?: number;
}

/** Per-rollout-file progress, keyed by sessionId in SyncState.files. */
export interface FileState {
  path: string; // local only, never uploaded
  offset: number; // bytes consumed up to and including the last '\n'
  lines: number; // complete lines consumed
  size: number;
  mtimeMs: number;
  tail: string; // base64 of the last ≤ 64 bytes before `offset`
  lastUploadedSeq: number; // -1 when no event was acknowledged yet
  summaryHash: string | null; // hash acknowledged by the server
  generation: number; // incremented on every reset
  complete: boolean; // immutable file fully processed (.zst)
  lastError: string | null;
}

/** ~/.codex-kaboo/state.json */
export interface SyncState {
  version: 1;
  lastSyncAt: number | null;
  lastSyncOk: boolean | null;
  lastError: string | null;
  lastHeartbeatAt: number | null;
  latestCliVersion: string | null;
  codexVersion: string | null; // newest session_meta.cli_version ever parsed
  rateLimit: RateLimitSnapshot | null; // newest snapshot acknowledged by the server
  files: Record<string, FileState>;
}
```

- [ ] **Step 2: Write the failing tests**

`cli/test/util/hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeSummary } from "@codex-kaboo/shared/test-fixtures";
import { canonicalJson, sha1Hex, sha256Hex, summaryHashOf } from "../../src/util/hash";

describe("canonicalJson", () => {
  it("sorts keys recursively, keeps array order and drops undefined", () => {
    const a = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } });
    const b = canonicalJson({ a: { d: [3, { y: 2, z: 1 }] }, b: 1 });
    expect(a).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(a).toBe(b);
  });
});

describe("hashes", () => {
  it("computes sha1 and sha256 hex digests", () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("hashes a summary ignoring summaryHash, inProgress, lineCount and generation", () => {
    const base = makeSummary();
    const h = summaryHashOf(base);
    expect(h).toMatch(/^[0-9a-f]{40}$/);
    expect(summaryHashOf(makeSummary({ inProgress: true, lineCount: 999, generation: 7, summaryHash: "0".repeat(40) }))).toBe(h);
    expect(summaryHashOf(makeSummary({ turns: 3 }))).not.toBe(h);
  });
});
```

`cli/test/util/version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareVersions, meetsVersion, newestVersion, parseVersion } from "../../src/util/version";

describe("versions", () => {
  it("parses and compares numeric dotted versions, ignoring suffixes", () => {
    expect(parseVersion("v0.150.1")).toEqual([0, 150, 1]);
    expect(parseVersion("junk")).toBeNull();
    expect(compareVersions("0.150.1", "0.99.0")).toBe(1);
    expect(compareVersions("0.150.1-build.202609011400.abc1234", "0.150.1")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("22.14.9", "22.15.0")).toBe(-1);
  });
  it("picks the newest valid version and checks floors", () => {
    expect(newestVersion(["0.149.0", undefined, "0.150.1", "junk", null])).toBe("0.150.1");
    expect(newestVersion([])).toBeUndefined();
    expect(meetsVersion("24.17.0", "22.15.0")).toBe(true);
    expect(meetsVersion("22.14.0", "22.15.0")).toBe(false);
  });
});
```

`cli/test/util/names.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { randomLabel } from "../../src/util/names";

describe("randomLabel", () => {
  it("returns adjective-animal labels driven by the random source", () => {
    expect(randomLabel(() => 0)).toBe("agile-otter");
    expect(randomLabel(() => 0.999)).toMatch(/^[a-z]+-[a-z]+$/);
    expect(randomLabel(() => 0.999)).not.toBe("agile-otter");
    expect(randomLabel().length).toBeLessThanOrEqual(64);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/util/hash`, `.../version`, `.../names`.

- [ ] **Step 4: Write the implementations**

`cli/src/util/hash.ts`:

```ts
import { createHash } from "node:crypto";
import type { SessionSummary } from "@codex-kaboo/shared";

/** Recursively sorts object keys, keeps array order, drops `undefined` values. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha1Hex(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const EXCLUDED_FROM_HASH = ["summaryHash", "inProgress", "lineCount", "generation"] as const;

/** Contracts §6: sha1 of the canonical JSON of the summary minus volatile fields. */
export function summaryHashOf(summary: Omit<SessionSummary, "summaryHash"> | SessionSummary): string {
  const clone: Record<string, unknown> = { ...summary };
  for (const key of EXCLUDED_FROM_HASH) delete clone[key];
  return sha1Hex(canonicalJson(clone));
}
```

`cli/src/util/version.ts`:

```ts
export function parseVersion(version: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(version.trim());
  if (!m || !m[1]) return null;
  return m[1].split(".").map((part) => Number(part));
}

/** -1, 0, 1 by numeric dotted comparison; missing segments count as 0; suffixes ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function newestVersion(list: Iterable<string | null | undefined>): string | undefined {
  let best: string | undefined;
  for (const v of list) {
    if (typeof v !== "string" || parseVersion(v) === null) continue;
    if (best === undefined || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

export function meetsVersion(actual: string, required: string): boolean {
  return compareVersions(actual, required) >= 0;
}
```

`cli/src/util/names.ts`:

```ts
const ADJECTIVES = [
  "agile", "amber", "bold", "brisk", "calm", "clever", "cosmic", "crisp", "daring", "eager",
  "fuzzy", "gentle", "golden", "happy", "humble", "jolly", "keen", "lively", "lucky", "mellow",
  "merry", "nimble", "noble", "quick", "quiet", "rapid", "sunny", "swift", "tidy", "vivid",
  "witty", "zesty",
];
const ANIMALS = [
  "otter", "badger", "beaver", "bison", "condor", "cougar", "crane", "dolphin", "falcon", "ferret",
  "finch", "gecko", "heron", "ibis", "jaguar", "koala", "lemur", "lynx", "marmot", "moose",
  "narwhal", "ocelot", "osprey", "panda", "pelican", "puffin", "quokka", "raven", "salmon", "tapir",
  "walrus", "wombat",
];

/** Default machine label, e.g. "brisk-otter". */
export function randomLabel(random: () => number = Math.random): string {
  const pick = (list: string[]): string => list[Math.min(list.length - 1, Math.floor(random() * list.length))] ?? list[0]!;
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS (4 test files: build-info, hash, version, names).

- [ ] **Step 6: Commit**

```bash
git add cli/src cli/test
git commit -F - <<'MSG'
Add CLI state types and hash, version and label utilities

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 7: `util/log.ts` (rotating file logger) and `util/lock.ts` (stale-aware lock)

**Files:**
- Create: `cli/src/util/log.ts`, `cli/src/util/lock.ts`
- Test: `cli/test/util/log.test.ts`, `cli/test/util/lock.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type Logger = { debug(msg): void; info(msg): void; warn(msg): void; error(msg): void }`, `createLogger(opts: { file?: string; quiet?: boolean; verbose?: boolean; console?: (line: string) => void; maxBytes?: number; now?: () => number })`; `acquireLock(lockPath, { now, staleMs, pid, isAlive? })` → `{ acquired: boolean; holder?: { pid; at } }`, `releaseLock(lockPath, pid)`, `readLock(lockPath)`.

- [ ] **Step 1: Write the failing tests**

`cli/test/util/log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../../src/util/log";

describe("createLogger", () => {
  it("writes timestamped lines to the file and honours quiet/verbose on the console", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ck-log-"));
    const file = path.join(dir, "nested", "sync.log");
    const lines: string[] = [];
    const log = createLogger({ file, quiet: true, console: (l) => lines.push(l), now: () => Date.UTC(2026, 8, 1, 12) });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines).toEqual(["2026-09-01T12:00:00.000Z WARN w", "2026-09-01T12:00:00.000Z ERROR e"]);
    const content = readFileSync(file, "utf8");
    expect(content).toBe(
      "2026-09-01T12:00:00.000Z DEBUG d\n2026-09-01T12:00:00.000Z INFO i\n2026-09-01T12:00:00.000Z WARN w\n2026-09-01T12:00:00.000Z ERROR e\n",
    );
    const loud: string[] = [];
    const log2 = createLogger({ console: (l) => loud.push(l), verbose: true, now: () => 0 });
    log2.debug("x");
    log2.info("y");
    expect(loud).toEqual(["1970-01-01T00:00:00.000Z DEBUG x", "1970-01-01T00:00:00.000Z INFO y"]);
  });
  it("rotates the file to .1 when it reaches maxBytes", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ck-log-"));
    const file = path.join(dir, "sync.log");
    const log = createLogger({ file, quiet: true, console: () => {}, maxBytes: 120, now: () => 0 });
    for (let i = 0; i < 10; i++) log.info(`line number ${i} padding padding padding`);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(statSync(file).size).toBeLessThan(200);
  });
});
```

`cli/test/util/lock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, readLock, releaseLock } from "../../src/util/lock";

function tmpLock(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "ck-lock-")), "sync.lock");
}

describe("lock", () => {
  it("acquires, refuses a live holder, and releases only for the owner", async () => {
    const lock = tmpLock();
    expect(await acquireLock(lock, { now: 1000, staleMs: 600000, pid: 11, isAlive: () => true })).toEqual({ acquired: true });
    expect(await readLock(lock)).toEqual({ pid: 11, at: 1000 });
    const second = await acquireLock(lock, { now: 2000, staleMs: 600000, pid: 22, isAlive: () => true });
    expect(second.acquired).toBe(false);
    expect(second.holder).toEqual({ pid: 11, at: 1000 });
    await releaseLock(lock, 22);
    expect(existsSync(lock)).toBe(true);
    await releaseLock(lock, 11);
    expect(existsSync(lock)).toBe(false);
  });
  it("steals a stale lock (old timestamp) or a dead holder", async () => {
    const lock = tmpLock();
    await acquireLock(lock, { now: 0, staleMs: 600000, pid: 11, isAlive: () => true });
    expect((await acquireLock(lock, { now: 600001, staleMs: 600000, pid: 22, isAlive: () => true })).acquired).toBe(true);
    expect(await readLock(lock)).toEqual({ pid: 22, at: 600001 });
    expect((await acquireLock(lock, { now: 600002, staleMs: 600000, pid: 33, isAlive: () => false })).acquired).toBe(true);
    expect(await readLock(lock)).toEqual({ pid: 33, at: 600002 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/util/log` / `lock`.

- [ ] **Step 3: Write `cli/src/util/log.ts`**

```ts
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  /** Append every line here (created on demand, rotated to `<file>.1` at maxBytes). */
  file?: string;
  /** Hide info/debug on the console (warn/error always show). */
  quiet?: boolean;
  /** Show debug on the console. */
  verbose?: boolean;
  console?: (line: string) => void;
  maxBytes?: number;
  now?: () => number;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;

export function createLogger(opts: LoggerOptions = {}): Logger {
  const write = opts.console ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = opts.now ?? (() => Date.now());
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let dirReady = false;

  const toFile = (line: string): void => {
    if (!opts.file) return;
    try {
      if (!dirReady) {
        mkdirSync(path.dirname(opts.file), { recursive: true });
        dirReady = true;
      }
      try {
        if (statSync(opts.file).size >= maxBytes) renameSync(opts.file, `${opts.file}.1`);
      } catch {
        // file does not exist yet
      }
      appendFileSync(opts.file, `${line}\n`, "utf8");
    } catch {
      // logging must never break a sync
    }
  };

  const emit = (level: LogLevel, message: string): void => {
    const line = `${new Date(now()).toISOString()} ${level.toUpperCase()} ${message}`;
    toFile(line);
    const showOnConsole =
      level === "error" || level === "warn" || (level === "info" && !opts.quiet) || (level === "debug" && opts.verbose === true);
    if (showOnConsole) write(line);
  };

  return {
    debug: (m) => emit("debug", m),
    info: (m) => emit("info", m),
    warn: (m) => emit("warn", m),
    error: (m) => emit("error", m),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
```

- [ ] **Step 4: Write `cli/src/util/lock.ts`**

```ts
import { promises as fs } from "node:fs";

export interface LockInfo {
  pid: number;
  at: number;
}

export interface LockOptions {
  now: number;
  staleMs: number;
  pid: number;
  isAlive?: (pid: number) => boolean;
}

export interface LockResult {
  acquired: boolean;
  holder?: LockInfo;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function readLock(lockPath: string): Promise<LockInfo | null> {
  try {
    const raw = JSON.parse(await fs.readFile(lockPath, "utf8")) as Partial<LockInfo>;
    if (typeof raw.pid === "number" && typeof raw.at === "number") return { pid: raw.pid, at: raw.at };
    return null;
  } catch {
    return null;
  }
}

/** Creates the lock file atomically (`wx`); steals it when stale (age > staleMs) or the holder is dead. */
export async function acquireLock(lockPath: string, opts: LockOptions): Promise<LockResult> {
  const isAlive = opts.isAlive ?? defaultIsAlive;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: opts.pid, at: opts.now }), "utf8");
      } finally {
        await handle.close();
      }
      return { acquired: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = await readLock(lockPath);
      const stale = holder === null || opts.now - holder.at > opts.staleMs || !isAlive(holder.pid);
      if (!stale) return { acquired: false, holder: holder ?? undefined };
      await fs.rm(lockPath, { force: true });
    }
  }
  return { acquired: false };
}

export async function releaseLock(lockPath: string, pid: number): Promise<void> {
  const holder = await readLock(lockPath);
  if (holder !== null && holder.pid !== pid) return;
  await fs.rm(lockPath, { force: true });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/util cli/test/util
git commit -F - <<'MSG'
Add rotating file logger and stale-aware sync lock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 8: `core/paths.ts` and `core/config.ts`

**Files:**
- Create: `cli/src/core/paths.ts`, `cli/src/core/config.ts`
- Test: `cli/test/core/paths.test.ts`, `cli/test/core/config.test.ts`

**Interfaces:**
- Consumes: `Config` from `../types`.
- Produces: `kabooHome(env?)`, `kabooPaths(home?)` → `KabooPaths { home, config, state, log, lock, launchdLog, cronLog, vbs }`, `defaultCodexHome()`, `resolveCodexHomes({ override?, env?, configured? })`; `readConfig(paths)` → `Config | null`, `writeConfig(paths, config)`, `deleteConfig(paths)` → boolean, `writeJsonAtomic(file, value, mode?)`.

- [ ] **Step 1: Write the failing tests**

`cli/test/core/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { defaultCodexHome, kabooHome, kabooPaths, resolveCodexHomes } from "../../src/core/paths";

describe("paths", () => {
  it("defaults to ~/.codex-kaboo and honours CODEX_KABOO_HOME", () => {
    expect(kabooHome({})).toBe(path.join(os.homedir(), ".codex-kaboo"));
    expect(kabooHome({ CODEX_KABOO_HOME: "/tmp/ck-home" })).toBe(path.resolve("/tmp/ck-home"));
    const p = kabooPaths("/tmp/ck-home");
    expect(p.config).toBe(path.join("/tmp/ck-home", "config.json"));
    expect(p.state).toBe(path.join("/tmp/ck-home", "state.json"));
    expect(p.log).toBe(path.join("/tmp/ck-home", "sync.log"));
    expect(p.lock).toBe(path.join("/tmp/ck-home", "sync.lock"));
    expect(p.vbs).toBe(path.join("/tmp/ck-home", "sync-hidden.vbs"));
  });
  it("resolves codex homes by precedence: override > CODEX_HOME > configured > ~/.codex", () => {
    expect(resolveCodexHomes({ env: {} })).toEqual([defaultCodexHome()]);
    expect(resolveCodexHomes({ env: { CODEX_HOME: "/x/codex" }, configured: ["/y"] })).toEqual([path.resolve("/x/codex")]);
    expect(resolveCodexHomes({ env: {}, configured: ["/y", "/y", "/z"] })).toEqual([path.resolve("/y"), path.resolve("/z")]);
    expect(resolveCodexHomes({ override: "/o", env: { CODEX_HOME: "/x" } })).toEqual([path.resolve("/o")]);
    expect(resolveCodexHomes({ env: {}, configured: ["~/.codex-alt"] })).toEqual([path.join(os.homedir(), ".codex-alt")]);
  });
});
```

`cli/test/core/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteConfig, readConfig, writeConfig } from "../../src/core/config";
import { kabooPaths } from "../../src/core/paths";
import type { Config } from "../../src/types";

const config: Config = {
  server: "https://example.convex.site",
  token: "ck_test",
  machineId: "m-1",
  label: "brisk-otter",
  hostnameOptIn: false,
  codexHomes: [],
  userId: "u1",
  userName: "Ada",
  userEmail: null,
  tokenName: "laptop",
  loggedInAt: 1,
};

describe("config", () => {
  it("round-trips through an atomic 0600 file and returns null when missing", async () => {
    const paths = kabooPaths(path.join(mkdtempSync(path.join(os.tmpdir(), "ck-cfg-")), "home"));
    expect(await readConfig(paths)).toBeNull();
    await writeConfig(paths, config);
    expect(await readConfig(paths)).toEqual(config);
    expect(readdirSync(paths.home).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    if (process.platform !== "win32") expect(statSync(paths.config).mode & 0o777).toBe(0o600);
    expect(await deleteConfig(paths)).toBe(true);
    expect(await deleteConfig(paths)).toBe(false);
    expect(await readConfig(paths)).toBeNull();
  });
  it("rejects incomplete configs and throws on corrupt JSON", async () => {
    const paths = kabooPaths(mkdtempSync(path.join(os.tmpdir(), "ck-cfg-")));
    writeFileSync(paths.config, JSON.stringify({ server: "x" }));
    expect(await readConfig(paths)).toBeNull();
    writeFileSync(paths.config, "{not json");
    await expect(readConfig(paths)).rejects.toThrow(/not valid JSON/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/core/paths` / `config`.

- [ ] **Step 3: Write `cli/src/core/paths.ts`**

```ts
import os from "node:os";
import path from "node:path";

export interface KabooPaths {
  home: string;
  config: string;
  state: string;
  log: string;
  lock: string;
  launchdLog: string;
  cronLog: string;
  vbs: string;
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** ~/.codex-kaboo (os.homedir honours USERPROFILE on Windows); CODEX_KABOO_HOME overrides. */
export function kabooHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODEX_KABOO_HOME;
  if (override && override.trim().length > 0) return path.resolve(expandHome(override.trim()));
  return path.join(os.homedir(), ".codex-kaboo");
}

export function kabooPaths(home: string = kabooHome()): KabooPaths {
  return {
    home,
    config: path.join(home, "config.json"),
    state: path.join(home, "state.json"),
    log: path.join(home, "sync.log"),
    lock: path.join(home, "sync.lock"),
    launchdLog: path.join(home, "launchd.log"),
    cronLog: path.join(home, "cron.log"),
    vbs: path.join(home, "sync-hidden.vbs"),
  };
}

export function defaultCodexHome(): string {
  return path.join(os.homedir(), ".codex");
}

/** Precedence: --codex-home override → CODEX_HOME → config.codexHomes → ~/.codex. */
export function resolveCodexHomes(
  opts: { override?: string; env?: NodeJS.ProcessEnv; configured?: string[] } = {},
): string[] {
  const env = opts.env ?? process.env;
  let homes: string[];
  if (opts.override && opts.override.trim().length > 0) homes = [opts.override.trim()];
  else if (env.CODEX_HOME && env.CODEX_HOME.trim().length > 0) homes = [env.CODEX_HOME.trim()];
  else if (opts.configured && opts.configured.length > 0) homes = opts.configured;
  else homes = [defaultCodexHome()];
  return Array.from(new Set(homes.map((h) => path.resolve(expandHome(h)))));
}
```

- [ ] **Step 4: Write `cli/src/core/config.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "../types";
import type { KabooPaths } from "./paths";

/** Writes `<file>.<pid>.tmp` then renames it over `file`; creates the directory (0700) on demand. */
export async function writeJsonAtomic(file: string, value: unknown, mode?: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: mode ?? 0o644 });
  if (mode !== undefined) {
    try {
      await fs.chmod(tmp, mode);
    } catch {
      // Windows has no POSIX modes
    }
  }
  await fs.rename(tmp, file);
}

export async function readConfig(paths: KabooPaths): Promise<Config | null> {
  let text: string;
  try {
    text = await fs.readFile(paths.config, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let raw: Partial<Config>;
  try {
    raw = JSON.parse(text) as Partial<Config>;
  } catch {
    throw new Error(`${paths.config} is not valid JSON; run \`codex-kaboo login\` again`);
  }
  if (typeof raw.server !== "string" || typeof raw.token !== "string" || typeof raw.machineId !== "string") {
    return null;
  }
  return {
    server: raw.server,
    token: raw.token,
    machineId: raw.machineId,
    label: typeof raw.label === "string" && raw.label.length > 0 ? raw.label : "unnamed-machine",
    hostnameOptIn: raw.hostnameOptIn === true,
    codexHomes: Array.isArray(raw.codexHomes) ? raw.codexHomes.filter((x): x is string => typeof x === "string") : [],
    ...(raw.userId !== undefined ? { userId: raw.userId } : {}),
    ...(raw.userName !== undefined ? { userName: raw.userName } : {}),
    ...(raw.userEmail !== undefined ? { userEmail: raw.userEmail } : {}),
    ...(raw.tokenName !== undefined ? { tokenName: raw.tokenName } : {}),
    ...(raw.loggedInAt !== undefined ? { loggedInAt: raw.loggedInAt } : {}),
  };
}

export async function writeConfig(paths: KabooPaths, config: Config): Promise<void> {
  await writeJsonAtomic(paths.config, config, 0o600);
}

/** Returns false when there was nothing to delete. */
export async function deleteConfig(paths: KabooPaths): Promise<boolean> {
  try {
    await fs.rm(paths.config);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core cli/test/core
git commit -F - <<'MSG'
Add CLI path resolution and atomic config storage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 9: `core/state.ts` — sync state keyed by session id, reset detection

**Files:**
- Create: `cli/src/core/state.ts`
- Test: `cli/test/core/state.test.ts`

**Interfaces:**
- Consumes: `FileState`, `SyncState` (types), `writeJsonAtomic` (core/config), `KabooPaths`.
- Produces: `TAIL_BYTES = 64`, `emptyState()`, `readState(paths)` → `{ state, corrupt }`, `writeState(paths, state)`, `emptyFileState(path)`, `resetFileState(previous, path)`, `resetAllFiles(state)`, `type ResetReason = "shrunk" | "tail-mismatch"`, `detectReset(fileState, path, size)`, `isUnchanged(fileState, size, mtimeMs)`.

- [ ] **Step 1: Write the failing tests**

`cli/test/core/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { kabooPaths } from "../../src/core/paths";
import {
  detectReset, emptyFileState, emptyState, isUnchanged, readState, resetAllFiles, resetFileState, writeState,
} from "../../src/core/state";

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), "ck-state-"));
}

describe("state file", () => {
  it("returns an empty state when missing, flags corrupt files, and round-trips atomically", async () => {
    const paths = kabooPaths(path.join(tmp(), "home"));
    expect(await readState(paths)).toEqual({ state: emptyState(), corrupt: false });
    const state = emptyState();
    state.files["s1"] = { ...emptyFileState("/p/one.jsonl"), offset: 10, lastUploadedSeq: 3 };
    state.lastSyncAt = 5;
    await writeState(paths, state);
    expect(await readState(paths)).toEqual({ state, corrupt: false });
    expect(readdirSync(paths.home).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    writeFileSync(paths.state, "{oops");
    expect(await readState(paths)).toEqual({ state: emptyState(), corrupt: true });
    writeFileSync(paths.state, JSON.stringify({ version: 99 }));
    expect((await readState(paths)).corrupt).toBe(true);
  });
  it("resets file state while bumping the generation", () => {
    const prev = { ...emptyFileState("/p/a.jsonl"), offset: 100, lines: 5, lastUploadedSeq: 4, summaryHash: "h", generation: 2, tail: "AA==" };
    const reset = resetFileState(prev, "/p/moved.jsonl");
    expect(reset).toEqual({ ...emptyFileState("/p/moved.jsonl"), generation: 3 });
    expect(resetFileState(undefined, "/p/new.jsonl").generation).toBe(0);
    const all = resetAllFiles({ ...emptyState(), files: { s1: prev } });
    expect(all.files["s1"]?.generation).toBe(3);
    expect(all.files["s1"]?.offset).toBe(0);
  });
});

describe("detectReset / isUnchanged", () => {
  it("detects shrunk files and tail mismatches", async () => {
    const dir = tmp();
    const file = path.join(dir, "r.jsonl");
    const content = "0123456789".repeat(10); // 100 bytes
    writeFileSync(file, content);
    const tail = Buffer.from(content.slice(36, 100)).toString("base64");
    const good = { ...emptyFileState(file), offset: 100, size: 100, tail };
    expect(await detectReset(good, file, 100)).toBeNull();
    expect(await detectReset(good, file, 90)).toBe("shrunk");
    writeFileSync(file, `${content.slice(0, 50)}XXXXXXXXXX${content.slice(60)}`);
    expect(await detectReset(good, file, 100)).toBe("tail-mismatch");
    expect(await detectReset({ ...good, offset: 0, tail: "" }, file, 100)).toBeNull();
    const short = { ...emptyFileState(file), offset: 20, size: 20, tail: Buffer.from("different-bytes-here").toString("base64") };
    expect(await detectReset(short, file, 100)).toBe("tail-mismatch");
    writeFileSync(file, content);
    expect(await detectReset({ ...short, tail: Buffer.from(content.slice(0, 20)).toString("base64") }, file, 100)).toBeNull();
  });
  it("treats identical size+mtime as unchanged unless the last run errored", () => {
    const f = { ...emptyFileState("/p"), size: 10, mtimeMs: 5 };
    expect(isUnchanged(f, 10, 5)).toBe(true);
    expect(isUnchanged(f, 11, 5)).toBe(false);
    expect(isUnchanged(f, 10, 6)).toBe(false);
    expect(isUnchanged({ ...f, lastError: "boom" }, 10, 5)).toBe(false);
    expect(isUnchanged(undefined, 10, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/core/state`.

- [ ] **Step 3: Write `cli/src/core/state.ts`**

```ts
import { promises as fs } from "node:fs";
import type { FileState, SyncState } from "../types";
import { writeJsonAtomic } from "./config";
import type { KabooPaths } from "./paths";

export const TAIL_BYTES = 64;

export function emptyState(): SyncState {
  return {
    version: 1,
    lastSyncAt: null,
    lastSyncOk: null,
    lastError: null,
    lastHeartbeatAt: null,
    latestCliVersion: null,
    codexVersion: null,
    rateLimit: null,
    files: {},
  };
}

export async function readState(paths: KabooPaths): Promise<{ state: SyncState; corrupt: boolean }> {
  let text: string;
  try {
    text = await fs.readFile(paths.state, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: emptyState(), corrupt: false };
    throw error;
  }
  try {
    const raw = JSON.parse(text) as Partial<SyncState> | null;
    if (!raw || raw.version !== 1 || typeof raw.files !== "object" || raw.files === null) {
      return { state: emptyState(), corrupt: true };
    }
    return { state: { ...emptyState(), ...raw, version: 1, files: raw.files }, corrupt: false };
  } catch {
    return { state: emptyState(), corrupt: true };
  }
}

export async function writeState(paths: KabooPaths, state: SyncState): Promise<void> {
  await writeJsonAtomic(paths.state, state);
}

export function emptyFileState(filePath: string): FileState {
  return {
    path: filePath,
    offset: 0,
    lines: 0,
    size: 0,
    mtimeMs: 0,
    tail: "",
    lastUploadedSeq: -1,
    summaryHash: null,
    generation: 0,
    complete: false,
    lastError: null,
  };
}

export function resetFileState(previous: FileState | undefined, filePath: string): FileState {
  return { ...emptyFileState(filePath), generation: previous === undefined ? 0 : previous.generation + 1 };
}

/** `sync --full`: forget every file's progress but keep generations increasing. */
export function resetAllFiles(state: SyncState): SyncState {
  const files: Record<string, FileState> = {};
  for (const [sessionId, file] of Object.entries(state.files)) files[sessionId] = resetFileState(file, file.path);
  return { ...state, files };
}

export type ResetReason = "shrunk" | "tail-mismatch";

/** Null when the bytes before `offset` still match the recorded tail (so the file only grew). */
export async function detectReset(fileState: FileState, filePath: string, size: number): Promise<ResetReason | null> {
  if (fileState.offset === 0) return null;
  if (size < fileState.offset) return "shrunk";
  const start = Math.max(0, fileState.offset - TAIL_BYTES);
  const length = fileState.offset - start;
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const tail = buffer.subarray(0, bytesRead).toString("base64");
    return tail === fileState.tail ? null : "tail-mismatch";
  } finally {
    await handle.close();
  }
}

export function isUnchanged(fileState: FileState | undefined, size: number, mtimeMs: number): boolean {
  return (
    fileState !== undefined &&
    fileState.lastError === null &&
    fileState.size === size &&
    fileState.mtimeMs === mtimeMs
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/state.ts cli/test/core/state.test.ts
git commit -F - <<'MSG'
Add sync state store with reset detection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 10: `core/jsonl-reader.ts` — byte-accurate streaming line reader (+ `.zst`)

**Files:**
- Create: `cli/src/core/jsonl-reader.ts`
- Test: `cli/test/core/jsonl-reader.test.ts`

**Interfaces:**
- Consumes: `TAIL_BYTES` (core/state).
- Produces: `interface LineRecord { seq: number; text: string; end: number }`, `interface ReadResult { consumed: number; lines: number; tail: string; partial: boolean; bytes: number }`, `readJsonlLines(filePath, onLine, { compressed?, chunkSize? })`, `zstdSupported()`, `parseJsonLine(text)` → `unknown | undefined`.

Behaviour: reads from byte 0 in `chunkSize` (default 256 KiB) chunks with positioned `filehandle.read`; a line is complete only when its `\n` was seen (a trailing `\r` is stripped); `end` is the byte offset just after that `\n`; the trailing bytes without `\n` are never yielded (`partial: true`); `consumed` = end of the last complete line; `tail` = base64 of the last ≤ 64 bytes before `consumed` (empty for compressed input). Multi-byte UTF-8 is safe because decoding happens on the assembled line bytes, never on chunk boundaries. Compressed files stream through `zlib.createZstdDecompress()` when `zstdSupported()`; otherwise the function throws `ZstdUnsupportedError`.

- [ ] **Step 1: Write the failing tests**

`cli/test/core/jsonl-reader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { parseJsonLine, readJsonlLines, zstdSupported, type LineRecord } from "../../src/core/jsonl-reader";

function tmpFile(name: string, content: Buffer | string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ck-reader-"));
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

async function collect(file: string, opts?: { compressed?: boolean; chunkSize?: number }) {
  const lines: LineRecord[] = [];
  const result = await readJsonlLines(file, (rec) => lines.push(rec), opts);
  return { lines, result };
}

describe("readJsonlLines", () => {
  it("yields complete lines with byte-accurate end offsets (multi-byte UTF-8)", async () => {
    const file = tmpFile("a.jsonl", '{"a":"é"}\n{"b":"😀"}\n{"c":1}\n');
    const { lines, result } = await collect(file);
    expect(lines.map((l) => l.text)).toEqual(['{"a":"é"}', '{"b":"😀"}', '{"c":1}']);
    expect(lines.map((l) => l.end)).toEqual([11, 24, 32]); // é = 2 bytes, 😀 = 4 bytes
    expect(result).toMatchObject({ consumed: 32, lines: 3, partial: false, bytes: 32 });
    expect(Buffer.from(result.tail, "base64").toString("utf8")).toBe('{"a":"é"}\n{"b":"😀"}\n{"c":1}\n');
  });
  it("does not yield or count a trailing partial line", async () => {
    const file = tmpFile("b.jsonl", '{"a":1}\n{"b":');
    const { lines, result } = await collect(file);
    expect(lines).toHaveLength(1);
    expect(result).toMatchObject({ consumed: 8, lines: 1, partial: true, bytes: 13 });
    expect(Buffer.from(result.tail, "base64").toString("utf8")).toBe('{"a":1}\n');
  });
  it("reassembles lines split across tiny chunks and strips CR", async () => {
    const file = tmpFile("c.jsonl", "héllo\r\nwörld\r\n");
    const { lines, result } = await collect(file, { chunkSize: 3 });
    expect(lines.map((l) => l.text)).toEqual(["héllo", "wörld"]);
    expect(lines.map((l) => l.end)).toEqual([8, 16]);
    expect(result.consumed).toBe(16);
  });
  it("handles a line larger than 1 MiB and keeps a 64-byte tail", async () => {
    const big = `{"x":"${"y".repeat(1_200_000)}"}`;
    const file = tmpFile("d.jsonl", `${big}\n{}\n`);
    const { lines, result } = await collect(file, { chunkSize: 64 * 1024 });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.text.length).toBe(big.length);
    expect(lines[1]?.text).toBe("{}");
    expect(Buffer.from(result.tail, "base64").length).toBe(64);
  });
  it("yields corrupt lines as text; parseJsonLine returns undefined for them", async () => {
    const file = tmpFile("e.jsonl", "{not json\n{\"ok\":true}\n");
    const { lines } = await collect(file);
    expect(parseJsonLine(lines[0]?.text ?? "")).toBeUndefined();
    expect(parseJsonLine(lines[1]?.text ?? "")).toEqual({ ok: true });
  });
  it("reads an empty file", async () => {
    const { lines, result } = await collect(tmpFile("f.jsonl", ""));
    expect(lines).toEqual([]);
    expect(result).toEqual({ consumed: 0, lines: 0, tail: "", partial: false, bytes: 0 });
  });
  it.skipIf(!zstdSupported())("streams zstd-compressed files", async () => {
    const compressed = zlib.zstdCompressSync(Buffer.from('{"a":1}\n{"b":2}\n'));
    const file = tmpFile("g.jsonl.zst", compressed);
    const { lines, result } = await collect(file, { compressed: true });
    expect(lines.map((l) => l.text)).toEqual(['{"a":1}', '{"b":2}']);
    expect(result).toMatchObject({ lines: 2, partial: false, tail: "" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/core/jsonl-reader`.

- [ ] **Step 3: Write `cli/src/core/jsonl-reader.ts`**

```ts
import { createReadStream, promises as fs } from "node:fs";
import zlib from "node:zlib";
import { TAIL_BYTES } from "./state"; // one definition: the tail this reader writes is the window detectReset compares

export interface LineRecord {
  seq: number; // 0-based complete-line index
  text: string; // line without the trailing \n (and \r)
  end: number; // byte offset just after the '\n'
}

export interface ReadResult {
  consumed: number; // byte offset after the last complete line
  lines: number;
  tail: string; // base64 of the last ≤ 64 bytes before `consumed` ("" for compressed input)
  partial: boolean; // trailing bytes without '\n' exist
  bytes: number; // total bytes read (decompressed bytes for .zst)
}

export interface ReadOptions {
  compressed?: boolean;
  chunkSize?: number;
}

export class ZstdUnsupportedError extends Error {
  constructor() {
    super("zstd decompression needs Node >= 22.15 (zlib.createZstdDecompress)");
    this.name = "ZstdUnsupportedError";
  }
}

type ZlibWithZstd = { createZstdDecompress?: () => NodeJS.ReadWriteStream };

export function zstdSupported(): boolean {
  return typeof (zlib as unknown as ZlibWithZstd).createZstdDecompress === "function";
}

export function parseJsonLine(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const NEWLINE = 0x0a;

class LineSplitter {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private position = 0;
  seq = 0;
  consumed = 0;

  constructor(private readonly onLine: (record: LineRecord) => void) {}

  push(chunk: Buffer): void {
    let start = 0;
    for (;;) {
      const idx = chunk.indexOf(NEWLINE, start);
      if (idx === -1) break;
      const piece = chunk.subarray(start, idx);
      const full = this.pendingBytes > 0 ? Buffer.concat([...this.pending, piece]) : piece;
      this.pending = [];
      this.pendingBytes = 0;
      let text = full.toString("utf8");
      if (text.endsWith("\r")) text = text.slice(0, -1);
      const end = this.position + idx + 1;
      this.onLine({ seq: this.seq, text, end });
      this.seq += 1;
      this.consumed = end;
      start = idx + 1;
    }
    if (start < chunk.length) {
      const rest = Buffer.from(chunk.subarray(start)); // copy: the caller reuses its buffer
      this.pending.push(rest);
      this.pendingBytes += rest.length;
    }
    this.position += chunk.length;
  }

  get partial(): boolean {
    return this.pendingBytes > 0;
  }

  get bytes(): number {
    return this.position;
  }
}

async function readTail(handle: fs.FileHandle, consumed: number): Promise<string> {
  if (consumed <= 0) return "";
  const start = Math.max(0, consumed - TAIL_BYTES);
  const buffer = Buffer.alloc(consumed - start);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
  return buffer.subarray(0, bytesRead).toString("base64");
}

export async function readJsonlLines(
  filePath: string,
  onLine: (record: LineRecord) => void,
  opts: ReadOptions = {},
): Promise<ReadResult> {
  const splitter = new LineSplitter(onLine);
  if (opts.compressed) {
    const factory = (zlib as unknown as ZlibWithZstd).createZstdDecompress;
    if (typeof factory !== "function") throw new ZstdUnsupportedError();
    const stream = createReadStream(filePath).pipe(factory());
    for await (const chunk of stream) splitter.push(chunk as Buffer);
    return { consumed: splitter.consumed, lines: splitter.seq, tail: "", partial: splitter.partial, bytes: splitter.bytes };
  }
  const chunkSize = opts.chunkSize ?? 256 * 1024;
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(chunkSize);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, position);
      if (bytesRead === 0) break;
      splitter.push(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const tail = await readTail(handle, splitter.consumed);
    return { consumed: splitter.consumed, lines: splitter.seq, tail, partial: splitter.partial, bytes: position };
  } finally {
    await handle.close();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS (the zstd test runs on Node ≥ 22.15, otherwise shows as skipped).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/jsonl-reader.ts cli/test/core/jsonl-reader.test.ts
git commit -F - <<'MSG'
Add byte-accurate streaming JSONL reader with zstd support

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 11: `core/discover.ts` — find rollout files

**Files:**
- Create: `cli/src/core/discover.ts`
- Test: `cli/test/core/discover.test.ts`

**Interfaces:**
- Consumes: `CLI_MAX_FILES` (`@codex-kaboo/shared/constants`).
- Produces: `ROLLOUT_RE`, `parseRolloutName(name)` → `{ fileTimestamp, fileTimestampMs, threadId, rolloutId, compressed } | null`, `interface DiscoveredFile { path; codexHome; name; fileTimestamp; fileTimestampMs; threadId; rolloutId; sessionId; compressed; size; mtimeMs }`, `discoverRolloutFiles(codexHomes, { maxFiles? })` → `{ files, truncated, homes: { path, exists, files }[] }`.

- [ ] **Step 1: Write the failing tests**

`cli/test/core/discover.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverRolloutFiles, parseRolloutName } from "../../src/core/discover";

const T1 = "0199a1b2-0000-7000-8000-000000000001";
const T2 = "0199a1b2-0000-7000-8000-000000000002";
const R1 = "0199a1b2-0000-7000-8000-00000000000a";

function makeHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "ck-codex-"));
  const day = path.join(home, "sessions", "2026", "08", "30");
  const archived = path.join(home, "archived_sessions", "2026", "07", "01");
  mkdirSync(day, { recursive: true });
  mkdirSync(archived, { recursive: true });
  writeFileSync(path.join(day, `rollout-2026-08-30T10-00-00-${T1}.jsonl`), "{}\n");
  writeFileSync(path.join(day, `rollout-2026-08-30T11-00-00-${T1}_${R1}.jsonl`), "{}\n{}\n");
  writeFileSync(path.join(day, "notes.txt"), "x");
  writeFileSync(path.join(day, `rollout-2026-08-30T12-00-00-${T2}.jsonl.tmp`), "x");
  writeFileSync(path.join(archived, `rollout-2026-07-01T09-00-00-${T2}.jsonl.zst`), Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  return home;
}

describe("parseRolloutName", () => {
  it("accepts plain, forked and compressed names only", () => {
    expect(parseRolloutName(`rollout-2026-08-30T10-00-00-${T1}.jsonl`)).toEqual({
      fileTimestamp: "2026-08-30T10-00-00", fileTimestampMs: Date.UTC(2026, 7, 30, 10, 0, 0), threadId: T1, rolloutId: null, compressed: false,
    });
    expect(parseRolloutName(`rollout-2026-08-30T10-00-00-${T1}_${R1}.jsonl.zst`)).toMatchObject({ threadId: T1, rolloutId: R1, compressed: true });
    expect(parseRolloutName(`rollout-2026-08-30T10-00-00-${T1}.jsonl.tmp`)).toBeNull();
    expect(parseRolloutName("rollout-x.jsonl")).toBeNull();
  });
});

describe("discoverRolloutFiles", () => {
  it("walks sessions and archived_sessions, sorted by path, with metadata", async () => {
    const home = makeHome();
    const result = await discoverRolloutFiles([home]);
    expect(result.truncated).toBe(false);
    expect(result.homes).toEqual([{ path: home, exists: true, files: 3 }]);
    expect(result.files.map((f) => f.sessionId)).toEqual([T2, T1, `${T1}_${R1}`]);
    const forked = result.files[2]!;
    expect(forked).toMatchObject({ codexHome: home, threadId: T1, rolloutId: R1, compressed: false, size: 6 });
    expect(forked.mtimeMs).toBeGreaterThan(0);
    expect(result.files[0]).toMatchObject({ compressed: true, sessionId: T2 });
  });
  it("caps the number of files and reports missing homes", async () => {
    const home = makeHome();
    const capped = await discoverRolloutFiles([home, path.join(home, "missing")], { maxFiles: 2 });
    expect(capped.files).toHaveLength(2);
    expect(capped.truncated).toBe(true);
    expect(capped.homes[1]).toEqual({ path: path.join(home, "missing"), exists: false, files: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/core/discover`.

- [ ] **Step 3: Write `cli/src/core/discover.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { CLI_MAX_FILES } from "@codex-kaboo/shared/constants";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export const ROLLOUT_RE = new RegExp(
  `^rollout-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2})-(${UUID})(?:_(${UUID}))?\\.jsonl(\\.zst)?$`,
);
const SUBDIRS = ["sessions", "archived_sessions"] as const;

export interface RolloutName {
  fileTimestamp: string;
  fileTimestampMs: number;
  threadId: string;
  rolloutId: string | null;
  compressed: boolean;
}

export interface DiscoveredFile extends RolloutName {
  path: string;
  codexHome: string;
  name: string;
  sessionId: string;
  size: number;
  mtimeMs: number;
}

export interface DiscoverResult {
  files: DiscoveredFile[];
  truncated: boolean;
  homes: { path: string; exists: boolean; files: number }[];
}

export function parseRolloutName(name: string): RolloutName | null {
  const m = ROLLOUT_RE.exec(name);
  if (!m || !m[1] || !m[2]) return null;
  const [date, time] = m[1].split("T") as [string, string];
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi, s] = time.split("-").map(Number) as [number, number, number];
  return {
    fileTimestamp: m[1],
    fileTimestampMs: Date.UTC(y, mo - 1, d, h, mi, s),
    threadId: m[2].toLowerCase(),
    rolloutId: m[3] ? m[3].toLowerCase() : null,
    compressed: m[4] !== undefined,
  };
}

async function walk(dir: string, out: string[], limit: number): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out, limit);
    else if (entry.isFile() && ROLLOUT_RE.test(entry.name)) out.push(full);
  }
}

export async function discoverRolloutFiles(
  codexHomes: string[],
  opts: { maxFiles?: number } = {},
): Promise<DiscoverResult> {
  const maxFiles = opts.maxFiles ?? CLI_MAX_FILES;
  const files: DiscoveredFile[] = [];
  const homes: DiscoverResult["homes"] = [];
  let truncated = false;
  for (const home of codexHomes) {
    let exists = false;
    try {
      exists = (await fs.stat(home)).isDirectory();
    } catch {
      exists = false;
    }
    const found: string[] = [];
    if (exists) {
      for (const sub of SUBDIRS) await walk(path.join(home, sub), found, maxFiles + 1 - files.length);
    }
    let count = 0;
    for (const full of found) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const name = path.basename(full);
      const parsed = parseRolloutName(name);
      if (!parsed) continue;
      let stat: import("node:fs").Stats;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      files.push({
        ...parsed,
        path: full,
        codexHome: home,
        name,
        sessionId: parsed.rolloutId ? `${parsed.threadId}_${parsed.rolloutId}` : parsed.threadId,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
      count += 1;
    }
    homes.push({ path: home, exists, files: count });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, truncated, homes };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/discover.ts cli/test/core/discover.test.ts
git commit -F - <<'MSG'
Add rollout file discovery across sessions and archived_sessions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 12: `parser/diff.ts` — line counting for FileChange items

**Files:**
- Create: `cli/src/parser/diff.ts`
- Test: `cli/test/parser/diff.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `countDiffLines(diff: string)` → `{ added: number; removed: number }` (counts only `+`/`-` lines inside `@@` hunks, ignores `\ No newline…` markers and `---`/`+++` headers), `countLines(content: string)` → number.

- [ ] **Step 1: Write the failing tests**

`cli/test/parser/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { countDiffLines, countLines } from "../../src/parser/diff";

describe("countDiffLines", () => {
  it("counts + and - lines inside hunks only", () => {
    const diff = [
      "--- a/file", "+++ b/file", "@@ -1,2 +1,3 @@", " context", "+added one", "-removed one",
      "\\ No newline at end of file", "@@ -10 +11 @@", "+added two", "+added three", " more context",
    ].join("\n");
    expect(countDiffLines(diff)).toEqual({ added: 3, removed: 1 });
  });
  it("ignores text before the first hunk and handles empty input", () => {
    expect(countDiffLines("+not a hunk\n-nope")).toEqual({ added: 0, removed: 0 });
    expect(countDiffLines("")).toEqual({ added: 0, removed: 0 });
    expect(countDiffLines("@@ -1 +1 @@\r\n+a\r\n-b\r\n")).toEqual({ added: 1, removed: 1 });
  });
});

describe("countLines", () => {
  it("counts newline-terminated and unterminated lines", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("\n")).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/parser/diff`.

- [ ] **Step 3: Write `cli/src/parser/diff.ts`**

```ts
/** Counts added/removed lines inside unified-diff hunks; never returns the diff text. */
export function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const rawLine of diff.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const parts = content.split("\n").length;
  return content.endsWith("\n") ? parts - 1 : parts;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/parser/diff.ts cli/test/parser/diff.test.ts
git commit -F - <<'MSG'
Add unified diff and content line counters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 13: `parser/classify.ts` — tool kinds, skills, MCP names, sources, projects, field coercion

**Files:**
- Create: `cli/src/parser/classify.ts`
- Test: `cli/test/parser/classify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type CommandKind`, `classifyParsedCmdType(type)`, `SKILL_RE`, `detectSkills(values)`, `BUILTIN_TOOL_NAMES`, `mcpKeyFromFunctionName(name)` → `"server/tool" | null`, `sourceOf(source)`, `isSubagentSource(source)`, `projectOf(cwd)`, `clipString(value, max?)` → `string | undefined`, `toCount(value)` → non-negative safe integer (0 for junk), `asRecord(value)` → `Record<string, unknown> | null`.

- [ ] **Step 1: Write the failing tests**

`cli/test/parser/classify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  asRecord, classifyParsedCmdType, clipString, detectSkills, isSubagentSource, mcpKeyFromFunctionName,
  projectOf, sourceOf, toCount,
} from "../../src/parser/classify";

describe("classifyParsedCmdType", () => {
  it("maps the four parsed_cmd types and everything else to Other", () => {
    expect(classifyParsedCmdType("read")).toBe("commandRead");
    expect(classifyParsedCmdType("list_files")).toBe("commandList");
    expect(classifyParsedCmdType("search")).toBe("commandSearch");
    expect(classifyParsedCmdType("unknown")).toBe("commandOther");
    expect(classifyParsedCmdType("future_type")).toBe("commandOther");
    expect(classifyParsedCmdType(undefined)).toBe("commandOther");
  });
});

describe("detectSkills", () => {
  it("extracts the parent directory of any SKILL.md path, with slashes or backslashes", () => {
    expect(detectSkills(["/Users/x/.codex/skills/.system/openai-docs/SKILL.md"])).toEqual(["openai-docs"]);
    expect(detectSkills(["C:\\Users\\x\\.codex\\skills\\lark-apps\\SKILL.md"])).toEqual(["lark-apps"]);
    expect(detectSkills(["cat", "skills/foo/SKILL.md", 42, null])).toEqual(["foo"]);
    expect(detectSkills(['cat "a/b/SKILL.md" && cat c/d/SKILL.md'])).toEqual(["b", "d"]);
    expect(detectSkills(["SKILL.md", "notes/skill.txt"])).toEqual([]);
    expect(detectSkills(["/x/y/skill.MD"])).toEqual(["y"]);
  });
});

describe("mcpKeyFromFunctionName", () => {
  it("recognises mcp__server__tool and server__tool but not built-ins", () => {
    expect(mcpKeyFromFunctionName("mcp__context7__query-docs")).toBe("context7/query-docs");
    expect(mcpKeyFromFunctionName("mcp__claude-in-chrome__tabs_context_mcp")).toBe("claude-in-chrome/tabs_context_mcp");
    expect(mcpKeyFromFunctionName("github__list_issues")).toBe("github/list_issues");
    expect(mcpKeyFromFunctionName("exec")).toBeNull();
    expect(mcpKeyFromFunctionName("wait")).toBeNull();
    expect(mcpKeyFromFunctionName("apply_patch")).toBeNull();
    expect(mcpKeyFromFunctionName("shell_command")).toBeNull();
    expect(mcpKeyFromFunctionName("")).toBeNull();
    expect(mcpKeyFromFunctionName(undefined)).toBeNull();
  });
});

describe("sourceOf / projectOf", () => {
  it("normalises string and object sources", () => {
    expect(sourceOf("cli")).toBe("cli");
    expect(sourceOf("exec")).toBe("exec");
    expect(sourceOf({ subagent: { other: "guardian" } })).toBe("subagent:guardian");
    expect(sourceOf({ subagent: "review" })).toBe("subagent:review");
    expect(sourceOf({ subagent: {} })).toBe("subagent:unknown");
    expect(sourceOf({ custom: "x" })).toBe("custom");
    expect(sourceOf(undefined)).toBe("unknown");
    expect(isSubagentSource("subagent:guardian")).toBe(true);
    expect(isSubagentSource("cli")).toBe(false);
  });
  it("keeps only the last path segment of cwd", () => {
    expect(projectOf("/Users/me/Documents/codex-kaboo")).toBe("codex-kaboo");
    expect(projectOf("C:\\work\\my-app\\")).toBe("my-app");
    expect(projectOf("/")).toBe("(unknown)");
    expect(projectOf(undefined)).toBe("(unknown)");
    expect(projectOf(`/x/${"a".repeat(300)}`)).toHaveLength(256);
  });
});

describe("coercion", () => {
  it("clips strings and coerces counts", () => {
    expect(clipString("abc")).toBe("abc");
    expect(clipString("")).toBeUndefined();
    expect(clipString(5)).toBeUndefined();
    expect(clipString("x".repeat(300), 10)).toHaveLength(10);
    expect(toCount(5)).toBe(5);
    expect(toCount(5.9)).toBe(5);
    expect(toCount(-1)).toBe(0);
    expect(toCount("7")).toBe(0);
    expect(toCount(Number.NaN)).toBe(0);
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toBeNull();
    expect(asRecord(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/parser/classify`.

- [ ] **Step 3: Write `cli/src/parser/classify.ts`**

```ts
import { MAX_STRING_LENGTH } from "@codex-kaboo/shared/constants";

export type CommandKind = "commandRead" | "commandList" | "commandSearch" | "commandOther";

export function classifyParsedCmdType(type: unknown): CommandKind {
  switch (type) {
    case "read":
      return "commandRead";
    case "list_files":
      return "commandList";
    case "search":
      return "commandSearch";
    default:
      return "commandOther";
  }
}

/** Parent directory of a SKILL.md path; matches with `/` or `\` separators, case-insensitive. */
export const SKILL_RE = /(?:^|[\\/])([^\\/\s"']+)[\\/]SKILL\.md\b/i;

/** Distinct skill names referenced by any string in `values` (non-strings ignored). Never returns the input. */
export function detectSkills(values: readonly unknown[]): string[] {
  const found = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const re = new RegExp(SKILL_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found].sort();
}

/** Codex built-in function/custom tool names (never counted as MCP). */
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "exec", "shell", "shell_command", "local_shell", "container.exec", "exec_command", "write_stdin",
  "unified_exec", "apply_patch", "update_plan", "view_image", "web_search", "wait", "js_repl",
  "image_generation", "spawn_agent", "send_input", "wait_agent", "close_agent", "list_agents",
  "request_user_input", "codex_review", "read_file", "list_dir", "grep_files",
]);

const MCP_PREFIXED = /^mcp__(.+?)__(.+)$/;
const MCP_BARE = /^([A-Za-z0-9][A-Za-z0-9.-]*)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/;

/** "server/tool" for MCP-looking function names, null for built-ins and everything else. */
export function mcpKeyFromFunctionName(name: unknown): string | null {
  if (typeof name !== "string" || name.length === 0) return null;
  const prefixed = MCP_PREFIXED.exec(name);
  if (prefixed && prefixed[1] && prefixed[2]) return clipString(`${prefixed[1]}/${prefixed[2]}`) ?? null;
  if (BUILTIN_TOOL_NAMES.has(name)) return null;
  const bare = MCP_BARE.exec(name);
  if (bare && bare[1] && bare[2]) return clipString(`${bare[1]}/${bare[2]}`) ?? null;
  return null;
}

/** session_meta.source → "cli" | "exec" | "vscode" | … | "subagent:<kind>" | "unknown". */
export function sourceOf(source: unknown): string {
  if (typeof source === "string") return clipString(source) ?? "unknown";
  const record = asRecord(source);
  if (record === null) return "unknown";
  if ("subagent" in record) {
    const sub = record.subagent;
    if (typeof sub === "string" && sub.length > 0) return `subagent:${clipString(sub, 200)}`;
    const subRecord = asRecord(sub);
    const firstKey = subRecord ? Object.keys(subRecord)[0] : undefined;
    if (subRecord && firstKey !== undefined) {
      const inner = subRecord[firstKey];
      const kind = typeof inner === "string" && inner.length > 0 ? inner : firstKey;
      return `subagent:${clipString(kind, 200)}`;
    }
    return "subagent:unknown";
  }
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0]) return clipString(keys[0]) ?? "unknown";
  return "unknown";
}

export function isSubagentSource(source: string): boolean {
  return source.startsWith("subagent:");
}

/** basename(cwd) — the only part of cwd that ever leaves the machine. */
export function projectOf(cwd: unknown): string {
  if (typeof cwd !== "string") return "(unknown)";
  const segments = cwd.split(/[\\/]+/).filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  return last === undefined ? "(unknown)" : (clipString(last) ?? "(unknown)");
}

export function clipString(value: unknown, max: number = MAX_STRING_LENGTH): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export function toCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/parser/classify.ts cli/test/parser/classify.test.ts
git commit -F - <<'MSG'
Add parser classification helpers for tools, skills, MCP names and sources

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 14: `parser/time.ts` — timestamps and time zones

**Files:**
- Create: `cli/src/parser/time.ts`
- Test: `cli/test/parser/time.test.ts`

**Interfaces:**
- Consumes: `dayHourIn` from `@codex-kaboo/shared/days`.
- Produces: `parseLineTimestamp(value)` → ms | null, `secondsToMs(value)` → ms | null, `isValidZone(zone)`, `machineZone()`, `resolveZone(sessionZone, fallback)`, `dayHour(tsMs, zone)`.

- [ ] **Step 1: Write the failing tests**

`cli/test/parser/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dayHour, isValidZone, machineZone, parseLineTimestamp, resolveZone, secondsToMs } from "../../src/parser/time";

describe("timestamps", () => {
  it("parses ISO strings and numeric seconds/ms", () => {
    expect(parseLineTimestamp("2026-08-30T17:00:00.000Z")).toBe(Date.UTC(2026, 7, 30, 17));
    expect(parseLineTimestamp("not a date")).toBeNull();
    expect(parseLineTimestamp(undefined)).toBeNull();
    expect(parseLineTimestamp(1756573200)).toBe(1756573200000);
    expect(parseLineTimestamp(1756573200123)).toBe(1756573200123);
  });
  it("converts Unix seconds to ms and tolerates ms input", () => {
    expect(secondsToMs(1756573200)).toBe(1756573200000);
    expect(secondsToMs(1756573200.5)).toBe(1756573200500);
    expect(secondsToMs(1756573200123)).toBe(1756573200123);
    expect(secondsToMs(-1)).toBeNull();
    expect(secondsToMs("1756573200")).toBeNull();
    expect(secondsToMs(null)).toBeNull();
  });
});

describe("zones", () => {
  it("validates IANA zones and resolves session → fallback → undefined", () => {
    expect(isValidZone("Asia/Tokyo")).toBe(true);
    expect(isValidZone("Mars/Olympus")).toBe(false);
    expect(isValidZone("")).toBe(false);
    expect(isValidZone(5)).toBe(false);
    expect(resolveZone("Asia/Tokyo", "UTC")).toBe("Asia/Tokyo");
    expect(resolveZone("Mars/Olympus", "UTC")).toBe("UTC");
    expect(resolveZone(undefined, "Mars/Olympus")).toBeUndefined();
    const mz = machineZone();
    expect(mz === undefined || isValidZone(mz)).toBe(true);
  });
  it("delegates day/hour to the shared helper", () => {
    expect(dayHour(Date.UTC(2026, 0, 1, 0), "Asia/Tokyo")).toEqual({ day: "2026-01-01", hour: 9 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/parser/time`.

- [ ] **Step 3: Write `cli/src/parser/time.ts`**

```ts
import { dayHourIn } from "@codex-kaboo/shared/days";

const MS_THRESHOLD = 1e12; // values above this are already milliseconds

/** Line `timestamp` (ISO string, or a number in seconds/ms) → Unix ms, or null. */
export function parseLineTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value > MS_THRESHOLD ? Math.floor(value) : Math.round(value * 1000);
  }
  if (typeof value === "string" && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Unix seconds (started_at / completed_at / resets_at) → ms; ms input is passed through. */
export function secondsToMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value > MS_THRESHOLD ? Math.floor(value) : Math.round(value * 1000);
}

export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function machineZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidZone(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** First valid zone of (session zone, fallback); undefined lets dayHourIn use the machine zone → UTC. */
export function resolveZone(sessionZone: unknown, fallback: string | undefined): string | undefined {
  if (isValidZone(sessionZone)) return sessionZone;
  if (isValidZone(fallback)) return fallback;
  return undefined;
}

export function dayHour(tsMs: number, zone: string | undefined): { day: string; hour: number } {
  return dayHourIn(tsMs, zone);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/parser/time.ts cli/test/parser/time.test.ts
git commit -F - <<'MSG'
Add timestamp and time zone helpers for the parser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 15: `parser/session.ts` part 1 — reducer state, session_meta, turns, token events, rate limits, `finalize()`

**Files:**
- Create: `cli/src/parser/session.ts`
- Test: `cli/test/parser/session.test.ts`

**Interfaces:**
- Consumes: `classify.ts` (`asRecord`, `clipString`, `toCount`, `projectOf`, `sourceOf`, `isSubagentSource`), `time.ts` (`parseLineTimestamp`, `secondsToMs`, `isValidZone`, `resolveZone`, `dayHour`), `jsonl-reader.ts` (`parseJsonLine`), `util/hash.ts` (`summaryHashOf`), shared constants/metrics/types.
- Produces: `interface ReducerContext { sessionId; threadId; rolloutId; fileTimestampMs: number | null; machineZone?: string }`, `interface ReducerState` (exported, fields listed below), `createReducerState(ctx)`, `reduceLine(state, seq, text)`, `reduce(state, seq, line)`, `interface FinalizeOptions { now: number; generation: number }`, `interface ParsedSession { summary: SessionSummary; events: TokenEvent[]; rateLimit: RateLimitSnapshot | null; diagnostics: { unknownTypes: Record<string, number>; itemTypes: Record<string, number>; mcpFallbackUsed: boolean; zone: string | undefined } }`, `finalize(state, opts)`.

Rules implemented here (spec table rows `session_meta`, `turn_context`, `task_started`, `task_complete`, `token_count`, `token_usage_record`, "any line"): model/effort of a token event are joined by `turn_id` at finalize time (never "latest turn_context"); an all-zero `last_token_usage` produces no event; when any `token_usage_record` line exists the `token_count`-derived events are dropped; the newest rate-limit snapshot wins (by line timestamp); `activeMs` uses `duration_ms`, else `(completed_at − started_at) × 1000`; `time_to_first_token_ms` may be `null` and is then ignored; day/hour use the session zone → machine zone → UTC; `summaryHash` per contracts §6. The `item_completed`, legacy message, `response_item` and `compacted` rows are added in Task 16 (until then they land in `diagnostics.unknownTypes`).

- [ ] **Step 1: Write the failing tests**

`cli/test/parser/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SessionSummary, TokenEvent } from "@codex-kaboo/shared/sync";
import { createReducerState, finalize, reduceLine, type ReducerContext } from "../../src/parser/session";

const TID = "0199a1b2-0000-7000-8000-000000000001";
const T = (s: number): string => new Date(Date.UTC(2026, 7, 30, 17, 0, s)).toISOString();
const SEC = (s: number): number => Math.floor(Date.UTC(2026, 7, 30, 17, 0, s) / 1000);
const line = (type: string, payload: unknown, ts: string, ordinal?: number): string =>
  JSON.stringify(ordinal === undefined ? { timestamp: ts, type, payload } : { timestamp: ts, ordinal, type, payload });

const usage = (input: number, cached: number, output: number, reasoning: number) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output,
  reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const rateLimits = (used: number) => ({
  primary: { used_percent: used, window_minutes: 10080, resets_at: SEC(600) }, secondary: null, plan_type: "pro", limit_id: "weekly",
});
const meta = (extra: Record<string, unknown> = {}) => ({
  id: TID, timestamp: T(0), cwd: "/redacted/project-a", originator: "codex-tui", source: "cli", cli_version: "0.150.1",
  git: { branch: "main", repository_url: "https://example.invalid/r.git", commit_hash: "abc" },
  base_instructions: { text: "SECRET", provenance: { type: "model", model: "gpt-5.6-sol" } }, history_mode: "paginated", ...extra,
});

function ctx(overrides: Partial<ReducerContext> = {}): ReducerContext {
  return { sessionId: TID, threadId: TID, rolloutId: null, fileTimestampMs: Date.UTC(2026, 7, 30, 17), machineZone: "UTC", ...overrides };
}

function run(lines: string[], c = ctx(), opts = { now: Date.UTC(2026, 7, 30, 18), generation: 0 }) {
  const state = createReducerState(c);
  lines.forEach((text, seq) => reduceLine(state, seq, text));
  return finalize(state, opts);
}

const twoTurns = [
  line("session_meta", meta(), T(0), 0),
  line("event_msg", { type: "task_started", turn_id: "t1", started_at: SEC(1), model_context_window: 272000 }, T(1), 1),
  line("turn_context", { turn_id: "t1", model: "gpt-5.6-sol", effort: "xhigh", timezone: "Asia/Tokyo", collaboration_mode: { mode: "default", settings: { developer_instructions: "SECRET" } } }, T(1), 2),
  line("event_msg", { type: "token_count", info: { last_token_usage: usage(1000, 600, 100, 40), model_context_window: 272000 }, rate_limits: rateLimits(10) }, T(2), 3),
  line("event_msg", { type: "token_count", info: { last_token_usage: usage(2000, 1500, 50, 10) }, rate_limits: rateLimits(11) }, T(3), 4),
  line("event_msg", { type: "task_complete", turn_id: "t1", started_at: SEC(1), completed_at: SEC(5), duration_ms: 4000, time_to_first_token_ms: 1200, last_agent_message: "SECRET" }, T(5), 5),
  line("event_msg", { type: "task_started", turn_id: "t2", started_at: SEC(10) }, T(10), 6),
  line("turn_context", { turn_id: "t2", model: "gpt-5.6-luna", effort: "low", timezone: "Asia/Tokyo" }, T(10), 7),
  line("event_msg", { type: "token_count", info: { last_token_usage: usage(500, 0, 20, 0) }, rate_limits: null }, T(11), 8),
  line("event_msg", { type: "task_complete", turn_id: "t2", started_at: SEC(10), completed_at: SEC(13), duration_ms: null, time_to_first_token_ms: null }, T(13), 9),
];

describe("reducer: sessions, turns and token events", () => {
  it("builds a valid summary and per-response events joined by turn id", () => {
    const parsed = run(twoTurns);
    const s = parsed.summary;
    expect(SessionSummary.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({
      sessionId: TID, threadId: TID, project: "project-a", gitBranch: "main", originator: "codex-tui", source: "cli",
      isSubagent: false, cliVersion: "0.150.1", model: "gpt-5.6-luna", effort: "low", timezone: "Asia/Tokyo",
      turns: 2, completedTurns: 2, activeMs: 7000, responses: 3, lineCount: 10, parseErrors: 0, parserVersion: 1,
      inProgress: false, generation: 0, compactions: 0,
    });
    expect(s.startedAt).toBe(Date.UTC(2026, 7, 30, 17, 0, 0));
    expect(s.endedAt).toBe(Date.UTC(2026, 7, 30, 17, 0, 13));
    expect(s.wallMs).toBe(13000);
    expect(s.day).toBe("2026-08-31"); // 17:00Z = 02:00 next day in Tokyo
    expect(s.tokens).toEqual({ input: 3500, cachedInput: 2100, cacheWrite: 0, output: 170, reasoning: 50, total: 3670 });
    expect(s.ttft).toEqual({ count: 1, sumMs: 1200, hist: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(s.summaryHash).toMatch(/^[0-9a-f]{40}$/);
    expect(parsed.events.every((e) => TokenEvent.safeParse(e).success)).toBe(true);
    expect(parsed.events.map((e) => [e.seq, e.model, e.effort, e.turnId, e.hour, e.day, e.total])).toEqual([
      [3, "gpt-5.6-sol", "xhigh", "t1", 2, "2026-08-31", 1100],
      [4, "gpt-5.6-sol", "xhigh", "t1", 2, "2026-08-31", 2050],
      [8, "gpt-5.6-luna", "low", "t2", 2, "2026-08-31", 520],
    ]);
    expect(parsed.events[0]).toMatchObject({ sessionId: TID, project: "project-a", isSubagent: false, contextWindow: 272000, input: 1000, cachedInput: 600, output: 100, reasoning: 40 });
    expect(parsed.rateLimit).toEqual({ observedAt: Date.UTC(2026, 7, 30, 17, 0, 3), usedPercent: 11, windowMinutes: 10080, resetsAt: SEC(600) * 1000, planType: "pro", limitId: "weekly" });
    expect(parsed.diagnostics.zone).toBe("Asia/Tokyo");
    expect(JSON.stringify(parsed)).not.toContain("SECRET");
    expect(JSON.stringify(parsed)).not.toContain("/redacted");
  });
  it("keeps the hash stable across generation but not across token changes", () => {
    const a = run(twoTurns);
    const b = run(twoTurns, ctx(), { now: Date.UTC(2026, 7, 30, 18), generation: 5 });
    expect(b.summary.inProgress).toBe(false); // both turns completed; `inProgress` is structural — file mtime is never consulted
    expect(b.summary.generation).toBe(5);
    expect(b.summary.summaryHash).toBe(a.summary.summaryHash);
    const c = run([...twoTurns, line("event_msg", { type: "token_count", info: { last_token_usage: usage(1, 0, 1, 0) }, rate_limits: null }, T(14), 10)]);
    expect(c.summary.summaryHash).not.toBe(a.summary.summaryHash);
  });
  it("skips all-zero and null usage, counts parse errors and unknown types", () => {
    const parsed = run([
      line("session_meta", meta(), T(0), 0),
      "{this is not json",
      line("event_msg", { type: "token_count", info: { last_token_usage: usage(0, 0, 0, 0) }, rate_limits: null }, T(1), 2),
      line("event_msg", { type: "token_count", info: null, rate_limits: null }, T(2), 3),
      line("world_state", { anything: "SECRET" }, T(3), 4),
      line("event_msg", { type: "thread_settings_applied" }, T(4), 5),
    ]);
    expect(parsed.summary.parseErrors).toBe(1);
    expect(parsed.summary.lineCount).toBe(6);
    expect(parsed.events).toEqual([]);
    expect(parsed.summary.responses).toBe(0);
    expect(parsed.diagnostics.unknownTypes).toEqual({ world_state: 1, "event_msg/thread_settings_applied": 1 });
    expect(parsed.summary.model).toBe("gpt-5.6-sol"); // provenance fallback
  });
  it("prefers token_usage_record events over token_count when present", () => {
    const parsed = run([
      line("session_meta", meta(), T(0), 0),
      line("event_msg", { type: "task_started", turn_id: "t1", started_at: SEC(1) }, T(1), 1),
      line("turn_context", { turn_id: "t1", model: "gpt-5.6-sol", effort: "medium", timezone: "UTC" }, T(1), 2),
      line("event_msg", { type: "token_count", info: { last_token_usage: usage(1000, 0, 10, 0) }, rate_limits: null }, T(2), 3),
      line("token_usage_record", { turn_id: "t1", usage: usage(1000, 0, 10, 0) }, T(2), 4),
    ]);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ seq: 4, model: "gpt-5.6-sol", effort: "medium", total: 1010 });
  });
  it("handles sub-agent metadata, missing zones and open turns", () => {
    const parsed = run(
      [
        line("session_meta", meta({ source: { subagent: { other: "guardian" } }, parent_thread_id: "0199a1b2-0000-7000-8000-00000000ffff", git: undefined, base_instructions: { text: "x", provenance: { type: "custom" } } }), T(0)),
        line("event_msg", { type: "task_started", turn_id: "t1", started_at: SEC(1) }, T(1)),
        line("event_msg", { type: "token_count", info: { last_token_usage: usage(100, 50, 10, 5) }, rate_limits: null }, T(2)),
      ],
      ctx({ machineZone: "America/Los_Angeles" }),
    );
    expect(parsed.summary).toMatchObject({ source: "subagent:guardian", isSubagent: true, parentThreadId: "0199a1b2-0000-7000-8000-00000000ffff", model: "(unknown)", inProgress: true, timezone: "America/Los_Angeles", day: "2026-08-30" });
    expect(parsed.summary.gitBranch).toBeUndefined();
    expect(parsed.events[0]).toMatchObject({ model: "(unknown)", isSubagent: true, hour: 10, day: "2026-08-30" });
    expect(parsed.events[0]?.effort).toBeUndefined();
  });
  it("falls back to the first line timestamp, then the filename timestamp, for startedAt", () => {
    const noMeta = run([line("event_msg", { type: "task_started", turn_id: "t1", started_at: SEC(7) }, T(7))]);
    expect(noMeta.summary.startedAt).toBe(Date.UTC(2026, 7, 30, 17, 0, 7));
    const empty = run([]);
    expect(empty.summary.startedAt).toBe(Date.UTC(2026, 7, 30, 17));
    expect(empty.summary.wallMs).toBe(0);
    expect(empty.summary.project).toBe("(unknown)");
    expect(SessionSummary.safeParse(empty.summary).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/parser/session`.

- [ ] **Step 3: Write `cli/src/parser/session.ts`**

```ts
import {
  MAX_KEYED_ENTRIES_PER_SESSION, OTHER_KEY, PARSER_VERSION,
} from "@codex-kaboo/shared/constants";
import { addTokens, emptyTokens, emptyToolCounts, emptyTtft, mergeKeyCounts, ttftBucketIndex } from "@codex-kaboo/shared/metrics";
import type { KeyCount, RateLimitSnapshot, SessionSummary, TokenEvent, ToolCounts, Ttft } from "@codex-kaboo/shared/sync";
import { parseJsonLine } from "../core/jsonl-reader";
import { summaryHashOf } from "../util/hash";
import { asRecord, clipString, isSubagentSource, projectOf, sourceOf, toCount } from "./classify";
import { dayHour, isValidZone, parseLineTimestamp, resolveZone, secondsToMs } from "./time";

export interface ReducerContext {
  sessionId: string;
  threadId: string;
  rolloutId: string | null;
  fileTimestampMs: number | null;
  machineZone?: string;
}

interface TurnInfo {
  model?: string;
  effort?: string;
  mode?: string;
}

interface PendingEvent {
  seq: number;
  ts: number;
  turnId?: string;
  model?: string; // explicit model on the line (token_usage_record only)
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  contextWindow?: number;
}

export interface ReducerState {
  ctx: ReducerContext;
  metaSeen: boolean;
  threadId: string;
  startedAt: number | null;
  project: string;
  gitBranch?: string;
  originator: string;
  source: string;
  isSubagent: boolean;
  parentThreadId?: string;
  cliVersion?: string;
  fallbackModel?: string;
  timezone?: string;
  turns: Map<string, TurnInfo>;
  currentTurnId?: string;
  openTurn: boolean;
  lastModel?: string;
  lastEffort?: string;
  contextWindow?: number;
  counts: {
    turns: number;
    completedTurns: number;
    userMessages: number;
    agentMessages: number;
    reasoningItems: number;
    legacyUserMessages: number;
    legacyAgentMessages: number;
    compactedLines: number;
    contextCompactionItems: number;
    linesAdded: number;
    linesRemoved: number;
    filesChanged: number;
    activeMs: number;
    lineCount: number;
    parseErrors: number;
  };
  toolCounts: ToolCounts;
  mcpTools: Map<string, number>; // from McpToolCall items
  mcpFallback: Map<string, number>; // from response_item/function_call names
  skills: Map<string, number>;
  ttft: Ttft;
  tokenCountEvents: PendingEvent[];
  usageRecordEvents: PendingEvent[];
  hasUsageRecords: boolean;
  firstTs: number | null;
  lastTs: number | null;
  rateLimit: RateLimitSnapshot | null;
  unknownTypes: Map<string, number>;
  itemTypes: Map<string, number>;
}

export interface FinalizeOptions {
  now: number;
  generation: number;
}

export interface ParsedSession {
  summary: SessionSummary;
  events: TokenEvent[];
  rateLimit: RateLimitSnapshot | null;
  diagnostics: {
    unknownTypes: Record<string, number>;
    itemTypes: Record<string, number>;
    mcpFallbackUsed: boolean;
    zone: string | undefined;
  };
}

export function createReducerState(ctx: ReducerContext): ReducerState {
  return {
    ctx,
    metaSeen: false,
    threadId: ctx.threadId,
    startedAt: null,
    project: "(unknown)",
    originator: "unknown",
    source: "unknown",
    isSubagent: false,
    turns: new Map(),
    openTurn: false,
    counts: {
      turns: 0, completedTurns: 0, userMessages: 0, agentMessages: 0, reasoningItems: 0,
      legacyUserMessages: 0, legacyAgentMessages: 0, compactedLines: 0, contextCompactionItems: 0,
      linesAdded: 0, linesRemoved: 0, filesChanged: 0, activeMs: 0, lineCount: 0, parseErrors: 0,
    },
    toolCounts: emptyToolCounts(),
    mcpTools: new Map(),
    mcpFallback: new Map(),
    skills: new Map(),
    ttft: emptyTtft(),
    tokenCountEvents: [],
    usageRecordEvents: [],
    hasUsageRecords: false,
    firstTs: null,
    lastTs: null,
    rateLimit: null,
    unknownTypes: new Map(),
    itemTypes: new Map(),
  };
}

export function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Feed one raw line (already `\n`-terminated in the file). Parse failures are counted and skipped. */
export function reduceLine(state: ReducerState, seq: number, text: string): void {
  state.counts.lineCount += 1;
  const parsed = asRecord(parseJsonLine(text));
  if (parsed === null) {
    state.counts.parseErrors += 1;
    return;
  }
  reduce(state, seq, parsed);
}

export function reduce(state: ReducerState, seq: number, line: Record<string, unknown>): void {
  const ts = parseLineTimestamp(line.timestamp);
  if (ts !== null) {
    if (state.firstTs === null || ts < state.firstTs) state.firstTs = ts;
    if (state.lastTs === null || ts > state.lastTs) state.lastTs = ts;
  }
  const payload = asRecord(line.payload) ?? {};
  switch (line.type) {
    case "session_meta":
      handleSessionMeta(state, payload, ts);
      break;
    case "turn_context":
      handleTurnContext(state, payload);
      break;
    case "event_msg":
      handleEventMsg(state, seq, payload, ts);
      break;
    case "token_usage_record":
      handleUsageRecord(state, seq, payload, ts);
      break;
    default:
      bump(state.unknownTypes, typeof line.type === "string" ? line.type : "(non-string type)");
  }
}

function handleSessionMeta(state: ReducerState, payload: Record<string, unknown>, lineTs: number | null): void {
  state.metaSeen = true;
  const id = clipString(payload.id);
  if (id) state.threadId = id;
  state.startedAt = parseLineTimestamp(payload.timestamp) ?? lineTs ?? state.startedAt;
  state.project = projectOf(payload.cwd);
  const branch = clipString(asRecord(payload.git)?.branch);
  if (branch) state.gitBranch = branch;
  state.originator = clipString(payload.originator) ?? "unknown";
  state.source = sourceOf(payload.source);
  const parent = clipString(payload.parent_thread_id);
  if (parent) state.parentThreadId = parent;
  state.isSubagent = isSubagentSource(state.source) || parent !== undefined;
  const cliVersion = clipString(payload.cli_version);
  if (cliVersion) state.cliVersion = cliVersion;
  const model = clipString(asRecord(asRecord(payload.base_instructions)?.provenance)?.model);
  if (model) state.fallbackModel = model;
}

function handleTurnContext(state: ReducerState, payload: Record<string, unknown>): void {
  const turnId = clipString(payload.turn_id);
  const model = clipString(payload.model);
  const effort = clipString(payload.effort);
  const mode = clipString(asRecord(payload.collaboration_mode)?.mode);
  if (turnId) {
    const info: TurnInfo = {};
    if (model) info.model = model;
    if (effort) info.effort = effort;
    if (mode) info.mode = mode;
    state.turns.set(turnId, info);
  }
  if (model) state.lastModel = model;
  if (effort) state.lastEffort = effort;
  if (state.timezone === undefined) {
    const zone = clipString(payload.timezone);
    if (zone && isValidZone(zone)) state.timezone = zone;
  }
}

function pendingEventFrom(
  state: ReducerState,
  seq: number,
  ts: number | null,
  usage: Record<string, unknown>,
  info: Record<string, unknown> | null,
): PendingEvent | null {
  if (ts === null) return null;
  const input = toCount(usage.input_tokens);
  const cachedInput = toCount(usage.cached_input_tokens);
  const cacheWrite = toCount(usage.cache_write_input_tokens);
  const output = toCount(usage.output_tokens);
  const reasoning = toCount(usage.reasoning_output_tokens);
  if (input + cachedInput + cacheWrite + output + reasoning === 0) return null;
  const contextWindow = toCount(info?.model_context_window) || state.contextWindow;
  const event: PendingEvent = { seq, ts, input, cachedInput, cacheWrite, output, reasoning };
  if (state.currentTurnId) event.turnId = state.currentTurnId;
  if (contextWindow) event.contextWindow = contextWindow;
  return event;
}

function considerRateLimit(state: ReducerState, rateLimits: Record<string, unknown>, ts: number): void {
  const primary = asRecord(rateLimits.primary);
  if (primary === null) return;
  const used = primary.used_percent;
  if (typeof used !== "number" || !Number.isFinite(used)) return;
  const snapshot: RateLimitSnapshot = {
    observedAt: ts,
    usedPercent: Math.max(0, used),
    windowMinutes: toCount(primary.window_minutes),
  };
  const resetsAt = secondsToMs(primary.resets_at);
  if (resetsAt !== null) snapshot.resetsAt = resetsAt;
  const planType = clipString(rateLimits.plan_type);
  if (planType) snapshot.planType = planType;
  const limitId = clipString(rateLimits.limit_id);
  if (limitId) snapshot.limitId = limitId;
  if (state.rateLimit === null || snapshot.observedAt >= state.rateLimit.observedAt) state.rateLimit = snapshot;
}

function handleEventMsg(state: ReducerState, seq: number, payload: Record<string, unknown>, ts: number | null): void {
  const c = state.counts;
  switch (payload.type) {
    case "task_started": {
      c.turns += 1;
      const turnId = clipString(payload.turn_id);
      if (turnId) state.currentTurnId = turnId;
      state.openTurn = true;
      const contextWindow = toCount(payload.model_context_window);
      if (contextWindow > 0) state.contextWindow = contextWindow;
      break;
    }
    case "task_complete": {
      c.completedTurns += 1;
      state.openTurn = false;
      const duration = payload.duration_ms;
      if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
        c.activeMs += Math.round(duration);
      } else {
        const started = secondsToMs(payload.started_at);
        const completed = secondsToMs(payload.completed_at);
        if (started !== null && completed !== null && completed >= started) c.activeMs += completed - started;
      }
      const ttft = payload.time_to_first_token_ms;
      if (typeof ttft === "number" && Number.isFinite(ttft) && ttft >= 0) {
        state.ttft.count += 1;
        state.ttft.sumMs += Math.round(ttft);
        const idx = ttftBucketIndex(ttft);
        state.ttft.hist[idx] = (state.ttft.hist[idx] ?? 0) + 1;
      }
      break;
    }
    case "token_count": {
      const info = asRecord(payload.info);
      const usage = asRecord(info?.last_token_usage);
      if (usage !== null) {
        const event = pendingEventFrom(state, seq, ts, usage, info);
        if (event) state.tokenCountEvents.push(event);
      }
      const rateLimits = asRecord(payload.rate_limits);
      if (rateLimits !== null && ts !== null) considerRateLimit(state, rateLimits, ts);
      break;
    }
    default:
      bump(state.unknownTypes, `event_msg/${typeof payload.type === "string" ? payload.type : "(none)"}`);
  }
}

function handleUsageRecord(state: ReducerState, seq: number, payload: Record<string, unknown>, ts: number | null): void {
  const info = asRecord(payload.info);
  const usage =
    asRecord(payload.usage) ?? asRecord(info?.last_token_usage) ?? (typeof payload.input_tokens === "number" ? payload : null);
  if (usage === null) {
    bump(state.unknownTypes, "token_usage_record/unrecognised");
    return;
  }
  state.hasUsageRecords = true;
  const event = pendingEventFrom(state, seq, ts, usage, info);
  if (event === null) return;
  const turnId = clipString(payload.turn_id);
  if (turnId) event.turnId = turnId;
  const model = clipString(payload.model);
  if (model) event.model = model;
  state.usageRecordEvents.push(event);
}

function mapToKeyCounts(map: Map<string, number>): KeyCount[] {
  return [...map.entries()].map(([key, count]) => ({ key, count }));
}

export function finalize(state: ReducerState, opts: FinalizeOptions): ParsedSession {
  const c = state.counts;
  const zone = resolveZone(state.timezone, state.ctx.machineZone);
  const startedAt = state.startedAt ?? state.firstTs ?? state.ctx.fileTimestampMs ?? opts.now;
  const endedAt = Math.max(startedAt, state.lastTs ?? startedAt);
  const pending = state.hasUsageRecords ? state.usageRecordEvents : state.tokenCountEvents;
  const events: TokenEvent[] = [...pending]
    .sort((a, b) => a.seq - b.seq)
    .map((ev) => {
      const turn = ev.turnId ? state.turns.get(ev.turnId) : undefined;
      const { day, hour } = dayHour(ev.ts, zone);
      const event: TokenEvent = {
        sessionId: state.ctx.sessionId,
        seq: ev.seq,
        ts: ev.ts,
        day,
        hour,
        model: ev.model ?? turn?.model ?? state.lastModel ?? state.fallbackModel ?? "(unknown)",
        project: state.project,
        isSubagent: state.isSubagent,
        input: ev.input,
        cachedInput: ev.cachedInput,
        cacheWrite: ev.cacheWrite,
        output: ev.output,
        reasoning: ev.reasoning,
        total: ev.input + ev.output,
      };
      const effort = turn?.effort ?? state.lastEffort;
      if (effort) event.effort = effort;
      if (ev.turnId) event.turnId = ev.turnId;
      if (ev.contextWindow) event.contextWindow = ev.contextWindow;
      return event;
    });
  const tokens = events.reduce((acc, e) => addTokens(acc, e), emptyTokens());
  const mcpFallbackUsed = state.mcpTools.size === 0 && state.mcpFallback.size > 0;
  const mcpSource = mcpFallbackUsed ? state.mcpFallback : state.mcpTools;
  const toolCounts: ToolCounts = { ...state.toolCounts };
  if (mcpFallbackUsed) toolCounts.mcpTool = [...state.mcpFallback.values()].reduce((a, b) => a + b, 0);
  const base: Omit<SessionSummary, "summaryHash"> = {
    sessionId: state.ctx.sessionId,
    threadId: state.threadId,
    startedAt,
    endedAt,
    wallMs: endedAt - startedAt,
    day: dayHour(startedAt, zone).day,
    project: state.project,
    originator: state.originator,
    source: state.source,
    isSubagent: state.isSubagent,
    model: state.lastModel ?? state.fallbackModel ?? "(unknown)",
    turns: c.turns,
    completedTurns: c.completedTurns,
    userMessages: c.userMessages > 0 ? c.userMessages : c.legacyUserMessages,
    agentMessages: c.agentMessages > 0 ? c.agentMessages : c.legacyAgentMessages,
    reasoningItems: c.reasoningItems,
    toolCounts,
    mcpTools: mergeKeyCounts([mapToKeyCounts(mcpSource)], MAX_KEYED_ENTRIES_PER_SESSION, OTHER_KEY),
    skills: mergeKeyCounts([mapToKeyCounts(state.skills)], MAX_KEYED_ENTRIES_PER_SESSION, OTHER_KEY),
    linesAdded: c.linesAdded,
    linesRemoved: c.linesRemoved,
    filesChanged: c.filesChanged,
    compactions: Math.max(c.compactedLines, c.contextCompactionItems),
    activeMs: c.activeMs,
    ttft: { count: state.ttft.count, sumMs: state.ttft.sumMs, hist: [...state.ttft.hist] },
    tokens,
    responses: events.length,
    inProgress: state.openTurn, // structural only: a started turn without completion
    lineCount: c.lineCount,
    generation: opts.generation,
    parseErrors: c.parseErrors,
    parserVersion: PARSER_VERSION,
  };
  if (state.parentThreadId) base.parentThreadId = state.parentThreadId;
  if (zone) base.timezone = zone;
  if (state.gitBranch) base.gitBranch = state.gitBranch;
  if (state.lastEffort) base.effort = state.lastEffort;
  if (state.cliVersion) base.cliVersion = state.cliVersion;
  const summary: SessionSummary = { ...base, summaryHash: summaryHashOf(base) };
  return {
    summary,
    events,
    rateLimit: state.rateLimit,
    diagnostics: {
      unknownTypes: Object.fromEntries(state.unknownTypes),
      itemTypes: Object.fromEntries(state.itemTypes),
      mcpFallbackUsed,
      zone,
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS. (`activeMs: 7000` = 4000 from `duration_ms` + 3000 from `completed_at − started_at`; `hist[4] = 1` because 1200 ms falls in the (1000, 1500] bucket.)

- [ ] **Step 5: Commit**

```bash
git add cli/src/parser/session.ts cli/test/parser/session.test.ts
git commit -F - <<'MSG'
Add session reducer core: metadata, turns, token events, rate limits, finalize

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 16: `parser/session.ts` part 2 — items, legacy messages, MCP fallback, compactions

**Files:**
- Modify: `cli/src/parser/session.ts` (extend `reduce`, `handleEventMsg`; add `handleItemCompleted`, `handleCommandExecution`, `handleFileChange`, `handleResponseItem`)
- Test: `cli/test/parser/session-items.test.ts`

**Interfaces:**
- Consumes: `countDiffLines`, `countLines` (parser/diff), `classifyParsedCmdType`, `detectSkills`, `mcpKeyFromFunctionName` (parser/classify), Task 15's state.
- Produces: the remaining spec rows: `item_completed` (UserMessage / AgentMessage / Reasoning / CommandExecution / FileChange / Extension / WebSearch / ImageView / McpToolCall / ContextCompaction / anything else → `other`), legacy `user_message` / `agent_message` counters (used only when item counts are zero), `response_item/function_call` MCP fallback (used only when a file has no `McpToolCall` items), `compacted` lines (`compactions = max(compacted lines, ContextCompaction items)`).

- [ ] **Step 1: Write the failing tests**

`cli/test/parser/session-items.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SessionSummary } from "@codex-kaboo/shared/sync";
import { createReducerState, finalize, reduceLine, type ReducerContext } from "../../src/parser/session";

const TID = "0199a1b2-0000-7000-8000-000000000002";
const T = (s: number): string => new Date(Date.UTC(2026, 7, 30, 17, 0, s)).toISOString();
const line = (type: string, payload: unknown, ts: string): string => JSON.stringify({ timestamp: ts, type, payload });
const item = (it: Record<string, unknown>, s: number): string => line("event_msg", { type: "item_completed", item: it }, T(s));
const meta = line("session_meta", { id: TID, timestamp: T(0), cwd: "/redacted/project-b", originator: "codex-tui", source: "cli", cli_version: "0.150.1" }, T(0));

const ctx: ReducerContext = { sessionId: TID, threadId: TID, rolloutId: null, fileTimestampMs: null, machineZone: "UTC" };
function run(lines: string[]) {
  const state = createReducerState(ctx);
  lines.forEach((text, seq) => reduceLine(state, seq, text));
  return finalize(state, { now: Date.UTC(2026, 7, 30, 18), generation: 0 });
}

const SKILL_PATH = "/Users/me/.codex/skills/.system/openai-docs/SKILL.md";
const DIFF = "@@ -1,3 +1,4 @@\n context\n+added line one\n+added line two\n-removed line\n";

describe("reducer: items", () => {
  it("counts every item type per the allow-list and never copies text", () => {
    const parsed = run([
      meta,
      item({ type: "UserMessage", id: "u1", content: "SECRET prompt" }, 1),
      item({ type: "UserMessage", id: "u2", content: "SECRET prompt" }, 2),
      item({ type: "AgentMessage", id: "a1", content: "SECRET answer", phase: "final" }, 3),
      item({ type: "AgentMessage", id: "a2", content: "SECRET" }, 4),
      item({ type: "AgentMessage", id: "a3", content: "SECRET" }, 5),
      item({ type: "Reasoning", id: "r1", summary_text: "SECRET", raw_content: "SECRET" }, 6),
      item({ type: "Reasoning", id: "r2" }, 7),
      item({ type: "Reasoning", id: "r3" }, 8),
      item({ type: "Reasoning", id: "r4" }, 9),
      item({
        type: "CommandExecution", id: "c1", command: ["cat", SKILL_PATH], cwd: "/redacted/project-b", stdout: "SECRET", stderr: "", aggregated_output: "SECRET",
        parsed_cmd: [{ type: "read", cmd: `cat ${SKILL_PATH}`, path: SKILL_PATH, name: "SKILL.md" }, { type: "search", cmd: "rg SECRET", query: "SECRET", path: "src" }, { type: "list_files", cmd: "ls", path: "." }, { type: "unknown", cmd: "SECRET command" }],
      }, 10),
      item({ type: "CommandExecution", id: "c2", command: ["true"], parsed_cmd: [] }, 11),
      item({ type: "CommandExecution", id: "c3", command: ["type", "C:\\Users\\me\\.codex\\skills\\lark-apps\\SKILL.md"], parsed_cmd: [{ type: "unknown", cmd: "SECRET" }] }, 12),
      item({
        type: "FileChange", id: "f1", status: "completed", stdout: "SECRET",
        changes: {
          "/redacted/project-b/src/a.ts": { type: "update", unified_diff: DIFF, move_path: null },
          "/redacted/project-b/src/new.ts": { type: "add", content: "l1\nl2\nl3\n" },
          "/redacted/project-b/src/old.ts": { type: "delete", content: "x\ny" },
        },
      }, 13),
      item({ type: "Extension", id: "e1", kind: "web.search", query: "SECRET query", results: ["SECRET"] }, 14),
      item({ type: "Extension", id: "e2", kind: "web.search", query: "SECRET" }, 15),
      item({ type: "Extension", id: "e3", kind: "something.else" }, 16),
      item({ type: "WebSearch", id: "w1", query: "SECRET" }, 17),
      item({ type: "ImageView", id: "i1", path: "/redacted/shot.png" }, 18),
      item({ type: "McpToolCall", id: "m1", server: "context7", tool: "query-docs", arguments: { q: "SECRET" } }, 19),
      item({ type: "McpToolCall", id: "m2", server: "context7", tool: "query-docs" }, 20),
      item({ type: "ContextCompaction", id: "cc1" }, 21),
      item({ type: "Plan", id: "p1", text: "SECRET" }, 22),
      line("compacted", { message: "SECRET", replacement_history: ["SECRET"], window_id: 1 }, T(23)),
      line("compacted", { message: "SECRET", window_id: 2 }, T(24)),
      line("response_item", { type: "function_call", name: "mcp__github__list_issues", arguments: "{\"SECRET\":1}", call_id: "x" }, T(25)),
      line("response_item", { type: "custom_tool_call", name: "exec", input: "SECRET" }, T(26)),
      line("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "SECRET" }] }, T(27)),
      line("event_msg", { type: "user_message", message: "SECRET legacy" }, T(28)),
      line("event_msg", { type: "agent_message", message: "SECRET legacy" }, T(29)),
    ]);
    const s = parsed.summary;
    expect(SessionSummary.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({
      userMessages: 2, agentMessages: 3, reasoningItems: 4, filesChanged: 3, linesAdded: 5, linesRemoved: 3, compactions: 2,
      mcpTools: [{ key: "context7/query-docs", count: 2 }],
      skills: [{ key: "lark-apps", count: 1 }, { key: "openai-docs", count: 1 }],
    });
    expect(s.toolCounts).toEqual({
      commandRead: 1, commandList: 1, commandSearch: 1, commandOther: 3, fileChange: 1, webSearch: 3, imageView: 1, mcpTool: 2, other: 2,
    });
    expect(parsed.diagnostics.itemTypes).toMatchObject({ Plan: 1, McpToolCall: 2, Extension: 3 });
    expect(parsed.diagnostics.mcpFallbackUsed).toBe(false);
    const text = JSON.stringify(parsed);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("/redacted");
    expect(text).not.toContain("SKILL.md");
    expect(text).not.toContain("added line");
  });
  it("uses legacy message events only when no message items exist", () => {
    const parsed = run([
      meta,
      line("event_msg", { type: "user_message", message: "SECRET" }, T(1)),
      line("event_msg", { type: "user_message", message: "SECRET" }, T(2)),
      line("event_msg", { type: "user_message", message: "SECRET" }, T(3)),
      line("event_msg", { type: "agent_message", message: "SECRET" }, T(4)),
      line("event_msg", { type: "agent_message", message: "SECRET" }, T(5)),
      line("event_msg", { type: "agent_message", message: "SECRET" }, T(6)),
    ]);
    expect(parsed.summary.userMessages).toBe(3);
    expect(parsed.summary.agentMessages).toBe(3);
  });
  it("falls back to function_call names for MCP usage when no McpToolCall items exist", () => {
    const parsed = run([
      meta,
      line("response_item", { type: "function_call", name: "mcp__github__list_issues", arguments: "{}" }, T(1)),
      line("response_item", { type: "function_call", name: "wait", arguments: "{}" }, T(2)),
      line("response_item", { type: "function_call", name: "exec", arguments: "{}" }, T(3)),
      line("response_item", { type: "function_call", name: "linear__create_issue", arguments: "{}" }, T(4)),
      line("response_item", { type: "function_call", name: "mcp__github__list_issues", arguments: "{}" }, T(5)),
    ]);
    expect(parsed.summary.mcpTools).toEqual([{ key: "github/list_issues", count: 2 }, { key: "linear/create_issue", count: 1 }]);
    expect(parsed.summary.toolCounts.mcpTool).toBe(3);
    expect(parsed.diagnostics.mcpFallbackUsed).toBe(true);
  });
  it("counts a skill once per command item and caps keyed arrays at 64", () => {
    const reads = Array.from({ length: 70 }, (_, i) =>
      item({ type: "CommandExecution", id: `c${i}`, command: ["cat", `/skills/skill-${String(i).padStart(2, "0")}/SKILL.md`], parsed_cmd: [{ type: "read", cmd: "cat", path: `/skills/skill-${String(i).padStart(2, "0")}/SKILL.md`, name: "SKILL.md" }] }, i + 1),
    );
    const parsed = run([meta, ...reads, item({ type: "CommandExecution", id: "again", command: ["cat", "/skills/skill-00/SKILL.md"], parsed_cmd: [] }, 99)]);
    expect(parsed.summary.skills).toHaveLength(64);
    expect(parsed.summary.skills.find((k) => k.key === "skill-00")?.count).toBe(2);
    expect(parsed.summary.skills.find((k) => k.key === "(other)")?.count).toBe(7);
    expect(SessionSummary.safeParse(parsed.summary).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — item counts are 0 / `mcpTools` empty (the new rows are not handled yet).

- [ ] **Step 3: Extend `cli/src/parser/session.ts`**

Add the imports:

```ts
import { countDiffLines, countLines } from "./diff";
import { classifyParsedCmdType, detectSkills, mcpKeyFromFunctionName } from "./classify";
```

(merge the second line into the existing `./classify` import). Replace the `switch` in `reduce` with:

```ts
  switch (line.type) {
    case "session_meta":
      handleSessionMeta(state, payload, ts);
      break;
    case "turn_context":
      handleTurnContext(state, payload);
      break;
    case "event_msg":
      handleEventMsg(state, seq, payload, ts);
      break;
    case "token_usage_record":
      handleUsageRecord(state, seq, payload, ts);
      break;
    case "response_item":
      handleResponseItem(state, payload);
      break;
    case "compacted":
      state.counts.compactedLines += 1;
      break;
    default:
      bump(state.unknownTypes, typeof line.type === "string" ? line.type : "(non-string type)");
  }
```

Add three cases to the `switch (payload.type)` inside `handleEventMsg`, before `default:`:

```ts
    case "item_completed":
      handleItemCompleted(state, payload);
      break;
    case "user_message":
      c.legacyUserMessages += 1;
      break;
    case "agent_message":
      c.legacyAgentMessages += 1;
      break;
```

Append the new handlers (before `mapToKeyCounts`):

```ts
function handleItemCompleted(state: ReducerState, payload: Record<string, unknown>): void {
  const item = asRecord(payload.item);
  if (item === null) {
    state.toolCounts.other += 1;
    return;
  }
  const type = typeof item.type === "string" ? item.type : "(none)";
  bump(state.itemTypes, type);
  const c = state.counts;
  switch (type) {
    case "UserMessage":
      c.userMessages += 1;
      break;
    case "AgentMessage":
      c.agentMessages += 1;
      break;
    case "Reasoning":
      c.reasoningItems += 1;
      break;
    case "CommandExecution":
      handleCommandExecution(state, item);
      break;
    case "FileChange":
      handleFileChange(state, item);
      break;
    case "Extension":
      if (item.kind === "web.search") state.toolCounts.webSearch += 1;
      else state.toolCounts.other += 1;
      break;
    case "WebSearch":
      state.toolCounts.webSearch += 1;
      break;
    case "ImageView":
      state.toolCounts.imageView += 1;
      break;
    case "McpToolCall": {
      state.toolCounts.mcpTool += 1;
      const server = clipString(item.server, 120) ?? "unknown";
      const tool = clipString(item.tool, 120) ?? "unknown";
      bump(state.mcpTools, `${server}/${tool}`);
      break;
    }
    case "ContextCompaction":
      c.contextCompactionItems += 1;
      break;
    default:
      state.toolCounts.other += 1;
  }
}

/** Counts parsed_cmd kinds and detects skills; the command text itself is matched, never stored. */
function handleCommandExecution(state: ReducerState, item: Record<string, unknown>): void {
  const parsed = Array.isArray(item.parsed_cmd) ? item.parsed_cmd : [];
  if (parsed.length === 0) state.toolCounts.commandOther += 1;
  const haystack: unknown[] = [];
  for (const entry of parsed) {
    const record = asRecord(entry);
    state.toolCounts[classifyParsedCmdType(record?.type)] += 1;
    if (record !== null) haystack.push(record.path, record.cmd);
  }
  if (Array.isArray(item.command)) haystack.push(...item.command);
  for (const skill of detectSkills(haystack)) bump(state.skills, skill);
}

function handleFileChange(state: ReducerState, item: Record<string, unknown>): void {
  state.toolCounts.fileChange += 1;
  const changes = asRecord(item.changes) ?? {};
  const c = state.counts;
  c.filesChanged += Object.keys(changes).length;
  for (const change of Object.values(changes)) {
    const record = asRecord(change);
    if (record === null) continue;
    if (record.type === "update") {
      const { added, removed } = countDiffLines(typeof record.unified_diff === "string" ? record.unified_diff : "");
      c.linesAdded += added;
      c.linesRemoved += removed;
    } else if (record.type === "add") {
      c.linesAdded += countLines(typeof record.content === "string" ? record.content : "");
    } else if (record.type === "delete") {
      c.linesRemoved += countLines(typeof record.content === "string" ? record.content : "");
    }
  }
}

/** Only `function_call` names are inspected (MCP fallback); arguments/outputs are never read. */
function handleResponseItem(state: ReducerState, payload: Record<string, unknown>): void {
  if (payload.type !== "function_call") return;
  const key = mcpKeyFromFunctionName(payload.name);
  if (key !== null) bump(state.mcpFallback, key);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS (both session test files). Expected tool counts in the first test: `commandOther: 3` = the `unknown` entry of c1 + the empty `parsed_cmd` of c2 + the `unknown` entry of c3; `webSearch: 3` = two `web.search` extensions + one `WebSearch` item; `other: 2` = the `something.else` extension + the `Plan` item.

- [ ] **Step 5: Commit**

```bash
git add cli/src/parser/session.ts cli/test/parser/session-items.test.ts
git commit -F - <<'MSG'
Complete the session reducer: items, legacy messages, MCP fallback, compactions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 17: `core/parse-file.ts`, fixture scripts, redacted + synthetic fixtures, fixture tests

**Files:**
- Create: `cli/src/core/parse-file.ts`, `cli/scripts/make-fixture.mjs`, `cli/scripts/make-synthetic-fixtures.mjs`
- Create (generated, committed after review): `cli/test/fixtures/codex-home/sessions/2026/08/30/rollout-*.jsonl`, `cli/test/fixtures/codex-home/sessions/2026/08/31/rollout-*_*.jsonl`, `cli/test/fixtures/codex-home/archived_sessions/2026/07/01/rollout-*.jsonl.zst`
- Test: `cli/test/fixture-ids.ts`, `cli/test/fixtures.test.ts`

**The fixtures are the source of truth; the pinned numbers are expectations.** The fixtures are generated once, on this machine, by `cli/scripts/make-fixture.mjs` and `cli/scripts/make-synthetic-fixtures.mjs` (Step 4) from the real rollouts, and are then committed — after that they never change. Every pinned number in Tasks 17, 20, 21 and 23 (line counts, token totals, tool counts, event and response counts) was derived by hand from those real logs and is therefore an *expectation to verify against the generated fixtures*, not a fact about them. When a pinned number disagrees with the fixture, the implementer first re-reads the reduction rule in Tasks 15–16 to confirm the code is right, then recomputes the correct value from the fixture — `node cli/scripts/raw-totals.mjs cli/test/fixtures/codex-home` once Task 26 exists, or an equivalent one-liner over the fixture file (e.g. `node -e '…'` summing `info.last_token_usage`) — corrects the expectation in the test, and records the correction (old value, new value, how it was recomputed) in the task report. A fixture is never edited to match a number, and a failing expectation is never deleted.

**Interfaces:**
- Consumes: `DiscoveredFile`, `discoverRolloutFiles` (core/discover), `readJsonlLines`, `zstdSupported` (core/jsonl-reader), `createReducerState`/`reduceLine`/`finalize` (parser/session), `SessionSummary` (shared).
- Produces: `interface ParseFileOptions { machineZone?: string; now: number; generation: number }`, `interface ParseFileResult { parsed: ParsedSession; read: ReadResult }`, `class InvalidSummaryError extends Error { issues: string[] }`, `parseRolloutFile(file, opts)`; fixture session ids `FX.parent`, `FX.paginatedCli`, `FX.execCompaction`, `FX.legacySubagent`, `FX.paginatedSmall`, `FX.partial`, `FX.corrupt`, `FX.future`, `FX.zst`, `FX.forkedRollout` exported from `cli/test/fixtures.test.ts`'s sibling `cli/test/fixture-ids.ts` (that list is exactly the `FX` object; the forked file has no id of its own — its thread is `FX.corrupt` and its session id is `` `${FX.corrupt}_${FX.forkedRollout}` ``).

- [ ] **Step 1: Write `cli/src/core/parse-file.ts`**

```ts
import { SessionSummary } from "@codex-kaboo/shared/sync";
import { createReducerState, finalize, reduceLine, type ParsedSession } from "../parser/session";
import type { DiscoveredFile } from "./discover";
import { readJsonlLines, type ReadResult } from "./jsonl-reader";

export interface ParseFileOptions {
  machineZone?: string;
  now: number;
  generation: number;
}

export interface ParseFileResult {
  parsed: ParsedSession;
  read: ReadResult;
}

export class InvalidSummaryError extends Error {
  constructor(public readonly issues: string[]) {
    super(`summary failed validation: ${issues.join("; ")}`);
    this.name = "InvalidSummaryError";
  }
}

/** One streaming pass from byte 0: reader → reducer → finalize → schema check. */
export async function parseRolloutFile(file: DiscoveredFile, opts: ParseFileOptions): Promise<ParseFileResult> {
  const state = createReducerState({
    sessionId: file.sessionId,
    threadId: file.threadId,
    rolloutId: file.rolloutId,
    fileTimestampMs: file.fileTimestampMs,
    machineZone: opts.machineZone,
  });
  const read = await readJsonlLines(file.path, (record) => reduceLine(state, record.seq, record.text), {
    compressed: file.compressed,
  });
  const parsed = finalize(state, { now: opts.now, generation: opts.generation });
  const check = SessionSummary.safeParse(parsed.summary);
  if (!check.success) {
    throw new InvalidSummaryError(check.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return { parsed, read };
}
```

- [ ] **Step 2: Write the redaction script `cli/scripts/make-fixture.mjs`**

Rules (spec): structure and numbers are kept; identifiers/enums are kept; `cwd` → `/redacted/project-a`; path-like keys → `/redacted/<n>` unless the basename is `SKILL.md` (then `/redacted/skills/<name>/SKILL.md`, so skill detection still works); `command` elements and `parsed_cmd[].cmd` → `redacted` (or the synthetic SKILL.md path when they reference one); `unified_diff` → synthesized hunks with identical `+`/`-` counts; `content` → `"x\n".repeat(lineCount)`; `changes` object keys → `/redacted/<n>`; the session's own `id`/`session_id`/`parent_thread_id` → the synthetic UUIDs passed on the command line; `name` → kept only outside `parsed_cmd` (so `response_item`/`function_call` MCP names survive) and replaced with `"<r>"` inside `parsed_cmd[]`, where it is a real file basename; payloads of unknown top-level types (`world_state`, …) → `{ "redacted": true }`; every other string → `"<r:len>"`.

```js
#!/usr/bin/env node
// Usage: node cli/scripts/make-fixture.mjs <input.jsonl> <output.jsonl> --uuid <uuid> [--parent <uuid>]
// Rewrites a real Codex rollout into a synthetic fixture: numbers and structure kept, every string
// redacted by key. Review the output (grep for /Users, /home, http, C:\\) before committing it.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const [input, output] = args;
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const uuid = opt("--uuid");
const parentUuid = opt("--parent") ?? "0199f1c0-0000-7000-8000-0000000000a0";
if (!input || !output || !uuid) {
  console.error("usage: make-fixture.mjs <input.jsonl> <output.jsonl> --uuid <uuid> [--parent <uuid>]");
  process.exit(2);
}
if (!fs.existsSync(input)) {
  console.error(`make-fixture: source rollout not found: ${input}`);
  console.error("Substitute any real rollout of the same shape (see the table in Task 17 Step 4: same history_mode/originator and roughly the same size), keep the synthetic UUID, then re-verify every pinned number against the regenerated fixture.");
  process.exit(1);
}

const KNOWN_TYPES = new Set(["session_meta", "turn_context", "event_msg", "response_item", "compacted", "token_usage_record"]);
const KEEP = new Set([
  "type", "turn_id", "call_id", "model", "effort", "originator", "cli_version", "history_mode", "model_provider",
  "thread_source", "timezone", "mode", "kind", "status", "role", "phase", "plan_type", "limit_id", "limit_name",
  "branch", "server", "tool", "timestamp", "current_date", "approval_policy", "rate_limit_reached_type",
  "collaboration_mode_kind", "multi_agent_version", "other", "window_id", "first_window_id", "previous_window_id",
  "window_number", "reasoning_effort", "exit_code", "duration",
]);
// `name` is deliberately absent from KEEP: it is decided by the enclosing key below — kept on a
// payload/item (`response_item`/`function_call` names drive MCP detection), redacted inside
// `parsed_cmd[]`, where it is a real file basename (spec privacy trap).
const PATH_KEYS = new Set(["path", "move_path", "workspace_roots", "writable_roots"]);
const SKILL_RE = /(?:^|[\\/])([^\\/\s"']+)[\\/]SKILL\.md\b/i;
const pathIds = new Map();
let originalId = null;
let originalSessionId = null;

function redactPath(value) {
  const m = SKILL_RE.exec(value);
  if (m) return `/redacted/skills/${m[1]}/SKILL.md`;
  if (!pathIds.has(value)) pathIds.set(value, pathIds.size + 1);
  return `/redacted/${pathIds.get(value)}`;
}

function redactCommandText(value) {
  const m = SKILL_RE.exec(value);
  return m ? `cat /redacted/skills/${m[1]}/SKILL.md` : "redacted";
}

function countLines(content) {
  if (content.length === 0) return 0;
  const parts = content.split("\n").length;
  return content.endsWith("\n") ? parts - 1 : parts;
}

function synthDiff(diff) {
  const hunks = [];
  let current = null;
  for (const raw of diff.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("@@")) {
      current = { added: 0, removed: 0 };
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith("\\")) continue;
    if (line.startsWith("+")) current.added += 1;
    else if (line.startsWith("-")) current.removed += 1;
  }
  return hunks
    .map((h) => `@@ -1,${h.removed} +1,${h.added} @@\n${"+x\n".repeat(h.added)}${"-x\n".repeat(h.removed)}`)
    .join("");
}

function redactString(key, value, parent) {
  if (key === "cwd") return "/redacted/project-a";
  if (PATH_KEYS.has(key)) return redactPath(value);
  if (key === "cmd" || key === "command") return redactCommandText(value);
  if (key === "name") return parent === "parsed_cmd" ? "<r>" : value;
  if (key === "id") return value === originalId ? uuid : value;
  if (key === "session_id") return value === originalId ? uuid : parentUuid;
  if (key === "parent_thread_id") return parentUuid;
  if (key === "unified_diff") return synthDiff(value);
  if (key === "content") return "x\n".repeat(countLines(value));
  if (key === "source" || key === "subagent") return value; // enum-like
  if (KEEP.has(key)) return value;
  return `<r:${value.length}>`;
}

/** `parent` is the key of the enclosing object (or array), so `parsed_cmd[].name` is distinguishable. */
function redact(value, key, parent) {
  if (typeof value === "string") return redactString(key, value, parent);
  if (Array.isArray(value)) return value.map((v) => redact(v, key, parent));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const newKey = key === "changes" ? redactPath(k) : k;
      out[newKey] = redact(v, k, key);
    }
    return out;
  }
  return value; // numbers, booleans, null
}

const text = fs.readFileSync(input, "utf8");
const endsWithNewline = text.endsWith("\n");
const lines = text.split("\n");
if (endsWithNewline) lines.pop();
for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    if (obj.type === "session_meta") {
      originalId = obj.payload?.id ?? null;
      originalSessionId = obj.payload?.session_id ?? null;
    }
  } catch {
    // corrupt lines are copied verbatim below only if they contain no letters
  }
}
if (originalSessionId === null) originalSessionId = originalId;

const outLines = lines.map((line) => {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return "{corrupt line}";
  }
  if (!KNOWN_TYPES.has(obj.type)) return JSON.stringify({ ...obj, payload: { redacted: true } });
  return JSON.stringify(redact(obj, "", ""));
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, outLines.join("\n") + (endsWithNewline ? "\n" : ""));
console.log(`${output}: ${outLines.length} lines, ${pathIds.size} distinct paths redacted`);
```

- [ ] **Step 3: Write the synthetic fixture generator `cli/scripts/make-synthetic-fixtures.mjs`**

```js
#!/usr/bin/env node
// Writes the hand-made fixture sessions (partial trailing line, corrupt line, future types, forked
// filename, zstd-compressed archive) under cli/test/fixtures/codex-home. Deterministic; safe to re-run.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../test/fixtures/codex-home", import.meta.url));
const B1 = "0199f1c0-0000-7000-8000-0000000000b1"; // partial trailing line
const B2 = "0199f1c0-0000-7000-8000-0000000000b2"; // corrupt line (also the forked thread)
const B3 = "0199f1c0-0000-7000-8000-0000000000b3"; // future wire types
const B4 = "0199f1c0-0000-7000-8000-0000000000b4"; // zstd archive
const C1 = "0199f1c0-0000-7000-8000-0000000000c1"; // rollout id of the fork

const at = (y, mo, d, h, mi, s, ms = 0) => Date.UTC(y, mo - 1, d, h, mi, s, ms);
const iso = (t) => new Date(t).toISOString();
const line = (t, type, payload, ordinal) =>
  JSON.stringify(ordinal === undefined ? { timestamp: iso(t), type, payload } : { timestamp: iso(t), ordinal, type, payload });
const usage = (input, cached, output, reasoning) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output,
  reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const meta = (t, id, extra = {}) => ({
  id, timestamp: iso(t), cwd: "/redacted/project-c", originator: "codex-tui", source: "cli", cli_version: "0.150.1",
  history_mode: "paginated", git: { branch: "main" },
  base_instructions: { text: "<r:10>", provenance: { type: "model", model: "gpt-5.6-sol" } }, ...extra,
});
const rateLimits = (used, t) => ({
  primary: { used_percent: used, window_minutes: 10080, resets_at: Math.floor(t / 1000) + 86400 }, secondary: null,
  plan_type: "pro", limit_id: "weekly",
});

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`${rel}: ${Buffer.byteLength(content)} bytes`);
}

// 1. Partial trailing line: four complete lines, then an unterminated fifth line.
{
  const t0 = at(2026, 8, 30, 20, 0, 0);
  const lines = [
    line(t0, "session_meta", meta(t0, B1), 0),
    line(t0 + 1000, "event_msg", { type: "task_started", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1, model_context_window: 272000 }, 1),
    line(t0 + 1500, "turn_context", { turn_id: "t1", model: "gpt-5.6-sol", effort: "medium", timezone: "UTC", collaboration_mode: { mode: "default" } }, 2),
    line(t0 + 2000, "event_msg", { type: "token_count", info: { last_token_usage: usage(1200, 1000, 30, 10), model_context_window: 272000 }, rate_limits: rateLimits(42.5, t0) }, 3),
  ];
  write(`sessions/2026/08/30/rollout-2026-08-30T20-00-00-${B1}.jsonl`, `${lines.join("\n")}\n{"timestamp":"${iso(t0 + 3000)}","ordinal":4,"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50`);
}

// 2. Corrupt line in the middle (counted, skipped) — reused for the forked file.
const corruptLines = (id, t0) => [
  line(t0, "session_meta", meta(t0, id), 0),
  line(t0 + 1000, "event_msg", { type: "task_started", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1 }, 1),
  line(t0 + 1500, "turn_context", { turn_id: "t1", model: "gpt-5.6-luna", effort: "low", timezone: "Asia/Tokyo" }, 2),
  "{not json at all",
  line(t0 + 2000, "event_msg", { type: "token_count", info: { last_token_usage: usage(100, 40, 10, 5) }, rate_limits: rateLimits(50, t0) }, 4),
  line(t0 + 3000, "event_msg", { type: "task_complete", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1, completed_at: Math.floor(t0 / 1000) + 3, duration_ms: 1500, time_to_first_token_ms: 700 }, 5),
];
write(`sessions/2026/08/30/rollout-2026-08-30T21-00-00-${B2}.jsonl`, `${corruptLines(B2, at(2026, 8, 30, 21, 0, 0)).join("\n")}\n`);
write(`sessions/2026/08/31/rollout-2026-08-31T09-00-00-${B2}_${C1}.jsonl`, `${corruptLines(B2, at(2026, 8, 31, 9, 0, 0)).join("\n")}\n`);

// 3. Future wire types: world_state, token_usage_record (wins over token_count), McpToolCall, unknown item and type.
{
  const t0 = at(2026, 8, 30, 22, 0, 0);
  const lines = [
    line(t0, "session_meta", meta(t0, B3, { source: "vscode", originator: "codex-vscode" }), 0),
    line(t0 + 500, "world_state", { redacted: true }, 1),
    line(t0 + 1000, "event_msg", { type: "task_started", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1 }, 2),
    line(t0 + 1500, "turn_context", { turn_id: "t1", model: "gpt-5.7-future", effort: "high", timezone: "Europe/Berlin" }, 3),
    line(t0 + 2000, "event_msg", { type: "token_count", info: { last_token_usage: usage(999, 0, 9, 0) }, rate_limits: null }, 4),
    line(t0 + 2000, "token_usage_record", { turn_id: "t1", usage: usage(300, 100, 20, 5) }, 5),
    line(t0 + 2500, "event_msg", { type: "item_completed", item: { type: "McpToolCall", id: "m1", server: "context7", tool: "query-docs", arguments: { redacted: true } } }, 6),
    line(t0 + 2600, "event_msg", { type: "item_completed", item: { type: "Plan", id: "p1", text: "<r:5>" } }, 7),
    line(t0 + 2700, "response_item", { type: "function_call", name: "mcp__github__list_issues", arguments: "{}", call_id: "c1" }, 8),
    line(t0 + 2800, "inter_agent_communication", { redacted: true }, 9),
    line(t0 + 3000, "event_msg", { type: "task_complete", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1, completed_at: Math.floor(t0 / 1000) + 3, duration_ms: 2000, time_to_first_token_ms: 400 }, 10),
  ];
  write(`sessions/2026/08/30/rollout-2026-08-30T22-00-00-${B3}.jsonl`, `${lines.join("\n")}\n`);
}

// 4. zstd-compressed archived session (only when this Node has zstd; Node >= 22.15).
{
  const t0 = at(2026, 7, 1, 8, 0, 0);
  const lines = [
    line(t0, "session_meta", meta(t0, B4, { originator: "codex_exec", source: "exec" }), 0),
    line(t0 + 1000, "event_msg", { type: "task_started", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1 }, 1),
    line(t0 + 1500, "turn_context", { turn_id: "t1", model: "gpt-5.6-sol", effort: "xhigh", timezone: "UTC" }, 2),
    line(t0 + 2000, "event_msg", { type: "token_count", info: { last_token_usage: usage(10, 0, 1, 0) }, rate_limits: null }, 3),
  ];
  if (typeof zlib.zstdCompressSync === "function") {
    write(`archived_sessions/2026/07/01/rollout-2026-07-01T08-00-00-${B4}.jsonl.zst`, zlib.zstdCompressSync(Buffer.from(`${lines.join("\n")}\n`)));
  } else {
    console.warn("zstd not available in this Node; skipped the .zst fixture");
  }
}
```

- [ ] **Step 4: Generate the fixtures**

Pick the four real rollouts by the last four characters of their thread id (`ls ~/.codex/sessions/*/*/*/ | grep -E '1180|d795|8170|1e6c'`). The mapping below is fixed so the expectations in Step 6 hold:

| real thread id ends with | fixture | synthetic UUID |
|---|---|---|
| `8170` | paginated CLI session (2 turns, 40 FileChanges incl. add/update/delete, ImageView, web.search, skill `lark-apps`) | `0199f1c0-0000-7000-8000-0000000000a1` |
| `1e6c` | exec session with 2 compactions | `0199f1c0-0000-7000-8000-0000000000a2` |
| `d795` | legacy sub-agent (no ordinals, event_msg messages) | `0199f1c0-0000-7000-8000-0000000000a3` (parent `…a0`) |
| `1180` | small paginated CLI session (the smoke reference) | `0199f1c0-0000-7000-8000-0000000000a4` |

```bash
FX=cli/test/fixtures/codex-home/sessions/2026/08/30
mk() {
  src=$(ls ~/.codex/sessions/*/*/*/rollout-*-*"$1".jsonl 2>/dev/null | head -1)
  if [ -z "$src" ]; then
    echo "FIXTURE SOURCE MISSING: no rollout whose thread id ends in '$1' under ~/.codex/sessions." >&2
    echo "Substitute any rollout of the same shape (see the table above for '$1'), keep the synthetic UUID …$3, then re-verify every pinned number in Tasks 17/20/21/23 against the regenerated fixture and record the corrections in the task report." >&2
    return 1
  fi
  node cli/scripts/make-fixture.mjs "$src" "$FX/rollout-2026-08-30T1$2-00-00-0199f1c0-0000-7000-8000-0000000000$3.jsonl" --uuid "0199f1c0-0000-7000-8000-0000000000$3" --parent 0199f1c0-0000-7000-8000-0000000000a0
}
mk 8170 0 a1 && mk 1e6c 1 a2 && mk d795 2 a3 && mk 1180 3 a4 && node cli/scripts/make-synthetic-fixtures.mjs
echo "generation exit=$?"
```

Expected: four `… lines, N distinct paths redacted` lines (805, 575, 13 and 159 lines respectively), five synthetic files and `generation exit=0`. The chain stops at the first missing source: `mk` returns non-zero with the `FIXTURE SOURCE MISSING` message above, and `make-fixture.mjs` itself exits 1 with the same instruction if the path it is handed does not exist — never continue with a partially generated fixture set. If a real file id has changed on this machine, substitute the file with the matching line count, keep the same synthetic UUID, and treat the Step 6 numbers as expectations to re-derive (see the note at the top of this task).

- [ ] **Step 5: Review the fixtures for leaks (mandatory before committing)**

```bash
# absolute home paths, URLs, the internal domain and e-mail addresses. NOT a bare `@`:
# `synthDiff` writes `@@ … @@` hunk headers, so a bare `@` would make this gate unpassable.
grep -rlE '/Users/|/home/|C:\\\\|https?://|\.bytedance|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' cli/test/fixtures/codex-home --include='*.jsonl' ; echo "exit=$?"
grep -rhoE '"(cwd|path|move_path|cmd|command|stdout|stderr|aggregated_output|formatted_output|message|text|query|arguments|input|unified_diff|content|last_agent_message|developer_instructions|repository_url|raw_content|summary_text)":"[^"]{0,60}' cli/test/fixtures/codex-home --include='*.jsonl' | sort | uniq -c | sort -rn | head -40
for f in cli/test/fixtures/codex-home/sessions/2026/08/30/rollout-*-0199f1c0-0000-7000-8000-0000000000a?.jsonl; do echo "== $f"; head -c 400 "$f"; echo; done
```

Expected: the first grep prints no file names and `exit=1` (the `@@` hunk headers written by `synthDiff` must not match it — if they do, the pattern was mistyped). The second prints only values that are `/redacted/…`, `redacted`, `cat /redacted/skills/<name>/SKILL.md`, `<r:N>`, `<r>`, `x\n…`, `@@ -1,N +1,M @@…` or empty. Also check that no real basename survived in `parsed_cmd`: `grep -rhoE '"name":"[^"]*"' cli/test/fixtures/codex-home --include='*.jsonl' | sort -u` must print only `"<r>"` and MCP/function-call names (`mcp__…`, `shell`, `apply_patch`, …). Read the `head` output of each redacted file and confirm nothing recognisable remains. Only then continue.

- [ ] **Step 6: Write the fixture ids and tests**

`cli/test/fixture-ids.ts`:

```ts
import { fileURLToPath } from "node:url";

export const FIXTURE_HOME = fileURLToPath(new URL("fixtures/codex-home", import.meta.url));

export const FX = {
  parent: "0199f1c0-0000-7000-8000-0000000000a0",
  paginatedCli: "0199f1c0-0000-7000-8000-0000000000a1",
  execCompaction: "0199f1c0-0000-7000-8000-0000000000a2",
  legacySubagent: "0199f1c0-0000-7000-8000-0000000000a3",
  paginatedSmall: "0199f1c0-0000-7000-8000-0000000000a4",
  partial: "0199f1c0-0000-7000-8000-0000000000b1",
  corrupt: "0199f1c0-0000-7000-8000-0000000000b2",
  future: "0199f1c0-0000-7000-8000-0000000000b3",
  zst: "0199f1c0-0000-7000-8000-0000000000b4",
  forkedRollout: "0199f1c0-0000-7000-8000-0000000000c1",
} as const;
```

`cli/test/fixtures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SessionSummary, TokenEvent } from "@codex-kaboo/shared/sync";
import { discoverRolloutFiles, type DiscoveredFile } from "../src/core/discover";
import { zstdSupported } from "../src/core/jsonl-reader";
import { parseRolloutFile } from "../src/core/parse-file";
import { FIXTURE_HOME, FX } from "./fixture-ids";

const NOW = Date.UTC(2026, 8, 1, 12);

async function files(): Promise<Map<string, DiscoveredFile>> {
  const result = await discoverRolloutFiles([FIXTURE_HOME]);
  return new Map(result.files.map((f) => [f.sessionId, f]));
}

async function parse(sessionId: string) {
  const file = (await files()).get(sessionId);
  if (!file) throw new Error(`fixture ${sessionId} not found`);
  return parseRolloutFile(file, { machineZone: "UTC", now: NOW, generation: 0 });
}

describe("fixtures", () => {
  it("discovers every fixture file", async () => {
    const all = await files();
    const expected = [FX.paginatedCli, FX.execCompaction, FX.legacySubagent, FX.paginatedSmall, FX.partial, FX.corrupt, FX.future, `${FX.corrupt}_${FX.forkedRollout}`];
    if (zstdSupported()) expected.push(FX.zst);
    for (const id of expected) expect(all.has(id), id).toBe(true);
  });
  it("parses the small paginated CLI session (smoke reference)", async () => {
    const { parsed, read } = await parse(FX.paginatedSmall);
    expect(read).toMatchObject({ lines: 159, partial: false });
    const s = parsed.summary;
    expect(SessionSummary.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({
      sessionId: FX.paginatedSmall, threadId: FX.paginatedSmall, project: "project-a", source: "cli", originator: "codex-tui",
      isSubagent: false, model: "gpt-5.6-sol", effort: "xhigh", cliVersion: "0.150.1", turns: 1, completedTurns: 1,
      userMessages: 1, agentMessages: 4, reasoningItems: 26, filesChanged: 1, linesAdded: 4, linesRemoved: 0,
      compactions: 0, activeMs: 258435, responses: 23, lineCount: 159, parseErrors: 0, wallMs: 739002,
      skills: [{ key: "openai-docs", count: 1 }], mcpTools: [],
    });
    expect(s.gitBranch).toBeDefined();
    expect(s.toolCounts).toEqual({ commandRead: 1, commandList: 1, commandSearch: 2, commandOther: 6, fileChange: 1, webSearch: 11, imageView: 0, mcpTool: 0, other: 0 });
    expect(s.tokens).toEqual({ input: 1437354, cachedInput: 1344768, cacheWrite: 0, output: 6554, reasoning: 3999, total: 1443908 });
    expect(s.ttft).toMatchObject({ count: 1, sumMs: 4200 });
    expect(parsed.events).toHaveLength(23);
    expect(parsed.events.every((e) => TokenEvent.safeParse(e).success && e.model === "gpt-5.6-sol" && e.effort === "xhigh")).toBe(true);
    expect(parsed.rateLimit).not.toBeNull();
    expect(parsed.rateLimit?.windowMinutes).toBe(10080);
  });
  it("parses the large paginated CLI session with file changes, images and skills", async () => {
    const { parsed } = await parse(FX.paginatedCli);
    const s = parsed.summary;
    expect(s).toMatchObject({
      turns: 2, completedTurns: 2, userMessages: 1, agentMessages: 8, reasoningItems: 144, filesChanged: 60,
      linesAdded: 5287, linesRemoved: 269, compactions: 0, activeMs: 2785597, responses: 127, lineCount: 805, wallMs: 2900244,
      skills: [{ key: "lark-apps", count: 3 }], source: "cli", originator: "codex-tui",
    });
    expect(s.gitBranch).toBeUndefined();
    expect(s.toolCounts).toEqual({ commandRead: 13, commandList: 0, commandSearch: 3, commandOther: 51, fileChange: 40, webSearch: 2, imageView: 4, mcpTool: 0, other: 0 });
    expect(s.tokens).toMatchObject({ input: 15813051, cachedInput: 15555200, output: 117860, reasoning: 20997 });
    expect(s.ttft).toMatchObject({ count: 2, sumMs: 14647 });
  });
  it("parses the exec session with two compactions", async () => {
    const { parsed } = await parse(FX.execCompaction);
    const s = parsed.summary;
    expect(s).toMatchObject({
      source: "exec", originator: "codex_exec", turns: 1, completedTurns: 1, userMessages: 1, agentMessages: 9, reasoningItems: 100,
      compactions: 2, activeMs: 1371829, responses: 88, lineCount: 575, skills: [], filesChanged: 0,
    });
    expect(s.toolCounts).toMatchObject({ commandRead: 195, commandList: 5, commandSearch: 14, commandOther: 6, webSearch: 0 });
    expect(s.tokens).toMatchObject({ input: 9504671, cachedInput: 8902144, output: 49444, reasoning: 19688 });
    expect(s.ttft).toMatchObject({ count: 1, sumMs: 6911 });
  });
  it("parses the legacy sub-agent file (no ordinals, event_msg messages)", async () => {
    const { parsed } = await parse(FX.legacySubagent);
    const s = parsed.summary;
    expect(s).toMatchObject({
      sessionId: FX.legacySubagent, parentThreadId: FX.parent, isSubagent: true, source: "subagent:guardian", originator: "codex_exec",
      model: "codex-auto-review", effort: "low", turns: 1, completedTurns: 1, userMessages: 1, agentMessages: 1, responses: 1,
      lineCount: 13, activeMs: 6033, wallMs: 790007,
    });
    expect(s.tokens).toEqual({ input: 7600, cachedInput: 4864, cacheWrite: 0, output: 273, reasoning: 215, total: 7873 });
    expect(s.ttft).toMatchObject({ count: 1, sumMs: 5040 });
    expect(parsed.events[0]).toMatchObject({ isSubagent: true, model: "codex-auto-review", effort: "low" });
  });
  it("ignores a trailing partial line and counts a corrupt line", async () => {
    const partial = await parse(FX.partial);
    expect(partial.read).toMatchObject({ lines: 4, partial: true });
    expect(partial.parsed.summary).toMatchObject({ responses: 1, turns: 1, completedTurns: 0, inProgress: true, lineCount: 4, parseErrors: 0 });
    expect(partial.parsed.rateLimit?.usedPercent).toBe(42.5);
    const corrupt = await parse(FX.corrupt);
    expect(corrupt.parsed.summary).toMatchObject({ lineCount: 6, parseErrors: 1, responses: 1, turns: 1, completedTurns: 1, activeMs: 1500, model: "gpt-5.6-luna", timezone: "Asia/Tokyo" });
    expect(corrupt.parsed.summary.ttft).toMatchObject({ count: 1, sumMs: 700 });
  });
  it("tolerates future wire types and prefers token_usage_record", async () => {
    const { parsed } = await parse(FX.future);
    expect(parsed.summary).toMatchObject({ source: "vscode", model: "gpt-5.7-future", responses: 1, mcpTools: [{ key: "context7/query-docs", count: 1 }] });
    expect(parsed.summary.toolCounts).toMatchObject({ mcpTool: 1, other: 1 });
    expect(parsed.summary.tokens).toMatchObject({ input: 300, cachedInput: 100, output: 20, reasoning: 5, total: 320 });
    expect(parsed.diagnostics.unknownTypes).toMatchObject({ world_state: 1, inter_agent_communication: 1 });
    expect(parsed.diagnostics.mcpFallbackUsed).toBe(false);
  });
  it("derives the session id of a forked rollout from the filename", async () => {
    const forked = await parse(`${FX.corrupt}_${FX.forkedRollout}`);
    expect(forked.parsed.summary.sessionId).toBe(`${FX.corrupt}_${FX.forkedRollout}`);
    expect(forked.parsed.summary.threadId).toBe(FX.corrupt);
    expect(forked.parsed.events[0]?.sessionId).toBe(`${FX.corrupt}_${FX.forkedRollout}`);
  });
  it.skipIf(!zstdSupported())("parses the zstd-compressed archived session", async () => {
    const { parsed, read } = await parse(FX.zst);
    expect(read.tail).toBe("");
    expect(parsed.summary).toMatchObject({ sessionId: FX.zst, source: "exec", responses: 1, lineCount: 4 });
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS. If a pinned number disagrees, follow the rule at the top of this task: check the reduction rule in Tasks 15–16 against the spec table (the numbers above were derived with those exact rules from the real files) and the fixture generation mapping; when the code applies the rule as written, recompute the value from the committed fixture, correct the expectation, and record the correction in the task report. Fix the code when the rule was misread; never edit a fixture to match a number.

- [ ] **Step 8: Commit**

```bash
git add cli/src/core/parse-file.ts cli/scripts cli/test/fixtures cli/test/fixture-ids.ts cli/test/fixtures.test.ts
git commit -F - <<'MSG'
Add rollout file parsing, fixture generators and redacted fixtures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 18: `upload/batch.ts` — chunk uploads into request-sized batches

**Files:**
- Create: `cli/src/upload/batch.ts`
- Test: `cli/test/upload/batch.test.ts`

**Interfaces:**
- Consumes: shared constants `CLI_BATCH_MAX_EVENTS`, `CLI_BATCH_MAX_BYTES`, `MAX_SESSIONS_PER_REQUEST`; types `SessionSummary`, `TokenEvent`.
- Produces: `interface FileUpload { sessionId: string; summary: SessionSummary; events: TokenEvent[]; summaryChanged: boolean }`, `interface BatchFileEntry { sessionId: string; lastSeq: number; final: boolean }`, `interface Batch { sessions: SessionSummary[]; tokenEvents: TokenEvent[]; files: BatchFileEntry[] }`, `interface BatchLimits { maxEvents; maxBytes; maxSessions }`, `DEFAULT_BATCH_LIMITS`, `buildBatches(uploads, limits?)`, `applyAck(uploads, batch)` → remaining uploads, `eventBytes(event)`, `summaryBytes(summary)`.

Semantics: files are processed in order; each file's new events (sorted by `seq`) are appended to the current batch until `maxEvents` or `maxBytes` would be exceeded; a file's summary rides in the batch that carries its last events (`final: true`); when a file is cut, its entry is `final: false` with the highest `seq` shipped and the batch is flushed; files with no new events ship a summary-only entry (`lastSeq: -1`) only when `summaryChanged`; small files coalesce into one request; a single event larger than `maxBytes` still ships alone.

- [ ] **Step 1: Write the failing tests**

`cli/test/upload/batch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeEvent, makeSummary } from "@codex-kaboo/shared/test-fixtures";
import { applyAck, buildBatches, eventBytes, type FileUpload } from "../../src/upload/batch";

function upload(sessionId: string, seqs: number[], summaryChanged = true): FileUpload {
  return { sessionId, summary: makeSummary({ sessionId, threadId: sessionId }), events: seqs.map((seq) => makeEvent({ sessionId, seq })), summaryChanged };
}
const LIMITS = { maxEvents: 1000, maxBytes: 3_500_000, maxSessions: 500 };

describe("buildBatches", () => {
  it("coalesces small files into one batch with final entries", () => {
    const batches = buildBatches([upload("a", [3, 1, 2]), upload("b", [7]), upload("c", [], true), upload("d", [], false)], LIMITS);
    expect(batches).toHaveLength(1);
    const b = batches[0]!;
    expect(b.sessions.map((s) => s.sessionId)).toEqual(["a", "b", "c"]);
    expect(b.tokenEvents.map((e) => `${e.sessionId}:${e.seq}`)).toEqual(["a:1", "a:2", "a:3", "b:7"]);
    expect(b.files).toEqual([
      { sessionId: "a", lastSeq: 3, final: true },
      { sessionId: "b", lastSeq: 7, final: true },
      { sessionId: "c", lastSeq: -1, final: true },
    ]);
  });
  it("splits a big file by maxEvents and ships the summary with the last chunk", () => {
    const seqs = Array.from({ length: 2500 }, (_, i) => i);
    const batches = buildBatches([upload("big", seqs), upload("tiny", [0])], LIMITS);
    expect(batches.map((b) => b.tokenEvents.length)).toEqual([1000, 1000, 501]);
    expect(batches[0]!.files).toEqual([{ sessionId: "big", lastSeq: 999, final: false }]);
    expect(batches[0]!.sessions).toEqual([]);
    expect(batches[1]!.files).toEqual([{ sessionId: "big", lastSeq: 1999, final: false }]);
    expect(batches[2]!.files).toEqual([
      { sessionId: "big", lastSeq: 2499, final: true },
      { sessionId: "tiny", lastSeq: 0, final: true },
    ]);
    expect(batches[2]!.sessions.map((s) => s.sessionId)).toEqual(["big", "tiny"]);
  });
  it("splits by bytes and never loops on an oversize event", () => {
    const events = [0, 1, 2, 3].map((seq) => makeEvent({ sessionId: "x", seq }));
    const perEvent = eventBytes(events[0]!);
    const batches = buildBatches([{ sessionId: "x", summary: makeSummary({ sessionId: "x" }), events, summaryChanged: true }], { maxEvents: 1000, maxBytes: perEvent * 2 + 10, maxSessions: 500 });
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches.flatMap((b) => b.tokenEvents.map((e) => e.seq))).toEqual([0, 1, 2, 3]);
    expect(batches[batches.length - 1]!.files.some((f) => f.sessionId === "x" && f.final)).toBe(true);
    const single = buildBatches([{ sessionId: "y", summary: makeSummary({ sessionId: "y" }), events: [makeEvent({ sessionId: "y", seq: 0 })], summaryChanged: true }], { maxEvents: 1000, maxBytes: 10, maxSessions: 500 });
    expect(single.flatMap((b) => b.tokenEvents)).toHaveLength(1);
  });
  it("respects maxSessions", () => {
    const uploads = Array.from({ length: 3 }, (_, i) => upload(`s${i}`, [0]));
    const batches = buildBatches(uploads, { maxEvents: 1000, maxBytes: 3_500_000, maxSessions: 2 });
    expect(batches.map((b) => b.sessions.length)).toEqual([2, 1]);
  });
});

describe("applyAck", () => {
  it("drops finished files and trims acknowledged events", () => {
    const uploads = [upload("a", [0, 1, 2]), upload("b", [5, 6])];
    const remaining = applyAck(uploads, { sessions: [], tokenEvents: [], files: [{ sessionId: "a", lastSeq: 1, final: false }, { sessionId: "b", lastSeq: 6, final: true }] });
    expect(remaining.map((u) => [u.sessionId, u.events.map((e) => e.seq)])).toEqual([["a", [2]]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/upload/batch`.

- [ ] **Step 3: Write `cli/src/upload/batch.ts`**

```ts
import { CLI_BATCH_MAX_BYTES, CLI_BATCH_MAX_EVENTS, MAX_SESSIONS_PER_REQUEST } from "@codex-kaboo/shared/constants";
import type { SessionSummary, TokenEvent } from "@codex-kaboo/shared/sync";

export interface FileUpload {
  sessionId: string;
  summary: SessionSummary;
  events: TokenEvent[]; // only events not yet acknowledged
  summaryChanged: boolean;
}

export interface BatchFileEntry {
  sessionId: string;
  lastSeq: number; // highest seq shipped in this batch, -1 when none
  final: boolean; // the summary rides in this batch
}

export interface Batch {
  sessions: SessionSummary[];
  tokenEvents: TokenEvent[];
  files: BatchFileEntry[];
}

export interface BatchLimits {
  maxEvents: number;
  maxBytes: number;
  maxSessions: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = {
  maxEvents: CLI_BATCH_MAX_EVENTS,
  maxBytes: CLI_BATCH_MAX_BYTES,
  maxSessions: MAX_SESSIONS_PER_REQUEST,
};

export function eventBytes(event: TokenEvent): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
}

export function summaryBytes(summary: SessionSummary): number {
  return Buffer.byteLength(JSON.stringify(summary), "utf8") + 1;
}

function newBatch(): Batch {
  return { sessions: [], tokenEvents: [], files: [] };
}

export function buildBatches(uploads: FileUpload[], limits: BatchLimits = DEFAULT_BATCH_LIMITS): Batch[] {
  const batches: Batch[] = [];
  let current = newBatch();
  let bytes = 0;
  const isEmpty = (): boolean => current.files.length === 0 && current.tokenEvents.length === 0;
  const flush = (): void => {
    if (!isEmpty()) batches.push(current);
    current = newBatch();
    bytes = 0;
  };
  const pushSummary = (upload: FileUpload, lastSeq: number): void => {
    const size = summaryBytes(upload.summary);
    if (!isEmpty() && (bytes + size > limits.maxBytes || current.sessions.length >= limits.maxSessions)) {
      if (lastSeq >= 0) current.files.push({ sessionId: upload.sessionId, lastSeq, final: false });
      flush();
    }
    current.sessions.push(upload.summary);
    current.files.push({ sessionId: upload.sessionId, lastSeq, final: true });
    bytes += size;
  };

  for (const upload of uploads) {
    const events = [...upload.events].sort((a, b) => a.seq - b.seq);
    if (events.length === 0) {
      if (upload.summaryChanged) pushSummary(upload, -1);
      continue;
    }
    let i = 0;
    while (i < events.length) {
      const start = i;
      while (i < events.length) {
        const event = events[i]!;
        const size = eventBytes(event);
        const fits = current.tokenEvents.length < limits.maxEvents && bytes + size <= limits.maxBytes;
        if (!fits && !isEmpty()) break;
        current.tokenEvents.push(event); // an oversize event still ships alone in an empty batch
        bytes += size;
        i += 1;
        if (!fits) break;
      }
      if (i === start) {
        flush();
        continue;
      }
      const lastSeq = events[i - 1]!.seq;
      if (i >= events.length) {
        pushSummary(upload, lastSeq);
      } else {
        current.files.push({ sessionId: upload.sessionId, lastSeq, final: false });
        flush();
      }
    }
  }
  flush();
  return batches;
}

/** After a batch is acknowledged: drop finished files, trim shipped events from the rest. */
export function applyAck(uploads: FileUpload[], batch: Batch): FileUpload[] {
  const acked = new Map(batch.files.map((f) => [f.sessionId, f]));
  const remaining: FileUpload[] = [];
  for (const upload of uploads) {
    const entry = acked.get(upload.sessionId);
    if (!entry) {
      remaining.push(upload);
      continue;
    }
    if (entry.final) continue;
    remaining.push({ ...upload, events: upload.events.filter((e) => e.seq > entry.lastSeq) });
  }
  return remaining;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/upload/batch.ts cli/test/upload/batch.test.ts
git commit -F - <<'MSG'
Add upload batching by event count and serialized size

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 19: `upload/client.ts` — HTTP client with retries

**Files:**
- Create: `cli/src/upload/client.ts`
- Test: `cli/test/upload/client.test.ts`

**Interfaces:**
- Consumes: shared constants (`SYNC_PATH`, `WHOAMI_PATH`, `HEALTH_PATH`, `CLI_VERSION_HEADER`), schemas `SyncResponse`, `ErrorResponse`, `WhoamiResponse`, type `SyncBatch`.
- Produces: `type FetchLike`, `interface ClientOptions { server; token; cliVersion; fetch?; sleep?; timeoutMs?; maxAttempts?; random?; now? }`, `class SyncHttpError { status; code; body; retryAfterMs }`, `class SyncNetworkError { cause }`, `isAuthError(e)`, `isPayloadTooLarge(e)`, `isBadRequest(e)`, `backoffMs(attempt, random)`, `parseRetryAfter(header, now)`, `interface SyncClient { sync(batch): Promise<SyncResponse>; whoami(): Promise<WhoamiResponse>; health(): Promise<{ ok: boolean; serverTime: number | null }> }`, `createClient(opts)`.

Policy (spec): `fetch` + `AbortSignal.timeout(30 s)`; up to 6 attempts (5 retries) with delays 1/2/4/8/16 s ± 25 % jitter, honouring `Retry-After`, on network errors and 408/425/429/5xx; 401/403, 413, 400/422 and every other 4xx throw immediately without retrying.

- [ ] **Step 1: Write the failing tests**

`cli/test/upload/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeBatch } from "@codex-kaboo/shared/test-fixtures";
import {
  backoffMs, createClient, isAuthError, isBadRequest, isPayloadTooLarge, parseRetryAfter, SyncHttpError, SyncNetworkError,
} from "../../src/upload/client";

const okBody = {
  ok: true,
  accepted: { sessions: { inserted: 1, updated: 0, unchanged: 0 }, events: { inserted: 1, updated: 0, unchanged: 0 } },
  conflicts: { sessions: [], events: 0 },
  serverTime: 1,
  latestCliVersion: "0.2.0",
  limits: { maxBodyBytes: 8388608, maxSessions: 500, maxEvents: 5000 },
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function stub(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    if (next instanceof Error) throw next;
    return next;
  };
  const client = createClient({
    server: "https://x.convex.site", token: "ck_abc", cliVersion: "0.1.0", fetch, sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0.5, now: () => 1_000_000,
  });
  return { client, calls, sleeps };
}

describe("createClient.sync", () => {
  it("posts the batch with auth and version headers and parses the response", async () => {
    const { client, calls } = stub([json(200, okBody)]);
    const res = await client.sync({ ...makeBatch(), batchId: "b1" });
    expect(res.latestCliVersion).toBe("0.2.0");
    expect(calls[0]?.url).toBe("https://x.convex.site/api/v1/sync");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ck_abc");
    expect(headers["X-Codex-Kaboo-Cli"]).toBe("0.1.0");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init.body)).batchId).toBe("b1");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });
  it("retries 5xx/429 with backoff and Retry-After, then succeeds", async () => {
    const { client, calls, sleeps } = stub([json(503, { ok: false, error: "internal" }, { "Retry-After": "2" }), json(429, { ok: false, error: "x" }), json(200, okBody)]);
    await client.sync(makeBatch());
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]); // Retry-After 2 s, then attempt-2 backoff 2000 ms (jitter 0 with random 0.5)
  });
  it("does not retry 401, 413 or 400 and classifies them", async () => {
    const u = stub([json(401, { ok: false, error: "token_revoked" })]);
    const e1 = await u.client.sync(makeBatch()).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(SyncHttpError);
    expect((e1 as SyncHttpError).status).toBe(401);
    expect((e1 as SyncHttpError).code).toBe("token_revoked");
    expect(isAuthError(e1)).toBe(true);
    expect(u.calls).toHaveLength(1);
    const p = stub([json(413, { ok: false, error: "too_many_items", limits: { maxBodyBytes: 1, maxSessions: 1, maxEvents: 100 } })]);
    const e2 = await p.client.sync(makeBatch()).catch((e: unknown) => e);
    expect(isPayloadTooLarge(e2)).toBe(true);
    expect((e2 as SyncHttpError).body?.limits?.maxEvents).toBe(100);
    const b = stub([json(400, { ok: false, error: "invalid_batch", issues: [{ path: "sessions.0.day", message: "bad" }] })]);
    const e3 = await b.client.sync(makeBatch()).catch((e: unknown) => e);
    expect(isBadRequest(e3)).toBe(true);
    expect((e3 as SyncHttpError).message).toContain("sessions.0.day");
  });
  it("gives up after five network failures", async () => {
    const { client, calls, sleeps } = stub([new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET")]);
    await expect(client.sync(makeBatch())).rejects.toBeInstanceOf(SyncNetworkError);
    expect(calls).toHaveLength(5);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
  });
  it("rejects a malformed success body", async () => {
    const { client } = stub([json(200, { ok: true, nope: 1 })]);
    const e = await client.sync(makeBatch()).catch((x: unknown) => x);
    expect((e as SyncHttpError).code).toBe("invalid_response");
  });
});

describe("whoami / health", () => {
  it("parses whoami and health", async () => {
    const { client, calls } = stub([json(200, { ok: true, userId: "u1", name: "Ada", email: null, token: { name: "mac", prefix: "ck_abc" }, serverTime: 5 }), json(200, { ok: true, serverTime: 6 })]);
    expect((await client.whoami()).userId).toBe("u1");
    expect(calls[0]?.url).toBe("https://x.convex.site/api/v1/whoami");
    expect(calls[0]?.init.method).toBe("GET");
    expect(await client.health()).toEqual({ ok: true, serverTime: 6 });
  });
});

describe("helpers", () => {
  it("computes jittered backoff and Retry-After", () => {
    expect(backoffMs(1, () => 0.5)).toBe(1000);
    expect(backoffMs(1, () => 0)).toBe(750);
    expect(backoffMs(3, () => 1)).toBe(5000);
    expect(parseRetryAfter("3", 0)).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(parseRetryAfter("garbage", 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/upload/client`.

- [ ] **Step 3: Write `cli/src/upload/client.ts`**

```ts
import { CLI_VERSION_HEADER, HEALTH_PATH, SYNC_PATH, WHOAMI_PATH } from "@codex-kaboo/shared/constants";
import { ErrorResponse, SyncResponse, WhoamiResponse, type SyncBatch } from "@codex-kaboo/shared/sync";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  server: string;
  token: string;
  cliVersion: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  random?: () => number;
  now?: () => number;
}

export interface SyncClient {
  sync(batch: SyncBatch): Promise<SyncResponse>;
  whoami(): Promise<WhoamiResponse>;
  health(): Promise<{ ok: boolean; serverTime: number | null }>;
}

export class SyncHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body: ErrorResponse | null,
    public readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "SyncHttpError";
  }
}

export class SyncNetworkError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message);
    this.name = "SyncNetworkError";
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof SyncHttpError && (error.status === 401 || error.status === 403);
}

export function isPayloadTooLarge(error: unknown): boolean {
  return error instanceof SyncHttpError && error.status === 413;
}

export function isBadRequest(error: unknown): boolean {
  return error instanceof SyncHttpError && (error.status === 400 || error.status === 422);
}

/** 1 s, 2 s, 4 s, 8 s, 16 s ± 25 % jitter. */
export function backoffMs(attempt: number, random: () => number): number {
  const base = 1000 * 2 ** Math.max(0, attempt - 1);
  const jitter = (random() * 2 - 1) * 0.25;
  return Math.round(base * (1 + jitter));
}

export function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

const RETRYABLE = new Set([408, 425, 429]);

function describeError(body: ErrorResponse | null, status: number): string {
  if (!body) return `HTTP ${status}`;
  const issues = body.issues?.map((i) => `${i.path}: ${i.message}`).join("; ");
  return `${body.error}${body.message ? `: ${body.message}` : ""}${issues ? ` (${issues})` : ""} [HTTP ${status}]`;
}

export function createClient(opts: ClientOptions): SyncClient {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxAttempts = opts.maxAttempts ?? 5;
  const random = opts.random ?? Math.random;
  const now = opts.now ?? (() => Date.now());
  const base = opts.server.replace(/\/+$/, "");

  async function request(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await doFetch(`${base}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${opts.token}`,
            [CLI_VERSION_HEADER]: opts.cliVersion,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = new SyncNetworkError(`network error: ${error instanceof Error ? error.message : String(error)}`, error);
        if (attempt < maxAttempts) await sleep(backoffMs(attempt, random));
        continue;
      }
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (response.status >= 200 && response.status < 300) return parsed;
      const errorBody = ErrorResponse.safeParse(parsed);
      const bodyOrNull = errorBody.success ? errorBody.data : null;
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), now());
      const httpError = new SyncHttpError(response.status, bodyOrNull?.error ?? `http_${response.status}`, describeError(bodyOrNull, response.status), bodyOrNull, retryAfterMs);
      if (response.status >= 500 || RETRYABLE.has(response.status)) {
        lastError = httpError;
        if (attempt < maxAttempts) await sleep(retryAfterMs ?? backoffMs(attempt, random));
        continue;
      }
      throw httpError;
    }
    throw lastError instanceof Error ? lastError : new SyncNetworkError("request failed", lastError);
  }

  return {
    async sync(batch) {
      const parsed = SyncResponse.safeParse(await request(SYNC_PATH, "POST", batch));
      if (!parsed.success) throw new SyncHttpError(200, "invalid_response", "server returned an unexpected sync response", null, null);
      return parsed.data;
    },
    async whoami() {
      const parsed = WhoamiResponse.safeParse(await request(WHOAMI_PATH, "GET"));
      if (!parsed.success) throw new SyncHttpError(200, "invalid_response", "server returned an unexpected whoami response", null, null);
      return parsed.data;
    },
    async health() {
      const raw = (await request(HEALTH_PATH, "GET")) as { ok?: unknown; serverTime?: unknown } | null;
      return { ok: raw?.ok === true, serverTime: typeof raw?.serverTime === "number" ? raw.serverTime : null };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/upload/client.ts cli/test/upload/client.test.ts
git commit -F - <<'MSG'
Add sync HTTP client with retries, backoff and error classification

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 20: `commands/sync-plan.ts` — decide, parse and prepare uploads (no network)

**Files:**
- Create: `cli/src/commands/sync-plan.ts`
- Test: `cli/test/commands/sync-plan.test.ts`

**Interfaces:**
- Consumes: `discoverRolloutFiles`, `DiscoveredFile` (core/discover); `zstdSupported` (core/jsonl-reader); `parseRolloutFile` (core/parse-file); `detectReset`, `isUnchanged`, `resetFileState`, `emptyFileState` (core/state); `newestVersion` (util/version); `FileUpload`, `Batch` (upload/batch); types `Config`, `FileState`, `SyncState`; shared `MachineInfo`, `RateLimitSnapshot`, `SyncBatch`, constants.
- Produces: `type FileAction = "unchanged" | "parsed" | "reset" | "skipped" | "error"`, `interface PlannedFile { file; prev; next: FileState; upload: FileUpload | null; summaryHash: string; action; reason?; rateLimit; codexVersion?; diagnostics? }`, `interface SyncPlan { homes; truncated; files: PlannedFile[]; uploads: FileUpload[]; rateLimit; codexVersion: string | null; codexLatestVersion: string | undefined; warnings: string[]; errors: string[]; budgetExhausted: boolean }`, `interface PlanOptions { full: boolean; codexHome?: string }`, `interface PlanDeps { env; now; log; machineZone; budgetMs?; startedAt? }`, `planSync(state, homes, opts, deps)`, `readCodexLatestVersion(homes)`, `buildMachineInfo(input)`, `toSyncBatch(batch, machine, meta)`.

Decision order per discovered file (spec "Per run"): moved file → keep progress under the same sessionId; `complete` (immutable `.zst` already processed) → unchanged; > 256 MB → skipped with a warning; `.zst` without zstd → skipped with a one-time warning; same size + mtime as last time (and no recorded error) → unchanged without reading; shrunk or tail mismatch → reset (`offset 0`, `generation + 1`, warning); run budget exhausted → stop, leave the rest for the next run; parse from byte 0; new events = `seq > lastUploadedSeq`; `summaryChanged` = hash differs from the acknowledged one.

- [ ] **Step 1: Write the failing tests**

`cli/test/commands/sync-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, statSync, truncateSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMachineInfo, planSync, readCodexLatestVersion, toSyncBatch } from "../../src/commands/sync-plan";
import { emptyFileState, emptyState } from "../../src/core/state";
import { discoverRolloutFiles } from "../../src/core/discover";
import { silentLogger } from "../../src/util/log";
import { buildBatches } from "../../src/upload/batch";
import type { SyncState } from "../../src/types";
import { FIXTURE_HOME, FX } from "../fixture-ids";

const NOW = Date.UTC(2026, 8, 1, 12);
const deps = { env: {}, now: () => NOW, log: silentLogger, machineZone: "UTC" };

function copyFixtures(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "ck-plan-"));
  cpSync(FIXTURE_HOME, home, { recursive: true });
  writeFileSync(path.join(home, "version.json"), JSON.stringify({ latest_version: "0.151.0", last_checked_at: "x" }));
  return home;
}

describe("planSync", () => {
  it("parses every fixture on a fresh state and collects uploads, rate limit and versions", async () => {
    const home = copyFixtures();
    const plan = await planSync(emptyState(), [home], { full: false }, deps);
    expect(plan.errors).toEqual([]);
    expect(plan.homes[0]?.exists).toBe(true);
    const actions = new Map(plan.files.map((f) => [f.file.sessionId, f.action]));
    expect(actions.get(FX.paginatedSmall)).toBe("parsed");
    expect(actions.get(FX.corrupt)).toBe("parsed");
    expect(plan.uploads.length).toBeGreaterThanOrEqual(8);
    const small = plan.uploads.find((u) => u.sessionId === FX.paginatedSmall)!;
    expect(small.events).toHaveLength(23);
    expect(small.summaryChanged).toBe(true);
    expect(plan.rateLimit).not.toBeNull();
    expect(plan.codexVersion).toBe("0.150.1");
    expect(plan.codexLatestVersion).toBe("0.151.0");
    const next = plan.files.find((f) => f.file.sessionId === FX.paginatedSmall)!.next;
    expect(next).toMatchObject({ lines: 159, lastUploadedSeq: -1, summaryHash: null, generation: 0, complete: false, lastError: null });
    expect(next.offset).toBe(statSync(next.path).size);
    expect(next.tail.length).toBeGreaterThan(0);
  });
  it("treats files with identical size and mtime as unchanged without parsing, unless --full", async () => {
    const home = copyFixtures();
    const { files } = await discoverRolloutFiles([home]);
    const state: SyncState = emptyState();
    for (const f of files) {
      state.files[f.sessionId] = { ...emptyFileState(f.path), offset: f.size, size: f.size, mtimeMs: f.mtimeMs, lastUploadedSeq: 10_000, summaryHash: "x".repeat(40) };
    }
    const plan = await planSync(state, [home], { full: false }, deps);
    expect(plan.files.every((f) => f.action === "unchanged")).toBe(true);
    expect(plan.uploads).toEqual([]);
    const full = await planSync({ ...state, files: Object.fromEntries(Object.entries(state.files).map(([k, v]) => [k, { ...v, offset: 0, size: 0, mtimeMs: 0, lastUploadedSeq: -1, summaryHash: null }])) }, [home], { full: true }, deps);
    expect(full.uploads.length).toBeGreaterThanOrEqual(8);
  });
  it("re-parses a grown file but reports unchanged when the acknowledged hash matches", async () => {
    const home = copyFixtures();
    const first = await planSync(emptyState(), [home], { full: false }, deps);
    const planned = first.files.find((f) => f.file.sessionId === FX.paginatedSmall)!;
    const state = emptyState();
    state.files[FX.paginatedSmall] = { ...planned.next, mtimeMs: planned.next.mtimeMs + 1, lastUploadedSeq: 158, summaryHash: planned.summaryHash };
    const second = await planSync(state, [home], { full: false }, deps);
    const again = second.files.find((f) => f.file.sessionId === FX.paginatedSmall)!;
    expect(again.action).toBe("unchanged");
    expect(again.upload).toBeNull();
    expect(again.next.mtimeMs).toBe(planned.next.mtimeMs);
  });
  it("resets progress when the file shrank or its tail changed", async () => {
    const home = copyFixtures();
    const first = await planSync(emptyState(), [home], { full: false }, deps);
    const planned = first.files.find((f) => f.file.sessionId === FX.corrupt)!;
    const state = emptyState();
    state.files[FX.corrupt] = { ...planned.next, lastUploadedSeq: 5, summaryHash: planned.summaryHash, generation: 2 };
    truncateSync(planned.file.path, planned.next.offset - 10);
    const plan = await planSync(state, [home], { full: false }, deps);
    const reset = plan.files.find((f) => f.file.sessionId === FX.corrupt)!;
    expect(reset.action).toBe("reset");
    expect(reset.reason).toBe("shrunk");
    expect(reset.next.generation).toBe(3);
    expect(reset.next.lastUploadedSeq).toBe(-1);
    expect(reset.upload?.events.length).toBeGreaterThanOrEqual(1);
    expect(plan.warnings.some((w) => w.includes("shrunk"))).toBe(true);
  });
  it("stops when the budget is exhausted and records parse errors instead of throwing", async () => {
    const home = copyFixtures();
    let calls = 0;
    const budgeted = await planSync(emptyState(), [home], { full: false }, { ...deps, now: () => NOW + (calls++ > 2 ? 10_000 : 0), budgetMs: 5000, startedAt: NOW });
    expect(budgeted.budgetExhausted).toBe(true);
    expect(budgeted.files.length).toBeLessThan(8);
    const bad = path.join(home, "sessions", "2026", "08", "30", "rollout-2026-08-30T23-00-00-0199f1c0-0000-7000-8000-0000000000e1.jsonl");
    writeFileSync(bad, `${JSON.stringify({ timestamp: "2026-08-30T23:00:00.000Z", type: "session_meta", payload: { id: "0199f1c0-0000-7000-8000-0000000000e1", timestamp: "1999-01-01T00:00:00.000Z" } })}\n`);
    const plan = await planSync(emptyState(), [home], { full: false }, deps);
    const broken = plan.files.find((f) => f.file.sessionId === "0199f1c0-0000-7000-8000-0000000000e1")!;
    expect(broken.action).toBe("error");
    expect(broken.next.lastError).toMatch(/startedAt/);
    expect(plan.errors).toHaveLength(1);
  });
});

describe("machine info and batches", () => {
  it("builds the machine block and a schema-valid SyncBatch", async () => {
    const machine = buildMachineInfo({
      config: { server: "s", token: "t", machineId: "m1", label: "brisk-otter", hostnameOptIn: true, codexHomes: [] },
      platform: "darwin", arch: "arm64", nodeVersion: "24.17.0", hostname: () => "my-mac", machineZone: "UTC", codexVersion: "0.150.1", codexLatestVersion: "0.151.0",
    });
    expect(machine).toEqual({ machineId: "m1", label: "brisk-otter", platform: "darwin", arch: "arm64", nodeVersion: "24.17.0", codexVersion: "0.150.1", codexLatestVersion: "0.151.0", hostname: "my-mac", tz: "UTC" });
    expect(buildMachineInfo({ config: null, platform: "linux", arch: "x64", nodeVersion: "20.0.0", hostname: () => "h", machineZone: undefined, codexVersion: null, codexLatestVersion: undefined })).toMatchObject({ machineId: "dry-run", label: "dry-run", hostname: null });
    const home = copyFixtures();
    const plan = await planSync(emptyState(), [home], { full: false }, deps);
    const [batch] = buildBatches(plan.uploads);
    const sync = toSyncBatch(batch!, machine, { cliVersion: "0.1.0", batchId: "b1", sentAt: NOW, rateLimit: plan.rateLimit });
    const { SyncBatch } = await import("@codex-kaboo/shared/sync");
    expect(SyncBatch.safeParse(sync).success).toBe(true);
    expect(sync.rateLimit).toEqual(plan.rateLimit);
    expect(await readCodexLatestVersion([home, "/nonexistent"])).toBe("0.151.0");
    expect(await readCodexLatestVersion(["/nonexistent"])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/commands/sync-plan`.

- [ ] **Step 3: Write `cli/src/commands/sync-plan.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { CLI_MAX_FILE_BYTES, CLI_MAX_FILES, CLI_RUN_BUDGET_MS, PARSER_VERSION, SCHEMA_VERSION } from "@codex-kaboo/shared/constants";
import type { MachineInfo, RateLimitSnapshot, SyncBatch } from "@codex-kaboo/shared/sync";
import { discoverRolloutFiles, type DiscoveredFile } from "../core/discover";
import { zstdSupported } from "../core/jsonl-reader";
import { parseRolloutFile } from "../core/parse-file";
import { detectReset, emptyFileState, isUnchanged, resetFileState } from "../core/state";
import type { ParsedSession } from "../parser/session";
import type { Config, FileState, SyncState } from "../types";
import type { Batch, FileUpload } from "../upload/batch";
import type { Logger } from "../util/log";
import { newestVersion } from "../util/version";

export type FileAction = "unchanged" | "parsed" | "reset" | "skipped" | "error";

export interface PlannedFile {
  file: DiscoveredFile;
  prev: FileState | undefined;
  next: FileState; // state to store once the upload (if any) is acknowledged
  upload: FileUpload | null;
  summaryHash: string; // hash of the freshly parsed summary ("" when not parsed)
  action: FileAction;
  reason?: string;
  rateLimit: RateLimitSnapshot | null;
  codexVersion?: string;
  diagnostics?: ParsedSession["diagnostics"];
}

export interface SyncPlan {
  homes: { path: string; exists: boolean; files: number }[];
  truncated: boolean;
  files: PlannedFile[];
  uploads: FileUpload[];
  rateLimit: RateLimitSnapshot | null; // newest snapshot seen in this run
  codexVersion: string | null;
  codexLatestVersion: string | undefined;
  warnings: string[];
  errors: string[];
  budgetExhausted: boolean;
}

export interface PlanOptions {
  full: boolean;
  codexHome?: string;
}

export interface PlanDeps {
  env: NodeJS.ProcessEnv;
  now: () => number;
  log: Logger;
  machineZone: string | undefined;
  budgetMs?: number;
  startedAt?: number;
}

export async function readCodexLatestVersion(homes: string[]): Promise<string | undefined> {
  for (const home of homes) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(home, "version.json"), "utf8")) as { latest_version?: unknown };
      if (typeof raw.latest_version === "string" && raw.latest_version.length > 0) return raw.latest_version;
    } catch {
      // no version.json here
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function planSync(state: SyncState, homes: string[], opts: PlanOptions, deps: PlanDeps): Promise<SyncPlan> {
  const start = deps.startedAt ?? deps.now();
  const budgetMs = deps.budgetMs ?? CLI_RUN_BUDGET_MS;
  const discovered = await discoverRolloutFiles(homes);
  const plan: SyncPlan = {
    homes: discovered.homes,
    truncated: discovered.truncated,
    files: [],
    uploads: [],
    rateLimit: null,
    codexVersion: state.codexVersion,
    codexLatestVersion: await readCodexLatestVersion(homes),
    warnings: [],
    errors: [],
    budgetExhausted: false,
  };
  if (discovered.truncated) {
    plan.warnings.push(`more than ${CLI_MAX_FILES} rollout files found; only the first ${CLI_MAX_FILES} are processed`);
  }
  let zstdWarned = false;

  for (const file of discovered.files) {
    let prev = state.files[file.sessionId];
    if (prev && prev.path !== file.path) prev = { ...prev, path: file.path }; // moved (archived/compressed)
    const planned: PlannedFile = {
      file,
      prev,
      next: prev ?? emptyFileState(file.path),
      upload: null,
      summaryHash: prev?.summaryHash ?? "",
      action: "unchanged",
      rateLimit: null,
    };
    if (prev?.complete && !opts.full) {
      plan.files.push(planned);
      continue;
    }
    if (file.size > CLI_MAX_FILE_BYTES) {
      planned.action = "skipped";
      planned.reason = "larger than 256 MB";
      plan.warnings.push(`${file.name}: skipped (larger than 256 MB)`);
      plan.files.push(planned);
      continue;
    }
    if (file.compressed && !zstdSupported()) {
      planned.action = "skipped";
      planned.reason = "zstd not supported by this Node";
      if (!zstdWarned) {
        plan.warnings.push("compressed .jsonl.zst rollouts need Node >= 22.15; they were skipped");
        zstdWarned = true;
      }
      plan.files.push(planned);
      continue;
    }
    if (isUnchanged(prev, file.size, file.mtimeMs)) {
      plan.files.push(planned);
      continue;
    }
    if (prev !== undefined && prev.offset > 0 && !file.compressed) {
      let reason: "shrunk" | "tail-mismatch" | null = null;
      try {
        reason = await detectReset(prev, file.path, file.size);
      } catch {
        reason = "tail-mismatch";
      }
      if (reason !== null) {
        prev = resetFileState(prev, file.path);
        planned.prev = prev;
        planned.action = "reset";
        planned.reason = reason;
        plan.warnings.push(`${file.name}: file ${reason}; re-reading it from the start`);
      }
    }
    if (deps.now() - start > budgetMs) {
      plan.budgetExhausted = true;
      plan.warnings.push("run budget exhausted; remaining files will be processed on the next run");
      break;
    }
    let result;
    try {
      result = await parseRolloutFile(file, { machineZone: deps.machineZone, now: deps.now(), generation: prev?.generation ?? 0 });
    } catch (error) {
      const message = errorMessage(error);
      planned.action = "error";
      planned.reason = message;
      planned.next = { ...(prev ?? emptyFileState(file.path)), size: file.size, mtimeMs: file.mtimeMs, lastError: message };
      plan.errors.push(`${file.name}: ${message}`);
      plan.files.push(planned);
      continue;
    }
    const { parsed, read } = result;
    const lastUploadedSeq = prev?.lastUploadedSeq ?? -1;
    const newEvents = parsed.events.filter((event) => event.seq > lastUploadedSeq);
    const summaryChanged = parsed.summary.summaryHash !== prev?.summaryHash;
    planned.summaryHash = parsed.summary.summaryHash;
    planned.rateLimit = parsed.rateLimit;
    planned.diagnostics = parsed.diagnostics;
    if (parsed.summary.cliVersion) planned.codexVersion = parsed.summary.cliVersion;
    planned.next = {
      path: file.path,
      offset: file.compressed ? file.size : read.consumed,
      lines: read.lines,
      size: file.size,
      mtimeMs: file.mtimeMs,
      tail: read.tail,
      lastUploadedSeq,
      summaryHash: prev?.summaryHash ?? null,
      generation: prev?.generation ?? 0,
      complete: file.compressed,
      lastError: null,
    };
    if (summaryChanged || newEvents.length > 0) {
      if (planned.action !== "reset") planned.action = "parsed";
      planned.upload = { sessionId: file.sessionId, summary: parsed.summary, events: newEvents, summaryChanged };
      plan.uploads.push(planned.upload);
    } else if (planned.action !== "reset") {
      planned.action = "unchanged";
    }
    plan.files.push(planned);
    if (parsed.rateLimit && (plan.rateLimit === null || parsed.rateLimit.observedAt > plan.rateLimit.observedAt)) {
      plan.rateLimit = parsed.rateLimit;
    }
    plan.codexVersion = newestVersion([plan.codexVersion, parsed.summary.cliVersion]) ?? plan.codexVersion;
    if (Object.keys(parsed.diagnostics.unknownTypes).length > 0) {
      deps.log.debug(`${file.name}: unknown line types ${JSON.stringify(parsed.diagnostics.unknownTypes)}`);
    }
  }
  return plan;
}

export interface MachineInput {
  config: Config | null;
  platform: string;
  arch: string;
  nodeVersion: string;
  hostname: () => string;
  machineZone: string | undefined;
  codexVersion: string | null;
  codexLatestVersion: string | undefined;
}

export function buildMachineInfo(input: MachineInput): MachineInfo {
  const machine: MachineInfo = {
    machineId: input.config?.machineId ?? "dry-run",
    label: input.config?.label ?? "dry-run",
    platform: input.platform,
    arch: input.arch,
    nodeVersion: input.nodeVersion,
    hostname: input.config?.hostnameOptIn ? input.hostname() : null,
  };
  if (input.codexVersion) machine.codexVersion = input.codexVersion;
  if (input.codexLatestVersion) machine.codexLatestVersion = input.codexLatestVersion;
  if (input.machineZone) machine.tz = input.machineZone;
  return machine;
}

export function toSyncBatch(
  batch: Batch,
  machine: MachineInfo,
  meta: { cliVersion: string; batchId: string; sentAt: number; rateLimit: RateLimitSnapshot | null },
): SyncBatch {
  const payload: SyncBatch = {
    schemaVersion: SCHEMA_VERSION,
    parserVersion: PARSER_VERSION,
    cliVersion: meta.cliVersion,
    batchId: meta.batchId,
    sentAt: meta.sentAt,
    machine,
    sessions: batch.sessions,
    tokenEvents: batch.tokenEvents,
  };
  if (meta.rateLimit) payload.rateLimit = meta.rateLimit;
  return payload;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS. (`next.offset` equals the file size for fixtures that end with `\n`; the partial-line fixture's offset is smaller, which is why the first test only checks the small session.)

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sync-plan.ts cli/test/commands/sync-plan.test.ts
git commit -F - <<'MSG'
Add the sync planner: change detection, parsing and upload preparation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 21: `commands/sync.ts` — `runSync`: lock, upload with acks, 413 halving, heartbeat, dry-run report

**Files:**
- Create: `cli/src/commands/sync.ts`
- Test: `cli/test/commands/sync.test.ts`

**Interfaces:**
- Consumes: `planSync`, `buildMachineInfo`, `toSyncBatch`, `PlannedFile`, `SyncPlan`, `FileAction` (commands/sync-plan); `readConfig` (core/config); `resolveCodexHomes`, `KabooPaths` (core/paths); `readState`, `writeState`, `resetAllFiles` (core/state); `buildBatches`, `applyAck`, `DEFAULT_BATCH_LIMITS`, `BatchLimits` (upload/batch); `SyncClient`, `isAuthError`, `isBadRequest`, `isPayloadTooLarge` (upload/client); `acquireLock`, `releaseLock` (util/lock); `compareVersions` (util/version); shared constants `CLI_LOCK_STALE_MS`, `HEARTBEAT_INTERVAL_MS`, `CLI_MIN_BATCH_EVENTS`.
- Produces: `interface SyncOptions { full: boolean; dryRun: boolean; scheduled: boolean; json: boolean; codexHome?: string }`, `interface SyncDeps { paths; env; now; log; cliVersion; machineZone; newId; createClient(config): SyncClient; platform; arch; nodeVersion; hostname(); pid; webOrigin?; budgetMs?; batchLimits? }`, `interface FileReport { sessionId; name; action; reason?; newEvents; summaryChanged }`, `interface SyncReport { ok; exitCode; dryRun; loggedIn; durationMs; homes; files; uploads: { sessions; events; requests }; accepted; conflicts; heartbeat; latestCliVersion; rateLimit; warnings; errors; batches? }`, `runSync(opts, deps)`, `upgradeHint(version, webOrigin)`, `summaryLine(report)`.

Rules: no lock, no network and no state write under `--dry-run` (`report.batches` holds the exact payloads); `--scheduled` exits 0 when not logged in or when another sync holds the lock; batches are sent one at a time and rebuilt after each acknowledgement so only acked batches advance `lastUploadedSeq` (and `summaryHash` only with the file's final batch); 413 halves `maxEvents` (min 50) and retries; 401/403 stops with exit 2; 400/422 marks the batch's files with `lastError`, skips them and continues (exit 1); network failure after retries stops (exit 1); the newest rate-limit snapshot rides in the first request; a machine-only heartbeat is sent when nothing was uploaded and the last heartbeat is older than an hour (or a newer rate limit is pending); state is persisted after every ack and at the end.

- [ ] **Step 1: Write the failing tests**

`cli/test/commands/sync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SyncBatch, SyncResponse } from "@codex-kaboo/shared/sync";
import { runSync, type SyncDeps } from "../../src/commands/sync";
import { writeConfig } from "../../src/core/config";
import { kabooPaths } from "../../src/core/paths";
import { readState } from "../../src/core/state";
import { SyncHttpError, SyncNetworkError, type SyncClient } from "../../src/upload/client";
import { silentLogger } from "../../src/util/log";
import { FIXTURE_HOME, FX } from "../fixture-ids";

const NOW = Date.UTC(2026, 8, 1, 12);

function fakeClient(opts: { fail?: (batch: SyncBatch, index: number) => Error | null; latest?: string | null } = {}) {
  const batches: SyncBatch[] = [];
  const client: SyncClient = {
    async sync(batch) {
      const error = opts.fail?.(batch, batches.length) ?? null;
      batches.push(batch);
      if (error) throw error;
      const res: SyncResponse = {
        ok: true,
        accepted: { sessions: { inserted: batch.sessions.length, updated: 0, unchanged: 0 }, events: { inserted: batch.tokenEvents.length, updated: 0, unchanged: 0 } },
        conflicts: { sessions: [], events: 0 },
        serverTime: 1,
        latestCliVersion: opts.latest ?? null,
        limits: { maxBodyBytes: 8388608, maxSessions: 500, maxEvents: 5000 },
      };
      return res;
    },
    async whoami() { throw new Error("not used"); },
    async health() { return { ok: true, serverTime: 1 }; },
  };
  return { client, batches };
}

async function setup(opts: { loggedIn?: boolean } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ck-sync-"));
  const codexHome = path.join(root, "codex");
  cpSync(FIXTURE_HOME, codexHome, { recursive: true });
  const paths = kabooPaths(path.join(root, "kaboo"));
  if (opts.loggedIn !== false) {
    await writeConfig(paths, { server: "https://x.convex.site", token: "ck_t", machineId: "m-1", label: "brisk-otter", hostnameOptIn: false, codexHomes: [] });
  }
  const clock = { now: NOW };
  let ids = 0;
  const fake = fakeClient();
  const deps: SyncDeps = {
    paths, env: {}, now: () => clock.now, log: silentLogger, cliVersion: "0.1.0", machineZone: "UTC", newId: () => `id-${++ids}`,
    createClient: () => fake.client, platform: "darwin", arch: "arm64", nodeVersion: "24.17.0", hostname: () => "h", pid: process.pid,
  };
  return { root, codexHome, paths, clock, deps, fake };
}
const base = { full: false, dryRun: false, scheduled: false, json: false };

describe("runSync dry-run", () => {
  it("parses everything, prints the exact payloads, and touches neither the network nor state", async () => {
    const s = await setup();
    const report = await runSync({ ...base, dryRun: true, codexHome: s.codexHome }, { ...s.deps, createClient: () => { throw new Error("no network in dry-run"); } });
    expect(report.exitCode).toBe(0);
    expect(report.dryRun).toBe(true);
    expect(report.batches?.length).toBe(1);
    expect(report.batches?.[0]?.machine.machineId).toBe("m-1");
    expect(report.batches?.[0]?.rateLimit).toBeDefined();
    expect(report.uploads.events).toBe(report.batches?.[0]?.tokenEvents.length);
    expect(report.files.filter((f) => f.action === "parsed").length).toBeGreaterThanOrEqual(8);
    expect(existsSync(s.paths.state)).toBe(false);
    expect(existsSync(s.paths.lock)).toBe(false);
    const text = JSON.stringify(report.batches);
    expect(text).not.toContain("/redacted");
    expect(text).not.toContain(s.codexHome);
  });
  it("works without a login and refuses a real sync without one", async () => {
    const s = await setup({ loggedIn: false });
    const dry = await runSync({ ...base, dryRun: true, codexHome: s.codexHome }, s.deps);
    expect(dry.exitCode).toBe(0);
    expect(dry.batches?.[0]?.machine.machineId).toBe("dry-run");
    expect((await runSync({ ...base, codexHome: s.codexHome }, s.deps)).exitCode).toBe(2);
    expect((await runSync({ ...base, scheduled: true, codexHome: s.codexHome }, s.deps)).exitCode).toBe(0);
    expect(existsSync(s.paths.state)).toBe(false);
  });
});

describe("runSync upload", () => {
  it("uploads once, then stays quiet, then heartbeats after an hour", async () => {
    const s = await setup();
    const first = await runSync({ ...base, codexHome: s.codexHome }, s.deps);
    expect(first.exitCode).toBe(0);
    expect(first.uploads.requests).toBe(1);
    expect(s.fake.batches[0]?.rateLimit).toBeDefined();
    const state = (await readState(s.paths)).state;
    const small = state.files[FX.paginatedSmall]!;
    expect(small.lastUploadedSeq).toBeGreaterThan(0);
    expect(small.lastUploadedSeq).toBeLessThanOrEqual(158);
    expect(small.summaryHash).toMatch(/^[0-9a-f]{40}$/);
    expect(state.rateLimit).toEqual(s.fake.batches[0]?.rateLimit);
    expect(state.lastHeartbeatAt).toBe(NOW);
    expect(state.lastSyncOk).toBe(true);
    expect(state.codexVersion).toBe("0.150.1");
    s.clock.now = NOW + 10 * 60 * 1000;
    const second = await runSync({ ...base, codexHome: s.codexHome }, s.deps);
    expect(second.uploads.requests).toBe(0);
    expect(second.heartbeat).toBe(false);
    expect(second.files.every((f) => f.action === "unchanged")).toBe(true);
    s.clock.now = NOW + 2 * 60 * 60 * 1000;
    const third = await runSync({ ...base, codexHome: s.codexHome }, s.deps);
    expect(third.heartbeat).toBe(true);
    const hb = s.fake.batches[s.fake.batches.length - 1]!;
    expect(hb.sessions).toEqual([]);
    expect(hb.tokenEvents).toEqual([]);
    expect((await readState(s.paths)).state.lastHeartbeatAt).toBe(NOW + 2 * 60 * 60 * 1000);
    const full = await runSync({ ...base, full: true, codexHome: s.codexHome }, s.deps);
    expect(full.uploads.events).toBe(first.uploads.events);
  });
  it("halves batches on 413 until the server accepts them", async () => {
    const s = await setup();
    const fake = fakeClient({ fail: (b) => (b.tokenEvents.length > 60 ? new SyncHttpError(413, "too_many_items", "too large", null, null) : null) });
    const report = await runSync({ ...base, codexHome: s.codexHome }, { ...s.deps, createClient: () => fake.client, batchLimits: { maxEvents: 200, maxBytes: 3_500_000, maxSessions: 500 } });
    expect(report.exitCode).toBe(0);
    expect(report.warnings.some((w) => w.includes("too large"))).toBe(true);
    const shipped = fake.batches.filter((b) => b.tokenEvents.length <= 60).reduce((n, b) => n + b.tokenEvents.length, 0);
    expect(shipped).toBe(report.uploads.events);
    expect(report.uploads.events).toBeGreaterThan(200);
  });
  it("stops on 401 without advancing state", async () => {
    const s = await setup();
    const fake = fakeClient({ fail: () => new SyncHttpError(401, "token_revoked", "revoked", null, null) });
    const report = await runSync({ ...base, codexHome: s.codexHome }, { ...s.deps, createClient: () => fake.client });
    expect(report.exitCode).toBe(2);
    expect(report.errors[0]).toContain("codex-kaboo login");
    const state = (await readState(s.paths)).state;
    expect(state.files[FX.paginatedSmall]?.lastUploadedSeq ?? -1).toBe(-1);
    expect(state.lastSyncOk).toBe(false);
  });
  it("marks files from a rejected batch and continues; only acked batches advance", async () => {
    const s = await setup();
    const limits = { maxEvents: 30, maxBytes: 3_500_000, maxSessions: 500 };
    const rejecting = fakeClient({ fail: (_b, i) => (i === 0 ? new SyncHttpError(400, "invalid_batch", "bad day", null, null) : null) });
    const report = await runSync({ ...base, codexHome: s.codexHome }, { ...s.deps, createClient: () => rejecting.client, batchLimits: limits });
    expect(report.exitCode).toBe(1);
    const state = (await readState(s.paths)).state;
    const failed = Object.values(state.files).filter((f) => f.lastError !== null);
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0]?.lastUploadedSeq).toBe(-1);
    expect(Object.values(state.files).some((f) => f.lastError === null && f.lastUploadedSeq >= 0)).toBe(true);
    const t = await setup();
    const flaky = fakeClient({ fail: (_b, i) => (i === 1 ? new SyncNetworkError("ECONNRESET", null) : null) });
    const r2 = await runSync({ ...base, codexHome: t.codexHome }, { ...t.deps, createClient: () => flaky.client, batchLimits: limits });
    expect(r2.exitCode).toBe(1);
    expect(r2.uploads.requests).toBe(1);
    const st2 = (await readState(t.paths)).state;
    const advanced = Object.values(st2.files).filter((f) => f.lastUploadedSeq >= 0 || (f.summaryHash !== null));
    expect(advanced.length).toBeGreaterThanOrEqual(1);
    expect(advanced.length).toBeLessThan(r2.files.length);
  });
  it("skips when another sync holds the lock and hints about upgrades", async () => {
    const s = await setup();
    writeFileSync(s.paths.lock, JSON.stringify({ pid: process.pid, at: NOW }));
    expect((await runSync({ ...base, codexHome: s.codexHome }, s.deps)).exitCode).toBe(1);
    expect((await runSync({ ...base, scheduled: true, codexHome: s.codexHome }, s.deps)).exitCode).toBe(0);
    expect(s.fake.batches).toHaveLength(0);
    const u = await setup();
    const newer = fakeClient({ latest: "0.2.0" });
    const report = await runSync({ ...base, codexHome: u.codexHome }, { ...u.deps, createClient: () => newer.client, webOrigin: "https://kaboo.example" });
    expect(report.latestCliVersion).toBe("0.2.0");
    expect(report.warnings.some((w) => w.includes("https://kaboo.example/cli/codex-kaboo-cli.tgz"))).toBe(true);
    expect((await readState(u.paths)).state.latestCliVersion).toBe("0.2.0");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/commands/sync`.

- [ ] **Step 3: Write `cli/src/commands/sync.ts`**

```ts
import { CLI_LOCK_STALE_MS, CLI_MIN_BATCH_EVENTS, HEARTBEAT_INTERVAL_MS } from "@codex-kaboo/shared/constants";
import type { RateLimitSnapshot, SyncBatch, SyncResponse, UpsertCounts } from "@codex-kaboo/shared/sync";
import { readConfig } from "../core/config";
import { resolveCodexHomes, type KabooPaths } from "../core/paths";
import { readState, resetAllFiles, writeState } from "../core/state";
import type { Config, SyncState } from "../types";
import { applyAck, buildBatches, DEFAULT_BATCH_LIMITS, type BatchLimits } from "../upload/batch";
import { isAuthError, isBadRequest, isPayloadTooLarge, type SyncClient } from "../upload/client";
import { acquireLock, releaseLock } from "../util/lock";
import type { Logger } from "../util/log";
import { compareVersions } from "../util/version";
import { buildMachineInfo, planSync, toSyncBatch, type FileAction, type SyncPlan } from "./sync-plan";

export interface SyncOptions {
  full: boolean;
  dryRun: boolean;
  scheduled: boolean;
  json: boolean;
  codexHome?: string;
}

export interface SyncDeps {
  paths: KabooPaths;
  env: NodeJS.ProcessEnv;
  now: () => number;
  log: Logger;
  cliVersion: string;
  machineZone: string | undefined;
  newId: () => string;
  createClient: (config: Config) => SyncClient;
  platform: string;
  arch: string;
  nodeVersion: string;
  hostname: () => string;
  pid: number;
  webOrigin?: string;
  budgetMs?: number;
  batchLimits?: BatchLimits;
}

export interface FileReport {
  sessionId: string;
  name: string;
  action: FileAction;
  reason?: string;
  newEvents: number;
  summaryChanged: boolean;
}

export interface SyncReport {
  ok: boolean;
  exitCode: number;
  dryRun: boolean;
  loggedIn: boolean;
  durationMs: number;
  homes: SyncPlan["homes"];
  files: FileReport[];
  uploads: { sessions: number; events: number; requests: number };
  accepted: { sessions: UpsertCounts; events: UpsertCounts } | null;
  conflicts: { sessions: string[]; events: number } | null;
  heartbeat: boolean;
  latestCliVersion: string | null;
  rateLimit: RateLimitSnapshot | null;
  warnings: string[];
  errors: string[];
  batches?: SyncBatch[]; // dry-run only: the exact payloads (privacy audit)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function zeroCounts(): UpsertCounts {
  return { inserted: 0, updated: 0, unchanged: 0 };
}

function addCounts(target: UpsertCounts, delta: UpsertCounts): void {
  target.inserted += delta.inserted;
  target.updated += delta.updated;
  target.unchanged += delta.unchanged;
}

export function upgradeHint(version: string, webOrigin: string | undefined): string {
  const origin = webOrigin ?? "https://<your-dashboard>";
  return `a newer codex-kaboo CLI (${version}) is available: npm install -g ${origin}/cli/codex-kaboo-cli.tgz (npm 12+: add --allow-remote=all)`;
}

export function summaryLine(report: SyncReport): string {
  const parsed = report.files.filter((f) => f.action === "parsed" || f.action === "reset").length;
  return `sync ${report.ok ? "ok" : "failed"}: ${report.files.length} files, ${parsed} parsed, ${report.uploads.sessions} sessions and ${report.uploads.events} events uploaded in ${report.uploads.requests} request(s)${report.heartbeat ? " (heartbeat)" : ""}, ${report.durationMs} ms`;
}

export async function runSync(opts: SyncOptions, deps: SyncDeps): Promise<SyncReport> {
  const start = deps.now();
  const report: SyncReport = {
    ok: true, exitCode: 0, dryRun: opts.dryRun, loggedIn: false, durationMs: 0, homes: [], files: [],
    uploads: { sessions: 0, events: 0, requests: 0 }, accepted: null, conflicts: null, heartbeat: false,
    latestCliVersion: null, rateLimit: null, warnings: [], errors: [],
  };
  const finish = (): SyncReport => {
    report.durationMs = deps.now() - start;
    report.ok = report.exitCode === 0;
    return report;
  };

  let config: Config | null = null;
  try {
    config = await readConfig(deps.paths);
  } catch (error) {
    report.errors.push(errorMessage(error));
    report.exitCode = 2;
    return finish();
  }
  report.loggedIn = config !== null;
  if (config === null && !opts.dryRun) {
    report.warnings.push("not logged in: run `codex-kaboo login` first");
    report.exitCode = opts.scheduled ? 0 : 2;
    return finish();
  }

  let lockHeld = false;
  if (!opts.dryRun) {
    const lock = await acquireLock(deps.paths.lock, { now: deps.now(), staleMs: CLI_LOCK_STALE_MS, pid: deps.pid });
    if (!lock.acquired) {
      report.warnings.push(`another sync is running (pid ${lock.holder?.pid ?? "unknown"}); skipped`);
      report.exitCode = opts.scheduled ? 0 : 1;
      return finish();
    }
    lockHeld = true;
  }

  try {
    const loaded = await readState(deps.paths);
    if (loaded.corrupt) report.warnings.push("state.json was unreadable; starting from an empty state");
    const state: SyncState = opts.full ? resetAllFiles(loaded.state) : loaded.state;
    const homes = resolveCodexHomes({ override: opts.codexHome, env: deps.env, configured: config?.codexHomes });
    const plan = await planSync(state, homes, { full: opts.full, codexHome: opts.codexHome }, {
      env: deps.env, now: deps.now, log: deps.log, machineZone: deps.machineZone, budgetMs: deps.budgetMs, startedAt: start,
    });
    report.homes = plan.homes;
    report.warnings.push(...plan.warnings);
    report.errors.push(...plan.errors);
    if (plan.errors.length > 0) report.exitCode = 1;
    report.files = plan.files.map((f) => ({
      sessionId: f.file.sessionId,
      name: f.file.name,
      action: f.action,
      ...(f.reason ? { reason: f.reason } : {}),
      newEvents: f.upload?.events.length ?? 0,
      summaryChanged: f.upload?.summaryChanged ?? false,
    }));
    state.codexVersion = plan.codexVersion;
    const rateLimitNewer =
      plan.rateLimit !== null && (state.rateLimit === null || plan.rateLimit.observedAt > state.rateLimit.observedAt);
    const machine = buildMachineInfo({
      config, platform: deps.platform, arch: deps.arch, nodeVersion: deps.nodeVersion, hostname: deps.hostname,
      machineZone: deps.machineZone, codexVersion: plan.codexVersion, codexLatestVersion: plan.codexLatestVersion,
    });
    const limits: BatchLimits = { ...(deps.batchLimits ?? DEFAULT_BATCH_LIMITS) };
    const plannedById = new Map(plan.files.map((f) => [f.file.sessionId, f]));
    for (const planned of plan.files) {
      if (planned.upload === null && (planned.action === "unchanged" || planned.action === "error")) {
        state.files[planned.file.sessionId] = planned.next;
      }
    }

    if (opts.dryRun) {
      const batches = buildBatches(plan.uploads, limits);
      report.batches = batches.map((batch, index) =>
        toSyncBatch(batch, machine, { cliVersion: deps.cliVersion, batchId: deps.newId(), sentAt: deps.now(), rateLimit: index === 0 && rateLimitNewer ? plan.rateLimit : null }),
      );
      report.uploads = {
        sessions: plan.uploads.filter((u) => u.summaryChanged).length,
        events: plan.uploads.reduce((n, u) => n + u.events.length, 0),
        requests: batches.length,
      };
      report.rateLimit = plan.rateLimit;
      return finish();
    }

    const client = deps.createClient(config as Config);
    const accepted = { sessions: zeroCounts(), events: zeroCounts() };
    const conflicts: { sessions: string[]; events: number } = { sessions: [], events: 0 };
    let rateLimitToSend: RateLimitSnapshot | null = rateLimitNewer ? plan.rateLimit : null;
    const applyResponse = (res: SyncResponse): void => {
      addCounts(accepted.sessions, res.accepted.sessions);
      addCounts(accepted.events, res.accepted.events);
      conflicts.sessions.push(...res.conflicts.sessions);
      conflicts.events += res.conflicts.events;
      report.uploads.requests += 1;
      if (res.latestCliVersion) {
        report.latestCliVersion = res.latestCliVersion;
        state.latestCliVersion = res.latestCliVersion;
      }
      if (rateLimitToSend !== null) {
        state.rateLimit = rateLimitToSend;
        rateLimitToSend = null;
      }
    };
    const failFile = (sessionId: string, message: string): void => {
      const current = state.files[sessionId] ?? plannedById.get(sessionId)?.next;
      if (current) state.files[sessionId] = { ...current, lastError: message };
    };

    let pending = plan.uploads;
    let stopped = false;
    while (pending.length > 0 && !stopped) {
      const batch = buildBatches(pending, limits)[0];
      if (!batch) break;
      const payload = toSyncBatch(batch, machine, { cliVersion: deps.cliVersion, batchId: deps.newId(), sentAt: deps.now(), rateLimit: rateLimitToSend });
      let response: SyncResponse;
      try {
        response = await client.sync(payload);
      } catch (error) {
        const inBatch = new Set(batch.files.map((f) => f.sessionId));
        if (isPayloadTooLarge(error)) {
          if (limits.maxEvents <= CLI_MIN_BATCH_EVENTS) {
            for (const id of inBatch) failFile(id, "server rejected the batch as too large");
            pending = pending.filter((u) => !inBatch.has(u.sessionId));
            report.errors.push(`server rejected ${inBatch.size} file(s) as too large even at ${CLI_MIN_BATCH_EVENTS} events per batch`);
            report.exitCode = 1;
            continue;
          }
          limits.maxEvents = Math.max(CLI_MIN_BATCH_EVENTS, Math.floor(limits.maxEvents / 2));
          limits.maxBytes = Math.max(64 * 1024, Math.floor(limits.maxBytes / 2));
          report.warnings.push(`payload too large; retrying with batches of ${limits.maxEvents} events`);
          continue;
        }
        if (isAuthError(error)) {
          report.errors.push(`authentication failed (${errorMessage(error)}); run \`codex-kaboo login\``);
          report.exitCode = 2;
          stopped = true;
          break;
        }
        if (isBadRequest(error)) {
          for (const id of inBatch) failFile(id, errorMessage(error));
          pending = pending.filter((u) => !inBatch.has(u.sessionId));
          report.errors.push(`server rejected ${inBatch.size} file(s): ${errorMessage(error)}`);
          report.exitCode = 1;
          await writeState(deps.paths, state);
          continue;
        }
        report.errors.push(`upload failed: ${errorMessage(error)}`);
        report.exitCode = 1;
        stopped = true;
        break;
      }
      applyResponse(response);
      report.uploads.sessions += batch.sessions.length;
      report.uploads.events += batch.tokenEvents.length;
      for (const entry of batch.files) {
        const planned = plannedById.get(entry.sessionId);
        if (!planned) continue;
        const current = state.files[entry.sessionId] ?? planned.next;
        state.files[entry.sessionId] = {
          ...planned.next,
          lastUploadedSeq: Math.max(current.lastUploadedSeq, planned.next.lastUploadedSeq, entry.lastSeq),
          summaryHash: entry.final ? planned.summaryHash : current.summaryHash,
          lastError: null,
        };
      }
      pending = applyAck(pending, batch);
      await writeState(deps.paths, state);
    }

    if (conflicts.sessions.length > 0) {
      report.warnings.push(`${conflicts.sessions.length} session(s) belong to another user and were not merged: ${conflicts.sessions.join(", ")}`);
    }
    report.accepted = accepted;
    report.conflicts = conflicts;

    if (report.uploads.requests > 0) {
      state.lastHeartbeatAt = deps.now();
    } else if (!stopped && report.exitCode !== 2) {
      const due = state.lastHeartbeatAt === null || deps.now() - state.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS;
      if (due || rateLimitToSend !== null) {
        try {
          const res = await client.sync(toSyncBatch({ sessions: [], tokenEvents: [], files: [] }, machine, { cliVersion: deps.cliVersion, batchId: deps.newId(), sentAt: deps.now(), rateLimit: rateLimitToSend }));
          applyResponse(res);
          state.lastHeartbeatAt = deps.now();
          report.heartbeat = true;
        } catch (error) {
          if (isAuthError(error)) {
            report.errors.push(`authentication failed (${errorMessage(error)}); run \`codex-kaboo login\``);
            report.exitCode = 2;
          } else {
            report.warnings.push(`heartbeat failed: ${errorMessage(error)}`);
          }
        }
      }
    }

    report.rateLimit = state.rateLimit;
    if (report.latestCliVersion !== null && compareVersions(report.latestCliVersion, deps.cliVersion) > 0) {
      report.warnings.push(upgradeHint(report.latestCliVersion, deps.webOrigin));
    }
    state.lastSyncAt = deps.now();
    state.lastSyncOk = report.exitCode === 0;
    state.lastError = report.errors[0] ?? null;
    await writeState(deps.paths, state);
    const done = finish();
    deps.log.info(summaryLine(done));
    for (const warning of done.warnings) deps.log.warn(warning);
    for (const error of done.errors) deps.log.error(error);
    return done;
  } catch (error) {
    report.errors.push(errorMessage(error));
    if (report.exitCode !== 2) report.exitCode = 1;
    deps.log.error(`sync crashed: ${errorMessage(error)}`);
    return finish();
  } finally {
    if (lockHeld) await releaseLock(deps.paths.lock, deps.pid);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS. In the "halves batches" test the fake rejects any batch above 60 events, so the CLI retries with 100 and then 50 events per batch; every event is eventually shipped in batches of ≤ 50.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sync.ts cli/test/commands/sync.test.ts
git commit -F - <<'MSG'
Add the sync command: locking, acknowledged uploads, 413 halving and heartbeats

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 22: `schedule/*` — pure generators and adapters for launchd, cron, systemd and schtasks

**Files:**
- Create: `cli/src/schedule/index.ts`, `cli/src/schedule/launchd.ts`, `cli/src/schedule/cron.ts`, `cli/src/schedule/systemd.ts`, `cli/src/schedule/schtasks.ts`
- Test: `cli/test/schedule/schedule.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure modules + `fs`).
- Produces (index.ts): `interface ScheduleTarget { nodePath; scriptPath; kabooHome; homeDir; codexHome?; uid?; pathEnv? }`, `interface SpawnResult { code: number | null; stdout: string; stderr: string }`, `interface Spawner { run(command, args, opts?: { input?: string }): Promise<SpawnResult> }`, `interface ScheduleStatus { installed: boolean; healthy: boolean; detail: string }`, `type SchedulerName = "launchd" | "cron" | "systemd" | "schtasks"`, `interface SchedulerAdapter { name; install(target, spawner): Promise<string>; uninstall(target, spawner): Promise<string>; status(target, spawner): Promise<ScheduleStatus> }`, `pickScheduler(platform, { systemd? })`, `checkTargetPaths(target)` → missing paths, `SCHEDULE_INTERVAL_SECONDS = 900`, `scheduledArgs()` → `["sync", "--scheduled"]` (no parameter: the arguments never depend on the target, and an unused one would fail the root `no-unused-vars` rule).
- Produces (launchd.ts): `LAUNCHD_LABEL`, `plistPath(homeDir)`, `xmlEscape(s)`, `renderPlist(target)`, `launchdAdapter`. (cron.ts): `CRON_BEGIN`, `CRON_END`, `renderCronLine(target)`, `upsertCronBlock(existing, line)`, `removeCronBlock(existing)`, `cronAdapter`. (systemd.ts): `systemdDir(homeDir)`, `renderService(target)`, `renderTimer()`, `systemdAdapter`. (schtasks.ts): `TASK_NAME`, `vbsQuote(s)`, `renderVbs(target)`, `renderPowershellCommand(target)`, `schtasksCreateArgs(command)`, `schtasksDeleteArgs()`, `schtasksQueryArgs()`, `parseSchtasksStatus(stdout)`, `schtasksAdapter`.

- [ ] **Step 1: Write the failing tests**

`cli/test/schedule/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CRON_BEGIN, CRON_END, cronAdapter, removeCronBlock, renderCronLine, upsertCronBlock } from "../../src/schedule/cron";
import { checkTargetPaths, pickScheduler, type ScheduleTarget, type Spawner, type SpawnResult } from "../../src/schedule/index";
import { LAUNCHD_LABEL, launchdAdapter, plistPath, renderPlist, xmlEscape } from "../../src/schedule/launchd";
import { parseSchtasksStatus, renderVbs, schtasksAdapter, schtasksCreateArgs, TASK_NAME, vbsQuote } from "../../src/schedule/schtasks";
import { renderService, renderTimer, systemdAdapter, systemdDir } from "../../src/schedule/systemd";

function target(overrides: Partial<ScheduleTarget> = {}): ScheduleTarget {
  return {
    nodePath: "/opt/node & co/bin/node",
    scriptPath: "/Users/me/.npm-global/lib/node_modules/codex-kaboo-cli/dist/codex-kaboo.js",
    kabooHome: "/Users/me/.codex-kaboo",
    homeDir: "/Users/me",
    uid: 501,
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
    ...overrides,
  };
}

function mockSpawner(handler: (command: string, args: string[], input?: string) => SpawnResult | undefined) {
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const spawner: Spawner = {
    async run(command, args, opts) {
      calls.push({ command, args, input: opts?.input });
      return handler(command, args, opts?.input) ?? { code: 0, stdout: "", stderr: "" };
    },
  };
  return { spawner, calls };
}

describe("launchd", () => {
  it("renders an escaped plist and installs via bootout/bootstrap/kickstart", async () => {
    const plist = renderPlist(target({ codexHome: "/Users/me/<codex>" }));
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plist).toContain("<string>/opt/node &amp; co/bin/node</string>");
    expect(plist).toContain("<string>/Users/me/&lt;codex&gt;</string>");
    expect(plist).toContain("<key>StartInterval</key>\n  <integer>900</integer>");
    expect(plist).toContain("<string>sync</string>\n    <string>--scheduled</string>");
    expect(plist).toContain("<key>StandardOutPath</key>\n  <string>/Users/me/.codex-kaboo/launchd.log</string>");
    expect(plist).toContain("<key>ProcessType</key>\n  <string>Background</string>");
    expect(xmlEscape(`a"b'c`)).toBe("a&quot;b&apos;c");
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "ck-launchd-"));
    const t = target({ homeDir });
    const { spawner, calls } = mockSpawner((cmd, args) => (args[0] === "bootout" ? { code: 3, stdout: "", stderr: "not loaded" } : undefined));
    await launchdAdapter.install(t, spawner);
    expect(existsSync(plistPath(homeDir))).toBe(true);
    expect(calls.map((c) => [c.command, ...c.args])).toEqual([
      ["launchctl", "bootout", `gui/501/${LAUNCHD_LABEL}`],
      ["launchctl", "bootstrap", "gui/501", plistPath(homeDir)],
      ["launchctl", "kickstart", "-k", `gui/501/${LAUNCHD_LABEL}`],
    ]);
    const status = await launchdAdapter.status(t, mockSpawner(() => ({ code: 0, stdout: "state = running", stderr: "" })).spawner);
    expect(status.installed).toBe(true);
    await launchdAdapter.uninstall(t, spawner);
    expect(existsSync(plistPath(homeDir))).toBe(false);
  });
});

describe("cron", () => {
  it("renders the line and keeps exactly one marker block", () => {
    const line = renderCronLine(target({ codexHome: "/srv/codex" }));
    expect(line).toBe(`*/15 * * * * CODEX_KABOO_SCHEDULED=1 CODEX_HOME="/srv/codex" "/opt/node & co/bin/node" "/Users/me/.npm-global/lib/node_modules/codex-kaboo-cli/dist/codex-kaboo.js" sync --scheduled >> "/Users/me/.codex-kaboo/cron.log" 2>&1`);
    const once = upsertCronBlock("0 * * * * echo hi\n", line);
    expect(once).toBe(`0 * * * * echo hi\n${CRON_BEGIN}\n${line}\n${CRON_END}\n`);
    const twice = upsertCronBlock(once, line.replace("*/15", "*/10"));
    expect(twice.split(CRON_BEGIN)).toHaveLength(2);
    expect(twice).toContain("*/10");
    expect(twice).not.toContain("*/15");
    expect(removeCronBlock(twice)).toBe("0 * * * * echo hi\n");
    expect(upsertCronBlock("", line)).toBe(`${CRON_BEGIN}\n${line}\n${CRON_END}\n`);
  });
  it("installs through crontab -l / crontab - and reports status", async () => {
    let stored = "";
    const { spawner, calls } = mockSpawner((cmd, args, input) => {
      if (args[0] === "-l") return stored ? { code: 0, stdout: stored, stderr: "" } : { code: 1, stdout: "", stderr: "no crontab for me" };
      if (args[0] === "-") { stored = input ?? ""; return { code: 0, stdout: "", stderr: "" }; }
      return undefined;
    });
    await cronAdapter.install(target(), spawner);
    expect(calls[0]?.args).toEqual(["-l"]);
    expect(calls[1]?.args).toEqual(["-"]);
    expect(stored).toContain(CRON_BEGIN);
    expect((await cronAdapter.status(target(), spawner)).installed).toBe(true);
    await cronAdapter.uninstall(target(), spawner);
    expect(stored).not.toContain(CRON_BEGIN);
    expect((await cronAdapter.status(target(), spawner)).installed).toBe(false);
  });
});

describe("systemd", () => {
  it("renders unit files and enables the timer", async () => {
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "ck-systemd-"));
    const t = target({ homeDir, codexHome: "/srv/codex" });
    expect(renderService(t)).toContain(`ExecStart="/opt/node & co/bin/node" "${t.scriptPath}" sync --scheduled`);
    expect(renderService(t)).toContain("Environment=CODEX_HOME=/srv/codex");
    expect(renderTimer()).toContain("OnUnitActiveSec=15min");
    expect(renderTimer()).toContain("Persistent=true");
    const { spawner, calls } = mockSpawner(() => undefined);
    await systemdAdapter.install(t, spawner);
    expect(existsSync(path.join(systemdDir(homeDir), "codex-kaboo-sync.service"))).toBe(true);
    expect(existsSync(path.join(systemdDir(homeDir), "codex-kaboo-sync.timer"))).toBe(true);
    expect(calls.map((c) => c.args.join(" "))).toEqual(["--user daemon-reload", "--user enable --now codex-kaboo-sync.timer"]);
    await systemdAdapter.uninstall(t, spawner);
    expect(existsSync(path.join(systemdDir(homeDir), "codex-kaboo-sync.timer"))).toBe(false);
  });
});

describe("schtasks", () => {
  it("renders a hidden VBS runner with doubled quotes and the schtasks arguments", async () => {
    const t = target({ nodePath: "C:\\Program Files\\nodejs\\node.exe", scriptPath: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\codex-kaboo-cli\\dist\\codex-kaboo.js", kabooHome: "C:\\Users\\me\\.codex-kaboo", homeDir: "C:\\Users\\me", codexHome: "D:\\codex" });
    const vbs = renderVbs(t);
    expect(vbs).toContain('Set sh = CreateObject("WScript.Shell")');
    expect(vbs).toContain('sh.Environment("Process")("CODEX_KABOO_SCHEDULED") = "1"');
    expect(vbs).toContain('sh.Environment("Process")("CODEX_HOME") = "D:\\codex"');
    expect(vbs).toContain('sh.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\codex-kaboo-cli\\dist\\codex-kaboo.js"" sync --scheduled", 0, False');
    expect(vbsQuote('a"b')).toBe('"a""b"');
    expect(schtasksCreateArgs('wscript.exe //B //Nologo "C:\\x\\sync-hidden.vbs"')).toEqual(["/Create", "/F", "/SC", "MINUTE", "/MO", "15", "/TN", TASK_NAME, "/TR", 'wscript.exe //B //Nologo "C:\\x\\sync-hidden.vbs"']);
    expect(parseSchtasksStatus("Status: Ready")).toEqual({ healthy: true, detail: "Ready" });
    expect(parseSchtasksStatus("Status: Disabled")).toEqual({ healthy: false, detail: "Disabled" });
    expect(parseSchtasksStatus("Statut: Prêt")).toEqual({ healthy: true, detail: "Prêt" });
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "ck-schtasks-"));
    const kabooHome = path.join(homeDir, ".codex-kaboo");
    const { spawner, calls } = mockSpawner((cmd, args) => (cmd === "where" ? { code: 0, stdout: "C:\\Windows\\System32\\wscript.exe", stderr: "" } : undefined));
    await schtasksAdapter.install({ ...t, homeDir, kabooHome }, spawner);
    expect(existsSync(path.join(kabooHome, "sync-hidden.vbs"))).toBe(true);
    const create = calls.find((c) => c.command === "schtasks" && c.args[0] === "/Create")!;
    expect(create.args[create.args.length - 1]).toContain("wscript.exe //B //Nologo");
    const status = await schtasksAdapter.status({ ...t, homeDir, kabooHome }, mockSpawner(() => ({ code: 0, stdout: "TaskName: \\codex-kaboo-sync\nStatus: Ready\n", stderr: "" })).spawner);
    expect(status).toMatchObject({ installed: true }); // `healthy` depends on checkTargetPaths, which cannot see the fake C:\ paths
    expect((await schtasksAdapter.status(t, mockSpawner(() => ({ code: 1, stdout: "", stderr: "ERROR: The system cannot find the file specified." })).spawner)).installed).toBe(false);
  });
});

describe("index", () => {
  it("picks the scheduler per platform and detects missing paths", async () => {
    expect(pickScheduler("darwin", {}).name).toBe("launchd");
    expect(pickScheduler("win32", {}).name).toBe("schtasks");
    expect(pickScheduler("linux", {}).name).toBe("cron");
    expect(pickScheduler("linux", { systemd: true }).name).toBe("systemd");
    const dir = mkdtempSync(path.join(os.tmpdir(), "ck-paths-"));
    const script = path.join(dir, "codex-kaboo.js");
    writeFileSync(script, "");
    expect(await checkTargetPaths(target({ nodePath: process.execPath, scriptPath: script }))).toEqual([]);
    expect(await checkTargetPaths(target({ nodePath: path.join(dir, "missing-node"), scriptPath: script }))).toEqual([path.join(dir, "missing-node")]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/schedule/...`.

- [ ] **Step 3: Write `cli/src/schedule/index.ts`**

```ts
import { promises as fs } from "node:fs";
import { cronAdapter } from "./cron";
import { launchdAdapter } from "./launchd";
import { schtasksAdapter } from "./schtasks";
import { systemdAdapter } from "./systemd";

export const SCHEDULE_INTERVAL_SECONDS = 900;

export interface ScheduleTarget {
  nodePath: string; // process.execPath at install time
  scriptPath: string; // realpath of dist/codex-kaboo.js
  kabooHome: string;
  homeDir: string;
  codexHome?: string; // CODEX_HOME captured at install time
  uid?: number;
  pathEnv?: string;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface Spawner {
  run(command: string, args: string[], opts?: { input?: string }): Promise<SpawnResult>;
}

export interface ScheduleStatus {
  installed: boolean;
  healthy: boolean;
  detail: string;
}

export type SchedulerName = "launchd" | "cron" | "systemd" | "schtasks";

export interface SchedulerAdapter {
  name: SchedulerName;
  install(target: ScheduleTarget, spawner: Spawner): Promise<string>;
  uninstall(target: ScheduleTarget, spawner: Spawner): Promise<string>;
  status(target: ScheduleTarget, spawner: Spawner): Promise<ScheduleStatus>;
}

export function scheduledArgs(): string[] {
  return ["sync", "--scheduled"];
}

export function pickScheduler(platform: string, opts: { systemd?: boolean }): SchedulerAdapter {
  if (platform === "darwin") return launchdAdapter;
  if (platform === "win32") return schtasksAdapter;
  return opts.systemd ? systemdAdapter : cronAdapter;
}

/** Paths baked into the schedule that no longer exist (nvm upgrades move node). */
export async function checkTargetPaths(target: ScheduleTarget): Promise<string[]> {
  const missing: string[] = [];
  for (const p of [target.nodePath, target.scriptPath]) {
    try {
      await fs.access(p);
    } catch {
      missing.push(p);
    }
  }
  return missing;
}
```

- [ ] **Step 4: Write `cli/src/schedule/launchd.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { SCHEDULE_INTERVAL_SECONDS, checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget } from "./index";

export const LAUNCHD_LABEL = "com.codex-kaboo.sync";

/** macOS-only generator: `path.posix` so the plist is byte-identical wherever the tests run (Windows CI included). */
export function plistPath(homeDir: string): string {
  return path.posix.join(homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderPlist(target: ScheduleTarget): string {
  const args = [target.nodePath, target.scriptPath, ...scheduledArgs()];
  const log = path.posix.join(target.kabooHome, "launchd.log");
  const env: [string, string][] = [
    ["PATH", target.pathEnv ?? "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"],
    ["CODEX_KABOO_SCHEDULED", "1"],
  ];
  if (target.codexHome) env.push(["CODEX_HOME", target.codexHome]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((a) => `    <string>${xmlEscape(a)}</string>`),
    "  </array>",
    "  <key>StartInterval</key>",
    `  <integer>${SCHEDULE_INTERVAL_SECONDS}</integer>`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(log)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(log)}</string>`,
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...env.flatMap(([k, v]) => [`    <key>${xmlEscape(k)}</key>`, `    <string>${xmlEscape(v)}</string>`]),
    "  </dict>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function domain(target: ScheduleTarget): string {
  return `gui/${target.uid ?? 501}`;
}

export const launchdAdapter: SchedulerAdapter = {
  name: "launchd",
  async install(target, spawner) {
    const file = plistPath(target.homeDir);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, renderPlist(target), "utf8");
    await spawner.run("launchctl", ["bootout", `${domain(target)}/${LAUNCHD_LABEL}`]); // ignore failure: not loaded yet
    const bootstrap = await spawner.run("launchctl", ["bootstrap", domain(target), file]);
    if (bootstrap.code !== 0) {
      const legacy = await spawner.run("launchctl", ["load", "-w", file]);
      if (legacy.code !== 0) throw new Error(`launchctl bootstrap failed: ${bootstrap.stderr.trim() || legacy.stderr.trim()}`);
    }
    await spawner.run("launchctl", ["kickstart", "-k", `${domain(target)}/${LAUNCHD_LABEL}`]);
    return `launchd agent ${LAUNCHD_LABEL} installed (${file}), runs every 15 minutes`;
  },
  async uninstall(target, spawner) {
    const file = plistPath(target.homeDir);
    await spawner.run("launchctl", ["bootout", `${domain(target)}/${LAUNCHD_LABEL}`]);
    await fs.rm(file, { force: true });
    return `launchd agent ${LAUNCHD_LABEL} removed`;
  },
  async status(target, spawner) {
    const file = plistPath(target.homeDir);
    let hasPlist = false;
    try {
      await fs.access(file);
      hasPlist = true;
    } catch {
      hasPlist = false;
    }
    const print = await spawner.run("launchctl", ["print", `${domain(target)}/${LAUNCHD_LABEL}`]);
    const installed = print.code === 0 || hasPlist;
    const missing = await checkTargetPaths(target);
    if (!installed) return { installed: false, healthy: false, detail: "not installed" };
    if (missing.length > 0) return { installed: true, healthy: false, detail: `schedule broken: missing ${missing.join(", ")}; run \`codex-kaboo install\` again` };
    return { installed: true, healthy: print.code === 0, detail: print.code === 0 ? "loaded" : "plist present but not loaded (log in again or run `codex-kaboo install`)" };
  },
};
```

- [ ] **Step 5: Write `cli/src/schedule/cron.ts`**

```ts
import path from "node:path";
import { checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget, type Spawner } from "./index";

export const CRON_BEGIN = "# BEGIN codex-kaboo";
export const CRON_END = "# END codex-kaboo";

/** POSIX-only generator: `path.posix` so the crontab line is byte-identical wherever the tests run (Windows CI included). */
export function renderCronLine(target: ScheduleTarget): string {
  const env = ["CODEX_KABOO_SCHEDULED=1", ...(target.codexHome ? [`CODEX_HOME="${target.codexHome}"`] : [])].join(" ");
  const log = path.posix.join(target.kabooHome, "cron.log");
  return `*/15 * * * * ${env} "${target.nodePath}" "${target.scriptPath}" ${scheduledArgs().join(" ")} >> "${log}" 2>&1`;
}

export function removeCronBlock(existing: string): string {
  const lines = existing.split("\n");
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === CRON_BEGIN) {
      inside = true;
      continue;
    }
    if (line.trim() === CRON_END) {
      inside = false;
      continue;
    }
    if (!inside) out.push(line);
  }
  let text = out.join("\n");
  text = text.replace(/\n+$/, "");
  return text.length > 0 ? `${text}\n` : "";
}

/** Replaces (or appends) the marker block; running it twice yields the same crontab. */
export function upsertCronBlock(existing: string, line: string): string {
  const base = removeCronBlock(existing);
  return `${base}${CRON_BEGIN}\n${line}\n${CRON_END}\n`;
}

async function readCrontab(spawner: Spawner): Promise<string> {
  const result = await spawner.run("crontab", ["-l"]);
  if (result.code === 0) return result.stdout;
  if (/no crontab/i.test(result.stderr) || result.stdout.trim() === "") return "";
  throw new Error(`crontab -l failed: ${result.stderr.trim()}`);
}

export const cronAdapter: SchedulerAdapter = {
  name: "cron",
  async install(target, spawner) {
    const next = upsertCronBlock(await readCrontab(spawner), renderCronLine(target));
    const result = await spawner.run("crontab", ["-"], { input: next });
    if (result.code !== 0) throw new Error(`crontab - failed: ${result.stderr.trim()}`);
    return "crontab entry installed (every 15 minutes)";
  },
  async uninstall(target, spawner) {
    const next = removeCronBlock(await readCrontab(spawner));
    const result = await spawner.run("crontab", ["-"], { input: next });
    if (result.code !== 0) throw new Error(`crontab - failed: ${result.stderr.trim()}`);
    return "crontab entry removed";
  },
  async status(target, spawner) {
    const current = await readCrontab(spawner);
    const installed = current.includes(CRON_BEGIN);
    if (!installed) return { installed: false, healthy: false, detail: "not installed" };
    const missing = await checkTargetPaths(target);
    if (missing.length > 0) return { installed: true, healthy: false, detail: `schedule broken: missing ${missing.join(", ")}; run \`codex-kaboo install\` again` };
    return { installed: true, healthy: true, detail: "crontab entry present" };
  },
};
```

- [ ] **Step 6: Write `cli/src/schedule/systemd.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget } from "./index";

const UNIT = "codex-kaboo-sync";

export function systemdDir(homeDir: string): string {
  return path.join(homeDir, ".config", "systemd", "user");
}

export function renderService(target: ScheduleTarget): string {
  const env = ["Environment=CODEX_KABOO_SCHEDULED=1", ...(target.codexHome ? [`Environment=CODEX_HOME=${target.codexHome}`] : [])];
  return [
    "[Unit]",
    "Description=codex-kaboo sync",
    "",
    "[Service]",
    "Type=oneshot",
    ...env,
    `ExecStart="${target.nodePath}" "${target.scriptPath}" ${scheduledArgs().join(" ")}`,
    "",
  ].join("\n");
}

export function renderTimer(): string {
  return [
    "[Unit]",
    "Description=codex-kaboo sync every 15 minutes",
    "",
    "[Timer]",
    "OnBootSec=2min",
    "OnUnitActiveSec=15min",
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

export const systemdAdapter: SchedulerAdapter = {
  name: "systemd",
  async install(target, spawner) {
    const dir = systemdDir(target.homeDir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${UNIT}.service`), renderService(target), "utf8");
    await fs.writeFile(path.join(dir, `${UNIT}.timer`), renderTimer(), "utf8");
    const reload = await spawner.run("systemctl", ["--user", "daemon-reload"]);
    if (reload.code !== 0) throw new Error(`systemctl --user daemon-reload failed: ${reload.stderr.trim()}`);
    const enable = await spawner.run("systemctl", ["--user", "enable", "--now", `${UNIT}.timer`]);
    if (enable.code !== 0) throw new Error(`systemctl --user enable failed: ${enable.stderr.trim()}`);
    return `systemd user timer ${UNIT}.timer enabled (every 15 minutes)`;
  },
  async uninstall(target, spawner) {
    const dir = systemdDir(target.homeDir);
    await spawner.run("systemctl", ["--user", "disable", "--now", `${UNIT}.timer`]);
    await fs.rm(path.join(dir, `${UNIT}.service`), { force: true });
    await fs.rm(path.join(dir, `${UNIT}.timer`), { force: true });
    await spawner.run("systemctl", ["--user", "daemon-reload"]);
    return `systemd user timer ${UNIT}.timer removed`;
  },
  async status(target, spawner) {
    const active = await spawner.run("systemctl", ["--user", "is-active", `${UNIT}.timer`]);
    if (active.code !== 0) return { installed: false, healthy: false, detail: `timer not active (${active.stdout.trim() || active.stderr.trim() || "unknown"})` };
    const missing = await checkTargetPaths(target);
    if (missing.length > 0) return { installed: true, healthy: false, detail: `schedule broken: missing ${missing.join(", ")}; run \`codex-kaboo install --systemd\` again` };
    return { installed: true, healthy: true, detail: "timer active" };
  },
};
```

- [ ] **Step 7: Write `cli/src/schedule/schtasks.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget, type Spawner } from "./index";

export const TASK_NAME = "codex-kaboo-sync";

/** VBScript string literal: wrap in quotes, double any inner quote. */
export function vbsQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function vbsPath(kabooHome: string): string {
  return path.join(kabooHome, "sync-hidden.vbs");
}

/** Hidden runner: no console window flashes every 15 minutes (WScript.Shell.Run … , 0, False). */
export function renderVbs(target: ScheduleTarget): string {
  const command = `"${target.nodePath}" "${target.scriptPath}" ${scheduledArgs().join(" ")}`;
  const lines = [
    'Set sh = CreateObject("WScript.Shell")',
    'sh.Environment("Process")("CODEX_KABOO_SCHEDULED") = "1"',
  ];
  if (target.codexHome) lines.push(`sh.Environment("Process")("CODEX_HOME") = ${vbsQuote(target.codexHome)}`);
  lines.push(`sh.Run ${vbsQuote(command)}, 0, False`, "");
  return lines.join("\r\n");
}

/** Fallback when wscript.exe is unavailable (a console may flash briefly). */
export function renderPowershellCommand(target: ScheduleTarget): string {
  const ps = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  return `powershell.exe -NoProfile -WindowStyle Hidden -Command "& ${ps(target.nodePath)} ${ps(target.scriptPath)} ${scheduledArgs().join(" ")}"`;
}

export function schtasksCreateArgs(command: string): string[] {
  return ["/Create", "/F", "/SC", "MINUTE", "/MO", "15", "/TN", TASK_NAME, "/TR", command];
}

export function schtasksDeleteArgs(): string[] {
  return ["/Delete", "/F", "/TN", TASK_NAME];
}

export function schtasksQueryArgs(): string[] {
  return ["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"];
}

/** Loose, localisation-tolerant status parsing: the first "<label>: <value>" line that looks like a status. */
export function parseSchtasksStatus(stdout: string): { healthy: boolean; detail: string } {
  const line = stdout.split(/\r?\n/).find((l) => /^\s*(status|statut|zustand|estado|stato|状态)\s*:/i.test(l));
  const detail = line ? (line.split(":").slice(1).join(":").trim() || "unknown") : "unknown";
  if (/disabled|désactiv|deaktiviert|deshabilit|disabilit|已禁用/i.test(detail)) return { healthy: false, detail };
  return { healthy: true, detail };
}

async function hasWscript(spawner: Spawner): Promise<boolean> {
  const result = await spawner.run("where", ["wscript.exe"]);
  return result.code === 0 && result.stdout.trim().length > 0;
}

export const schtasksAdapter: SchedulerAdapter = {
  name: "schtasks",
  async install(target, spawner) {
    let command: string;
    if (await hasWscript(spawner)) {
      const file = vbsPath(target.kabooHome);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, renderVbs(target), "utf8");
      command = `wscript.exe //B //Nologo "${file}"`;
    } else {
      command = renderPowershellCommand(target);
    }
    const result = await spawner.run("schtasks", schtasksCreateArgs(command));
    if (result.code !== 0) throw new Error(`schtasks /Create failed: ${result.stderr.trim() || result.stdout.trim()}`);
    return `scheduled task ${TASK_NAME} created (every 15 minutes)`;
  },
  async uninstall(target, spawner) {
    await spawner.run("schtasks", schtasksDeleteArgs());
    await fs.rm(vbsPath(target.kabooHome), { force: true });
    return `scheduled task ${TASK_NAME} deleted`;
  },
  async status(target, spawner) {
    const query = await spawner.run("schtasks", schtasksQueryArgs());
    if (query.code !== 0) return { installed: false, healthy: false, detail: "not installed" };
    const missing = await checkTargetPaths(target);
    if (missing.length > 0) return { installed: true, healthy: false, detail: `schedule broken: missing ${missing.join(", ")}; run \`codex-kaboo install\` again` };
    const parsed = parseSchtasksStatus(query.stdout);
    return { installed: true, healthy: parsed.healthy, detail: parsed.detail };
  },
};
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS. (The circular imports between `index.ts` and the adapters are type-only plus function references used lazily at call time, which TypeScript and esbuild resolve fine; if ESLint's `import/no-cycle` is ever enabled, move the shared types to `schedule/types.ts`.)

- [ ] **Step 9: Commit**

```bash
git add cli/src/schedule cli/test/schedule
git commit -F - <<'MSG'
Add scheduler generators and adapters for launchd, cron, systemd and schtasks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 23: `util/spawn.ts` and the `install`, `uninstall`, `status`, `doctor` commands

**Files:**
- Create: `cli/src/util/spawn.ts`, `cli/src/commands/schedule-deps.ts`, `cli/src/commands/install.ts`, `cli/src/commands/uninstall.ts`, `cli/src/commands/status.ts`, `cli/src/commands/doctor.ts`
- Test: `cli/test/util/spawn.test.ts`, `cli/test/commands/schedule-commands.test.ts`

**Interfaces:**
- Consumes: `Spawner`, `SpawnResult`, `ScheduleTarget`, `pickScheduler`, `SchedulerName` (schedule/index); `readConfig` (core/config); `readState` (core/state); `resolveCodexHomes`, `KabooPaths` (core/paths); `discoverRolloutFiles` (core/discover); `SyncClient` (upload/client); `SyncReport` (commands/sync); `meetsVersion` (util/version); `zstdSupported` (core/jsonl-reader); `Logger`.
- Produces: `nodeSpawner: Spawner`; `interface ScheduleDeps { paths; env; platform; execPath; scriptPath; homeDir; uid?; spawner; log }`, `buildScheduleTarget(deps)`; `runInstall({ systemd, json }, deps & { runSync })` → `{ ok; exitCode; scheduler; detail; sync: SyncReport | null }`; `runUninstall({ systemd, json }, deps)` → `{ ok; exitCode; scheduler; detail }`; `runStatus(deps & { cliVersion; codexHomeOverride?; systemd? })` → `StatusReport`; `formatStatus(report)` → `string[]`; `runDoctor(deps & { cliVersion; nodeVersion; createClient; codexHomeOverride?; systemd? })` → `DoctorReport { ok; exitCode; checks: { name; ok; detail }[] }`; `formatDoctor(report)` → `string[]`.

- [ ] **Step 1: Write the failing tests**

`cli/test/util/spawn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nodeSpawner } from "../../src/util/spawn";

describe("nodeSpawner", () => {
  it("captures stdout, exit codes, stdin and missing commands", async () => {
    const ok = await nodeSpawner.run(process.execPath, ["-e", "process.stdout.write('hi'); process.exit(3)"]);
    expect(ok).toEqual({ code: 3, stdout: "hi", stderr: "" });
    const echo = await nodeSpawner.run(process.execPath, ["-e", "process.stdin.on('data', d => process.stdout.write(d))"], { input: "abc" });
    expect(echo.stdout).toBe("abc");
    const missing = await nodeSpawner.run("definitely-not-a-command-xyz", []);
    expect(missing.code).toBeNull();
    expect(missing.stderr.length).toBeGreaterThan(0);
  });
});
```

`cli/test/commands/schedule-commands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDoctor } from "../../src/commands/doctor";
import { runInstall } from "../../src/commands/install";
import { buildScheduleTarget, type ScheduleDeps } from "../../src/commands/schedule-deps";
import { formatStatus, runStatus } from "../../src/commands/status";
import type { SyncReport } from "../../src/commands/sync";
import { runUninstall } from "../../src/commands/uninstall";
import { writeConfig } from "../../src/core/config";
import { kabooPaths } from "../../src/core/paths";
import { emptyState, writeState } from "../../src/core/state";
import { plistPath } from "../../src/schedule/launchd";
import type { Spawner, SpawnResult } from "../../src/schedule/index";
import type { SyncClient } from "../../src/upload/client";
import { silentLogger } from "../../src/util/log";
import { FIXTURE_HOME } from "../fixture-ids";

function mockSpawner(handler: (command: string, args: string[]) => SpawnResult | undefined) {
  const calls: { command: string; args: string[] }[] = [];
  const spawner: Spawner = {
    async run(command, args) {
      calls.push({ command, args });
      return handler(command, args) ?? { code: 0, stdout: "", stderr: "" };
    },
  };
  return { spawner, calls };
}

const emptyReport: SyncReport = {
  ok: true, exitCode: 0, dryRun: false, loggedIn: true, durationMs: 1, homes: [], files: [], uploads: { sessions: 0, events: 0, requests: 0 },
  accepted: null, conflicts: null, heartbeat: false, latestCliVersion: null, rateLimit: null, warnings: [], errors: [],
};

async function setup(loggedIn = true) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ck-cmd-"));
  const codexHome = path.join(root, "codex");
  cpSync(FIXTURE_HOME, codexHome, { recursive: true });
  const paths = kabooPaths(path.join(root, "kaboo"));
  if (loggedIn) await writeConfig(paths, { server: "https://x.convex.site", token: "ck_t", machineId: "m-1", label: "brisk-otter", hostnameOptIn: false, codexHomes: [codexHome], userName: "Ada", userEmail: "ada@example.com" });
  const script = path.join(root, "codex-kaboo.js");
  writeFileSync(script, "");
  const { spawner, calls } = mockSpawner((cmd, args) => (cmd === "launchctl" && args[0] === "print" ? { code: 0, stdout: "state = running", stderr: "" } : undefined));
  const deps: ScheduleDeps = { paths, env: { CODEX_HOME: codexHome }, platform: "darwin", execPath: process.execPath, scriptPath: script, homeDir: path.join(root, "home"), uid: 501, spawner, log: silentLogger };
  return { root, codexHome, paths, deps, calls, script };
}

describe("install / uninstall", () => {
  it("builds the target from realpaths, installs the scheduler, then runs one sync", async () => {
    const s = await setup();
    const target = await buildScheduleTarget(s.deps);
    expect(target).toMatchObject({ nodePath: realpathSync(process.execPath), kabooHome: s.paths.home, codexHome: s.codexHome, uid: 501 }); // buildScheduleTarget realpaths execPath (nvm/homebrew symlinks)
    let synced = 0;
    const result = await runInstall({ systemd: false, json: false }, { ...s.deps, runSync: async () => { synced += 1; return emptyReport; } });
    expect(result).toMatchObject({ ok: true, exitCode: 0, scheduler: "launchd" });
    expect(existsSync(plistPath(s.deps.homeDir))).toBe(true);
    expect(synced).toBe(1);
    expect(s.calls.some((c) => c.args[0] === "bootstrap")).toBe(true);
    const removed = await runUninstall({ systemd: false, json: false }, s.deps);
    expect(removed).toMatchObject({ ok: true, scheduler: "launchd" });
    expect(existsSync(plistPath(s.deps.homeDir))).toBe(false);
  });
  it("refuses to install when not logged in", async () => {
    const s = await setup(false);
    const result = await runInstall({ systemd: false, json: false }, { ...s.deps, runSync: async () => emptyReport });
    expect(result.exitCode).toBe(2);
    expect(result.detail).toContain("codex-kaboo login");
  });
});

describe("status", () => {
  it("reports config, homes, last sync and scheduler state", async () => {
    const s = await setup();
    const state = emptyState();
    state.lastSyncAt = 5;
    state.lastSyncOk = false;
    state.lastError = "boom";
    state.files["x"] = { path: "/p", offset: 1, lines: 1, size: 1, mtimeMs: 1, tail: "", lastUploadedSeq: 0, summaryHash: null, generation: 0, complete: false, lastError: "bad" };
    await writeState(s.paths, state);
    await runInstall({ systemd: false, json: false }, { ...s.deps, runSync: async () => emptyReport });
    const report = await runStatus({ ...s.deps, cliVersion: "0.1.0" });
    expect(report).toMatchObject({
      loggedIn: true, server: "https://x.convex.site", label: "brisk-otter", machineId: "m-1", user: { name: "Ada", email: "ada@example.com" },
      lastSync: { at: 5, ok: false, error: "boom" }, filesTracked: 1, filesWithErrors: 1, cliVersion: "0.1.0",
      scheduler: { name: "launchd", installed: true, healthy: true },
    });
    expect(report.codexHomes[0]).toMatchObject({ path: s.codexHome, exists: true });
    expect(report.codexHomes[0]?.files).toBeGreaterThanOrEqual(8);
    const lines = formatStatus(report);
    expect(lines.join("\n")).toContain("brisk-otter");
    expect(lines.join("\n")).toContain("launchd");
    const missing = await runStatus({ ...s.deps, scriptPath: path.join(s.root, "gone.js"), cliVersion: "0.1.0" });
    expect(missing.scheduler.healthy).toBe(false);
    expect(missing.scheduler.detail).toContain("schedule broken");
  });
});

describe("doctor", () => {
  it("runs every check and fails on an invalid token", async () => {
    const s = await setup();
    await runInstall({ systemd: false, json: false }, { ...s.deps, runSync: async () => emptyReport });
    const good: SyncClient = { async whoami() { return { ok: true, userId: "u1", name: "Ada", email: null, token: { name: "mac", prefix: "ck_t" }, serverTime: 1 }; }, async sync() { throw new Error("unused"); }, async health() { return { ok: true, serverTime: 1 }; } };
    const report = await runDoctor({ ...s.deps, cliVersion: "0.1.0", nodeVersion: "24.17.0", createClient: () => good });
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual(["node", "codex home", "login", "token", "scheduler", "state"]);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    const bad: SyncClient = { ...good, async whoami() { throw new Error("401 unauthorized"); } };
    const failing = await runDoctor({ ...s.deps, cliVersion: "0.1.0", nodeVersion: "18.0.0", createClient: () => bad });
    expect(failing.ok).toBe(false);
    expect(failing.exitCode).toBe(1);
    expect(failing.checks.find((c) => c.name === "token")?.ok).toBe(false);
    expect(failing.checks.find((c) => c.name === "node")?.detail).toContain("22.15");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find the new modules.

- [ ] **Step 3: Write `cli/src/util/spawn.ts` and `cli/src/commands/schedule-deps.ts`**

`cli/src/util/spawn.ts`:

```ts
import { spawn } from "node:child_process";
import type { Spawner, SpawnResult } from "../schedule/index";

/** Real child-process spawner: never throws, resolves { code: null } when the command cannot start. */
export const nodeSpawner: Spawner = {
  run(command, args, opts = {}) {
    return new Promise<SpawnResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      } catch (error) {
        resolve({ code: null, stdout, stderr: error instanceof Error ? error.message : String(error) });
        return;
      }
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => resolve({ code: null, stdout, stderr: stderr || error.message }));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      if (opts.input !== undefined) child.stdin?.end(opts.input);
      else child.stdin?.end();
    });
  },
};
```

`cli/src/commands/schedule-deps.ts`:

```ts
import { promises as fs } from "node:fs";
import type { KabooPaths } from "../core/paths";
import type { ScheduleTarget, Spawner } from "../schedule/index";
import type { Logger } from "../util/log";

export interface ScheduleDeps {
  paths: KabooPaths;
  env: NodeJS.ProcessEnv;
  platform: string;
  execPath: string;
  scriptPath: string; // process.argv[1]
  homeDir: string;
  uid?: number;
  spawner: Spawner;
  log: Logger;
}

/** The command the scheduler will run: realpaths so nvm/npm symlink changes are detectable later. */
export async function buildScheduleTarget(deps: ScheduleDeps): Promise<ScheduleTarget> {
  const realpath = async (p: string): Promise<string> => {
    try {
      return await fs.realpath(p);
    } catch {
      return p;
    }
  };
  const target: ScheduleTarget = {
    nodePath: await realpath(deps.execPath),
    scriptPath: await realpath(deps.scriptPath),
    kabooHome: deps.paths.home,
    homeDir: deps.homeDir,
  };
  if (deps.env.CODEX_HOME && deps.env.CODEX_HOME.trim().length > 0) target.codexHome = deps.env.CODEX_HOME.trim();
  if (deps.uid !== undefined) target.uid = deps.uid;
  if (deps.env.PATH) target.pathEnv = deps.env.PATH;
  return target;
}
```

- [ ] **Step 4: Write `install.ts` and `uninstall.ts`**

`cli/src/commands/install.ts`:

```ts
import { readConfig } from "../core/config";
import { pickScheduler, type SchedulerName } from "../schedule/index";
import { buildScheduleTarget, type ScheduleDeps } from "./schedule-deps";
import type { SyncReport } from "./sync";

export interface InstallOptions {
  systemd: boolean;
  json: boolean;
}

export interface InstallResult {
  ok: boolean;
  exitCode: number;
  scheduler: SchedulerName;
  detail: string;
  sync: SyncReport | null;
}

export async function runInstall(opts: InstallOptions, deps: ScheduleDeps & { runSync: () => Promise<SyncReport> }): Promise<InstallResult> {
  const adapter = pickScheduler(deps.platform, { systemd: opts.systemd });
  const config = await readConfig(deps.paths);
  if (config === null) {
    return { ok: false, exitCode: 2, scheduler: adapter.name, detail: "not logged in: run `codex-kaboo login` first", sync: null };
  }
  const target = await buildScheduleTarget(deps);
  let detail: string;
  try {
    detail = await adapter.install(target, deps.spawner);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log.error(message);
    return { ok: false, exitCode: 1, scheduler: adapter.name, detail: message, sync: null };
  }
  deps.log.info(detail);
  const sync = await deps.runSync();
  return { ok: sync.exitCode === 0, exitCode: sync.exitCode, scheduler: adapter.name, detail, sync };
}
```

`cli/src/commands/uninstall.ts`:

```ts
import { pickScheduler, type SchedulerName } from "../schedule/index";
import { buildScheduleTarget, type ScheduleDeps } from "./schedule-deps";

export interface UninstallResult {
  ok: boolean;
  exitCode: number;
  scheduler: SchedulerName;
  detail: string;
}

export async function runUninstall(opts: { systemd: boolean; json: boolean }, deps: ScheduleDeps): Promise<UninstallResult> {
  const adapter = pickScheduler(deps.platform, { systemd: opts.systemd });
  try {
    const detail = await adapter.uninstall(await buildScheduleTarget(deps), deps.spawner);
    deps.log.info(detail);
    return { ok: true, exitCode: 0, scheduler: adapter.name, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log.error(message);
    return { ok: false, exitCode: 1, scheduler: adapter.name, detail: message };
  }
}
```

- [ ] **Step 5: Write `status.ts` and `doctor.ts`**

`cli/src/commands/status.ts`:

```ts
import type { RateLimitSnapshot } from "@codex-kaboo/shared/sync";
import { readConfig } from "../core/config";
import { discoverRolloutFiles } from "../core/discover";
import { resolveCodexHomes } from "../core/paths";
import { readState } from "../core/state";
import { pickScheduler, type SchedulerName } from "../schedule/index";
import { buildScheduleTarget, type ScheduleDeps } from "./schedule-deps";

export interface StatusReport {
  cliVersion: string;
  loggedIn: boolean;
  server: string | null;
  label: string | null;
  machineId: string | null;
  hostnameOptIn: boolean;
  user: { name: string | null; email: string | null } | null;
  codexHomes: { path: string; exists: boolean; files: number }[];
  lastSync: { at: number; ok: boolean | null; error: string | null } | null;
  lastHeartbeatAt: number | null;
  rateLimit: RateLimitSnapshot | null;
  codexVersion: string | null;
  latestCliVersion: string | null;
  filesTracked: number;
  filesWithErrors: number;
  scheduler: { name: SchedulerName; installed: boolean; healthy: boolean; detail: string };
}

export async function runStatus(deps: ScheduleDeps & { cliVersion: string; codexHomeOverride?: string; systemd?: boolean }): Promise<StatusReport> {
  const config = await readConfig(deps.paths).catch(() => null);
  const { state } = await readState(deps.paths);
  const homes = resolveCodexHomes({ override: deps.codexHomeOverride, env: deps.env, configured: config?.codexHomes });
  const discovered = await discoverRolloutFiles(homes);
  const adapter = pickScheduler(deps.platform, { systemd: deps.systemd === true });
  const scheduler = await adapter.status(await buildScheduleTarget(deps), deps.spawner).catch((error: unknown) => ({
    installed: false, healthy: false, detail: error instanceof Error ? error.message : String(error),
  }));
  const files = Object.values(state.files);
  return {
    cliVersion: deps.cliVersion,
    loggedIn: config !== null,
    server: config?.server ?? null,
    label: config?.label ?? null,
    machineId: config?.machineId ?? null,
    hostnameOptIn: config?.hostnameOptIn ?? false,
    user: config ? { name: config.userName ?? null, email: config.userEmail ?? null } : null,
    codexHomes: discovered.homes,
    lastSync: state.lastSyncAt === null ? null : { at: state.lastSyncAt, ok: state.lastSyncOk, error: state.lastError },
    lastHeartbeatAt: state.lastHeartbeatAt,
    rateLimit: state.rateLimit,
    codexVersion: state.codexVersion,
    latestCliVersion: state.latestCliVersion,
    filesTracked: files.length,
    filesWithErrors: files.filter((f) => f.lastError !== null).length,
    scheduler: { name: adapter.name, ...scheduler },
  };
}

function when(ms: number | null): string {
  return ms === null ? "never" : new Date(ms).toISOString();
}

export function formatStatus(r: StatusReport): string[] {
  const lines = [
    `codex-kaboo ${r.cliVersion}${r.latestCliVersion && r.latestCliVersion !== r.cliVersion ? ` (latest ${r.latestCliVersion})` : ""}`,
    r.loggedIn ? `logged in: ${r.user?.name ?? r.user?.email ?? "yes"} → ${r.server}` : "not logged in (run `codex-kaboo login`)",
    `machine: ${r.label ?? "-"} (${r.machineId ?? "-"})${r.hostnameOptIn ? ", hostname shared" : ""}`,
    ...r.codexHomes.map((h) => `codex home: ${h.path} ${h.exists ? `(${h.files} rollout files)` : "(missing)"}`),
    `codex version: ${r.codexVersion ?? "unknown"}`,
    `last sync: ${r.lastSync ? `${when(r.lastSync.at)} ${r.lastSync.ok ? "ok" : `failed: ${r.lastSync.error ?? "unknown error"}`}` : "never"}`,
    `tracked files: ${r.filesTracked}${r.filesWithErrors > 0 ? ` (${r.filesWithErrors} with errors)` : ""}`,
    `scheduler: ${r.scheduler.name} ${r.scheduler.installed ? (r.scheduler.healthy ? "installed" : "INSTALLED BUT BROKEN") : "not installed"} — ${r.scheduler.detail}`,
  ];
  if (r.rateLimit) lines.push(`weekly quota: ${r.rateLimit.usedPercent}% used (observed ${when(r.rateLimit.observedAt)})`);
  return lines;
}
```

`cli/src/commands/doctor.ts`:

```ts
import { readConfig } from "../core/config";
import { discoverRolloutFiles } from "../core/discover";
import { resolveCodexHomes } from "../core/paths";
import { readState } from "../core/state";
import { pickScheduler } from "../schedule/index";
import type { Config } from "../types";
import type { SyncClient } from "../upload/client";
import { meetsVersion } from "../util/version";
import { buildScheduleTarget, type ScheduleDeps } from "./schedule-deps";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  exitCode: number;
  checks: DoctorCheck[];
}

export async function runDoctor(
  deps: ScheduleDeps & { cliVersion: string; nodeVersion: string; createClient: (config: Config) => SyncClient; codexHomeOverride?: string; systemd?: boolean },
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeOk = meetsVersion(deps.nodeVersion, "18.0.0");
  checks.push({
    name: "node",
    ok: nodeOk,
    detail: `${deps.nodeVersion}${meetsVersion(deps.nodeVersion, "22.15.0") ? "" : " (compressed .jsonl.zst rollouts need Node >= 22.15)"}${nodeOk ? "" : " — Node 18 or newer is required"}`,
  });
  const config = await readConfig(deps.paths).catch(() => null);
  const homes = resolveCodexHomes({ override: deps.codexHomeOverride, env: deps.env, configured: config?.codexHomes });
  const discovered = await discoverRolloutFiles(homes);
  const found = discovered.homes.filter((h) => h.exists);
  checks.push({
    name: "codex home",
    ok: found.length > 0,
    detail: found.length > 0 ? found.map((h) => `${h.path} (${h.files} rollout files)`).join(", ") : `none of ${homes.join(", ")} exists`,
  });
  checks.push({ name: "login", ok: config !== null, detail: config ? `${config.server} as ${config.userName ?? config.userEmail ?? config.machineId}` : "not logged in (run `codex-kaboo login`)" });
  if (config) {
    try {
      const who = await deps.createClient(config).whoami();
      checks.push({ name: "token", ok: true, detail: `valid (${who.token.name}, ${who.name ?? who.email ?? who.userId})` });
    } catch (error) {
      checks.push({ name: "token", ok: false, detail: `invalid or unreachable: ${error instanceof Error ? error.message : String(error)}` });
    }
  } else {
    checks.push({ name: "token", ok: false, detail: "no token configured" });
  }
  const adapter = pickScheduler(deps.platform, { systemd: deps.systemd === true });
  try {
    const status = await adapter.status(await buildScheduleTarget(deps), deps.spawner);
    checks.push({ name: "scheduler", ok: status.installed && status.healthy, detail: `${adapter.name}: ${status.detail}` });
  } catch (error) {
    checks.push({ name: "scheduler", ok: false, detail: `${adapter.name}: ${error instanceof Error ? error.message : String(error)}` });
  }
  const { state, corrupt } = await readState(deps.paths);
  const errored = Object.values(state.files).filter((f) => f.lastError !== null);
  checks.push({
    name: "state",
    ok: !corrupt && errored.length === 0,
    detail: corrupt ? "state.json is corrupt (it will be rebuilt on the next sync)" : errored.length === 0 ? `${Object.keys(state.files).length} files tracked` : `${errored.length} file(s) with errors: ${errored.map((f) => f.lastError).join("; ")}`,
  });
  const ok = checks.every((c) => c.ok);
  return { ok, exitCode: ok ? 0 : 1, checks };
}

export function formatDoctor(report: DoctorReport): string[] {
  return [...report.checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`), report.ok ? "all checks passed" : "some checks failed"];
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/src/util/spawn.ts cli/src/commands cli/test/util/spawn.test.ts cli/test/commands/schedule-commands.test.ts
git commit -F - <<'MSG'
Add install, uninstall, status and doctor commands with a real spawner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 24: `commands/login.ts` and `commands/logout.ts`

**Files:**
- Create: `cli/src/commands/login.ts`, `cli/src/commands/logout.ts`
- Test: `cli/test/commands/login.test.ts`

**Interfaces:**
- Consumes: `TOKEN_PREFIX` (shared constants); `readConfig`, `writeConfig`, `deleteConfig` (core/config); `KabooPaths`; `Config`; `SyncClient`; `randomLabel` (util/names); `Logger`.
- Produces: `interface LoginOptions { token?: string; server?: string; machineName?: string; hostname: boolean; json: boolean }`, `interface LoginDeps { paths; env; bakedServer: string | undefined; cliVersion; prompt(question): Promise<string>; createClient(config: Pick<Config, "server" | "token">): SyncClient; newId(); now(); log }`, `interface LoginResult { ok; exitCode; server; label; machineId; user: { userId; name; email } | null; token: { name; prefix } | null; error? }`, `runLogin(opts, deps)`, `normalizeServer(url)`; `runLogout({ paths, log })` → `{ ok: true; exitCode: 0; removed: boolean }`.

Rules (spec): server precedence `--server` → `CODEX_KABOO_SERVER` → baked value (missing → exit 2); the token is prompted when not passed and must start with `ck_`; `/api/v1/whoami` must succeed (otherwise exit 2 and nothing is written); the machine id is created once and kept across re-logins; the label defaults to a random adjective-animal and is kept unless `--machine-name` is given; `--hostname` opts in permanently until `logout`; `config.json` is written with mode 0600; `logout` removes only `config.json` (state keeps sync progress).

- [ ] **Step 1: Write the failing tests**

`cli/test/commands/login.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeServer, runLogin, type LoginDeps } from "../../src/commands/login";
import { runLogout } from "../../src/commands/logout";
import { readConfig } from "../../src/core/config";
import { kabooPaths } from "../../src/core/paths";
import { emptyState, writeState } from "../../src/core/state";
import type { SyncClient } from "../../src/upload/client";
import { silentLogger } from "../../src/util/log";

function deps(overrides: Partial<LoginDeps> = {}): LoginDeps {
  const paths = kabooPaths(path.join(mkdtempSync(path.join(os.tmpdir(), "ck-login-")), "home"));
  let ids = 0;
  const client: SyncClient = {
    async whoami() { return { ok: true, userId: "u1", name: "Ada", email: "ada@example.com", token: { name: "laptop", prefix: "ck_abc123" }, serverTime: 7 }; },
    async sync() { throw new Error("unused"); },
    async health() { return { ok: true, serverTime: 7 }; },
  };
  return {
    paths, env: {}, bakedServer: "https://baked.convex.site", cliVersion: "0.1.0", prompt: async () => "ck_prompted",
    createClient: () => client, newId: () => `machine-${++ids}`, now: () => 1234, log: silentLogger, ...overrides,
  };
}
const base = { hostname: false, json: false };

describe("runLogin", () => {
  it("writes a 0600 config with a fresh machine id and a random label, then keeps both", async () => {
    const d = deps();
    const first = await runLogin({ ...base, token: "ck_first" }, d);
    expect(first).toMatchObject({ ok: true, exitCode: 0, server: "https://baked.convex.site", machineId: "machine-1", user: { userId: "u1", name: "Ada" }, token: { name: "laptop", prefix: "ck_abc123" } });
    expect(first.label).toMatch(/^[a-z]+-[a-z]+$/);
    const config = await readConfig(d.paths);
    expect(config).toMatchObject({ server: "https://baked.convex.site", token: "ck_first", machineId: "machine-1", hostnameOptIn: false, userName: "Ada", userEmail: "ada@example.com", tokenName: "laptop", loggedInAt: 1234 });
    if (process.platform !== "win32") expect(statSync(d.paths.config).mode & 0o777).toBe(0o600);
    const second = await runLogin({ ...base, token: "ck_second", hostname: true }, d);
    expect(second.machineId).toBe("machine-1");
    expect(second.label).toBe(first.label);
    expect((await readConfig(d.paths))?.hostnameOptIn).toBe(true);
    expect((await readConfig(d.paths))?.token).toBe("ck_second");
    const renamed = await runLogin({ ...base, token: "ck_third", machineName: "work-laptop" }, d);
    expect(renamed.label).toBe("work-laptop");
    expect((await readConfig(d.paths))?.hostnameOptIn).toBe(true); // sticky
  });
  it("prompts for the token, prefers --server, then the env, then the baked server", async () => {
    const d0 = deps();
    const prompted = await runLogin(base, d0);
    expect(prompted.ok).toBe(true);
    expect((await readConfig(d0.paths))?.token).toBe("ck_prompted");
    const d = deps({ env: { CODEX_KABOO_SERVER: "https://env.convex.site/" } });
    expect((await runLogin({ ...base, token: "ck_x" }, d)).server).toBe("https://env.convex.site");
    expect((await runLogin({ ...base, token: "ck_x", server: "https://flag.convex.site" }, d)).server).toBe("https://flag.convex.site");
    const none = await runLogin({ ...base, token: "ck_x" }, deps({ bakedServer: undefined }));
    expect(none.exitCode).toBe(2);
    expect(none.error).toContain("--server");
    expect(normalizeServer("https://a.convex.site///")).toBe("https://a.convex.site");
    expect(normalizeServer("a.convex.site")).toBeNull();
  });
  it("rejects bad tokens without writing anything and keeps the old config when whoami fails", async () => {
    const d = deps();
    const bad = await runLogin({ ...base, token: "nope" }, d);
    expect(bad.exitCode).toBe(2);
    expect(existsSync(d.paths.config)).toBe(false);
    await runLogin({ ...base, token: "ck_good" }, d);
    const failing = deps({ paths: d.paths, createClient: () => ({ async whoami() { throw new Error("401 unauthorized"); }, async sync() { throw new Error("x"); }, async health() { return { ok: false, serverTime: null }; } }) });
    const rejected = await runLogin({ ...base, token: "ck_new" }, failing);
    expect(rejected.exitCode).toBe(2);
    expect(rejected.error).toContain("401");
    expect((await readConfig(d.paths))?.token).toBe("ck_good");
  });
});

describe("runLogout", () => {
  it("removes config.json but keeps state.json", async () => {
    const d = deps();
    await runLogin({ ...base, token: "ck_good" }, d);
    await writeState(d.paths, emptyState());
    expect(await runLogout({ paths: d.paths, log: silentLogger })).toEqual({ ok: true, exitCode: 0, removed: true });
    expect(existsSync(d.paths.config)).toBe(false);
    expect(existsSync(d.paths.state)).toBe(true);
    expect((await runLogout({ paths: d.paths, log: silentLogger })).removed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/commands/login` / `logout`.

- [ ] **Step 3: Write `cli/src/commands/login.ts`**

```ts
import { TOKEN_PREFIX } from "@codex-kaboo/shared/constants";
import { readConfig, writeConfig } from "../core/config";
import type { KabooPaths } from "../core/paths";
import type { Config } from "../types";
import type { SyncClient } from "../upload/client";
import type { Logger } from "../util/log";
import { randomLabel } from "../util/names";

export interface LoginOptions {
  token?: string;
  server?: string;
  machineName?: string;
  hostname: boolean;
  json: boolean;
}

export interface LoginDeps {
  paths: KabooPaths;
  env: NodeJS.ProcessEnv;
  bakedServer: string | undefined;
  cliVersion: string;
  prompt: (question: string) => Promise<string>;
  createClient: (config: Pick<Config, "server" | "token">) => SyncClient;
  newId: () => string;
  now: () => number;
  log: Logger;
}

export interface LoginResult {
  ok: boolean;
  exitCode: number;
  server: string;
  label: string;
  machineId: string;
  user: { userId: string; name: string | null; email: string | null } | null;
  token: { name: string; prefix: string } | null;
  error?: string;
}

/** Trims, strips trailing slashes, requires http(s). */
export function normalizeServer(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+/.test(trimmed) ? trimmed : null;
}

export async function runLogin(opts: LoginOptions, deps: LoginDeps): Promise<LoginResult> {
  const fail = (error: string, server = ""): LoginResult => ({ ok: false, exitCode: 2, server, label: "", machineId: "", user: null, token: null, error });
  const rawServer = opts.server ?? deps.env.CODEX_KABOO_SERVER ?? deps.bakedServer;
  if (!rawServer) return fail("no server configured: pass --server https://<deployment>.convex.site (or set CODEX_KABOO_SERVER)");
  const server = normalizeServer(rawServer);
  if (server === null) return fail(`invalid server URL "${rawServer}": expected https://<deployment>.convex.site (--server)`);

  const token = (opts.token ?? (await deps.prompt("Paste your sync token (ck_…): "))).trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length <= TOKEN_PREFIX.length) {
    return fail(`invalid token: expected a token starting with ${TOKEN_PREFIX} (create one in the dashboard under Settings → Sync tokens)`, server);
  }

  let who;
  try {
    who = await deps.createClient({ server, token }).whoami();
  } catch (error) {
    return fail(`the server rejected the token or is unreachable: ${error instanceof Error ? error.message : String(error)}`, server);
  }

  const existing = await readConfig(deps.paths).catch(() => null);
  const machineId = existing?.machineId ?? deps.newId();
  const requestedLabel = opts.machineName?.trim();
  const label = requestedLabel && requestedLabel.length > 0 ? requestedLabel.slice(0, 64) : (existing?.label ?? randomLabel());
  const config: Config = {
    server,
    token,
    machineId,
    label,
    hostnameOptIn: opts.hostname || (existing?.hostnameOptIn ?? false),
    codexHomes: existing?.codexHomes ?? [],
    userId: who.userId,
    userName: who.name,
    userEmail: who.email,
    tokenName: who.token.name,
    loggedInAt: deps.now(),
  };
  await writeConfig(deps.paths, config);
  deps.log.info(`logged in to ${server} as ${who.name ?? who.email ?? who.userId} (machine "${label}")`);
  return {
    ok: true,
    exitCode: 0,
    server,
    label,
    machineId,
    user: { userId: who.userId, name: who.name, email: who.email },
    token: { name: who.token.name, prefix: who.token.prefix },
  };
}
```

- [ ] **Step 4: Write `cli/src/commands/logout.ts`**

```ts
import { deleteConfig } from "../core/config";
import type { KabooPaths } from "../core/paths";
import type { Logger } from "../util/log";

/** Removes config.json (token, server, machine id). state.json is kept so a re-login resumes where it left off. */
export async function runLogout(deps: { paths: KabooPaths; log: Logger }): Promise<{ ok: true; exitCode: 0; removed: boolean }> {
  const removed = await deleteConfig(deps.paths);
  deps.log.info(removed ? "logged out: config.json removed (run `codex-kaboo uninstall` to stop the schedule)" : "not logged in");
  return { ok: true, exitCode: 0, removed };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/login.ts cli/src/commands/logout.ts cli/test/commands/login.test.ts
git commit -F - <<'MSG'
Add login and logout commands

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 25: `commands/format.ts`, full `main.ts` wiring, tsup build and `npm pack` check

**Files:**
- Create: `cli/src/commands/format.ts`
- Modify: `cli/src/main.ts` (replace the Task 1 stub)
- Test: `cli/test/commands/format.test.ts`

**Interfaces:**
- Consumes: every `run*` command, `SyncReport`, `summaryLine`, `formatStatus`, `formatDoctor`, `kabooPaths`, `machineZone`, `createClient`, `createLogger`, `nodeSpawner`, `CLI_VERSION`, `BAKED_SERVER`, `BAKED_WEB_ORIGIN`.
- Produces: `formatSyncReport(report: SyncReport): string[]`; the `codex-kaboo` executable with commands `login`, `logout`, `sync`, `install`, `uninstall`, `status`, `doctor`, global `--json` / `--verbose`, `--version`.

- [ ] **Step 1: Write the failing test**

`cli/test/commands/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatSyncReport } from "../../src/commands/format";
import type { SyncReport } from "../../src/commands/sync";

const report: SyncReport = {
  ok: false, exitCode: 1, dryRun: true, loggedIn: true, durationMs: 42,
  homes: [{ path: "/h/.codex", exists: true, files: 2 }],
  files: [
    { sessionId: "a", name: "rollout-a.jsonl", action: "parsed", newEvents: 3, summaryChanged: true },
    { sessionId: "b", name: "rollout-b.jsonl", action: "unchanged", newEvents: 0, summaryChanged: false },
    { sessionId: "c", name: "rollout-c.jsonl", action: "error", reason: "boom", newEvents: 0, summaryChanged: false },
  ],
  uploads: { sessions: 1, events: 3, requests: 1 }, accepted: null, conflicts: null, heartbeat: false,
  latestCliVersion: null, rateLimit: null, warnings: ["careful"], errors: ["boom"],
};

describe("formatSyncReport", () => {
  it("lists per-file actions, warnings, errors and the dry-run notice", () => {
    const lines = formatSyncReport(report);
    expect(lines[0]).toContain("/h/.codex (2 rollout files)");
    expect(lines).toContain("parsed    rollout-a.jsonl (+3 events, summary)");
    expect(lines).toContain("error     rollout-c.jsonl — boom");
    expect(lines.some((l) => l.startsWith("warning: careful"))).toBe(true);
    expect(lines.some((l) => l.startsWith("error: boom"))).toBe(true);
    expect(lines.some((l) => l.includes("dry run"))).toBe(true);
    expect(lines.some((l) => l.startsWith("sync failed:"))).toBe(true);
    const quiet = formatSyncReport({ ...report, dryRun: false, ok: true, exitCode: 0, errors: [], warnings: [], files: [] });
    expect(quiet.some((l) => l.includes("dry run"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w cli`
Expected: FAIL — cannot find `../../src/commands/format`.

- [ ] **Step 3: Write `cli/src/commands/format.ts`**

```ts
import { summaryLine, type SyncReport } from "./sync";

export function formatSyncReport(report: SyncReport): string[] {
  const lines: string[] = [];
  for (const home of report.homes) lines.push(`codex home: ${home.path} ${home.exists ? `(${home.files} rollout files)` : "(missing)"}`);
  for (const file of report.files) {
    if (file.action === "unchanged" && !report.dryRun) continue;
    const extra = file.action === "error" || file.action === "skipped"
      ? ` — ${file.reason ?? ""}`
      : file.newEvents > 0 || file.summaryChanged
        ? ` (+${file.newEvents} events${file.summaryChanged ? ", summary" : ""})`
        : "";
    lines.push(`${file.action.padEnd(9)} ${file.name}${extra}`);
  }
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  for (const error of report.errors) lines.push(`error: ${error}`);
  lines.push(summaryLine(report));
  if (report.dryRun) lines.push("dry run: nothing was sent and no state was written (use --json to inspect the exact payloads)");
  return lines;
}
```

- [ ] **Step 4: Replace `cli/src/main.ts`**

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { randomUUID } from "node:crypto";
import os from "node:os";
import readline from "node:readline";
import { BAKED_SERVER, BAKED_WEB_ORIGIN, CLI_VERSION } from "./build-info";
import { formatDoctor, runDoctor } from "./commands/doctor";
import { formatSyncReport } from "./commands/format";
import { runInstall } from "./commands/install";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";
import type { ScheduleDeps } from "./commands/schedule-deps";
import { formatStatus, runStatus } from "./commands/status";
import { runSync, type SyncDeps } from "./commands/sync";
import { runUninstall } from "./commands/uninstall";
import { kabooPaths } from "./core/paths";
import { machineZone } from "./parser/time";
import type { Config } from "./types";
import { createClient } from "./upload/client";
import { createLogger, type Logger } from "./util/log";
import { nodeSpawner } from "./util/spawn";

const paths = kabooPaths();

function makeLogger(opts: { quiet?: boolean; verbose?: boolean; toFile?: boolean }): Logger {
  return createLogger({
    ...(opts.toFile ? { file: paths.log } : {}),
    quiet: opts.quiet === true,
    verbose: opts.verbose === true,
    console: (line) => process.stderr.write(`${line}\n`),
  });
}

function clientFor(config: Pick<Config, "server" | "token">) {
  return createClient({ server: config.server, token: config.token, cliVersion: CLI_VERSION });
}

function syncDeps(log: Logger): SyncDeps {
  return {
    paths, env: process.env, now: () => Date.now(), log, cliVersion: CLI_VERSION, machineZone: machineZone(),
    newId: () => randomUUID(), createClient: clientFor, platform: process.platform, arch: process.arch,
    nodeVersion: process.versions.node, hostname: () => os.hostname(), pid: process.pid,
    ...(BAKED_WEB_ORIGIN ? { webOrigin: BAKED_WEB_ORIGIN } : {}),
  };
}

function scheduleDeps(log: Logger): ScheduleDeps {
  return {
    paths, env: process.env, platform: process.platform, execPath: process.execPath, scriptPath: process.argv[1] ?? __filename,
    homeDir: os.homedir(), ...(typeof process.getuid === "function" ? { uid: process.getuid() } : {}), spawner: nodeSpawner, log,
  };
}

function emit(json: boolean, data: unknown, lines: string[]): void {
  if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else for (const line of lines) process.stdout.write(`${line}\n`);
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise<string>((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

const program = new Command();
program
  .name("codex-kaboo")
  .description("Report Codex CLI usage metadata (never text or paths) to your codex-kaboo dashboard")
  .version(CLI_VERSION)
  .option("--json", "print machine-readable JSON on stdout")
  .option("--verbose", "debug logging on stderr");

const globals = (): { json: boolean; verbose: boolean } => {
  const o = program.opts<{ json?: boolean; verbose?: boolean }>();
  return { json: o.json === true, verbose: o.verbose === true };
};

program
  .command("login")
  .description("store a sync token for this machine (create one in the dashboard under Settings)")
  .option("--token <token>", "sync token (prompted when omitted)")
  .option("--server <url>", "dashboard API origin, https://<deployment>.convex.site")
  .option("--machine-name <name>", "label shown in the dashboard")
  .option("--hostname", "also upload this machine's hostname")
  .action(async (o: { token?: string; server?: string; machineName?: string; hostname?: boolean }) => {
    const g = globals();
    const result = await runLogin(
      { ...(o.token ? { token: o.token } : {}), ...(o.server ? { server: o.server } : {}), ...(o.machineName ? { machineName: o.machineName } : {}), hostname: o.hostname === true, json: g.json },
      { paths, env: process.env, bakedServer: BAKED_SERVER, cliVersion: CLI_VERSION, prompt: ask, createClient: clientFor, newId: () => randomUUID(), now: () => Date.now(), log: makeLogger({ verbose: g.verbose }) },
    );
    emit(g.json, result, result.ok
      ? [`logged in as ${result.user?.name ?? result.user?.email ?? result.user?.userId} (${result.server})`, `machine label: ${result.label}`, "next: codex-kaboo install"]
      : [`error: ${result.error ?? "login failed"}`]);
    process.exitCode = result.exitCode;
  });

program
  .command("logout")
  .description("forget the sync token on this machine")
  .action(async () => {
    const g = globals();
    const result = await runLogout({ paths, log: makeLogger({ verbose: g.verbose }) });
    emit(g.json, result, [result.removed ? "logged out" : "not logged in"]);
    process.exitCode = result.exitCode;
  });

program
  .command("sync")
  .description("parse new Codex rollout logs and upload metadata")
  .option("--full", "forget file progress and re-upload everything (safe: the server upserts)")
  .option("--dry-run", "parse and show what would be sent; no network, no state changes")
  .option("--scheduled", "quiet mode for the scheduler (exit 0 when not logged in)")
  .option("--codex-home <path>", "Codex home to scan (default: CODEX_HOME or ~/.codex)")
  .action(async (o: { full?: boolean; dryRun?: boolean; scheduled?: boolean; codexHome?: string }) => {
    const g = globals();
    const scheduled = o.scheduled === true || process.env.CODEX_KABOO_SCHEDULED === "1";
    const log = makeLogger({ quiet: scheduled || g.json, verbose: g.verbose, toFile: o.dryRun !== true });
    const report = await runSync(
      { full: o.full === true, dryRun: o.dryRun === true, scheduled, json: g.json, ...(o.codexHome ? { codexHome: o.codexHome } : {}) },
      syncDeps(log),
    );
    emit(g.json, report, formatSyncReport(report));
    process.exitCode = report.exitCode;
  });

program
  .command("install")
  .description("run sync every 15 minutes in the background (launchd / cron / schtasks)")
  .option("--systemd", "on Linux, use a systemd user timer instead of cron")
  .action(async (o: { systemd?: boolean }) => {
    const g = globals();
    const log = makeLogger({ verbose: g.verbose, toFile: true });
    const result = await runInstall({ systemd: o.systemd === true, json: g.json }, {
      ...scheduleDeps(log),
      runSync: () => runSync({ full: false, dryRun: false, scheduled: false, json: g.json }, syncDeps(log)),
    });
    emit(g.json, result, [result.detail, ...(result.sync ? formatSyncReport(result.sync) : [])]);
    process.exitCode = result.exitCode;
  });

program
  .command("uninstall")
  .description("remove the background schedule")
  .option("--systemd", "on Linux, remove the systemd user timer")
  .action(async (o: { systemd?: boolean }) => {
    const g = globals();
    const result = await runUninstall({ systemd: o.systemd === true, json: g.json }, scheduleDeps(makeLogger({ verbose: g.verbose })));
    emit(g.json, result, [result.detail]);
    process.exitCode = result.exitCode;
  });

program
  .command("status")
  .description("show login, Codex homes, last sync and scheduler state")
  .option("--codex-home <path>")
  .option("--systemd")
  .action(async (o: { codexHome?: string; systemd?: boolean }) => {
    const g = globals();
    const report = await runStatus({ ...scheduleDeps(makeLogger({ verbose: g.verbose })), cliVersion: CLI_VERSION, ...(o.codexHome ? { codexHomeOverride: o.codexHome } : {}), systemd: o.systemd === true });
    emit(g.json, report, formatStatus(report));
  });

program
  .command("doctor")
  .description("check Node, Codex home, token and scheduler")
  .option("--codex-home <path>")
  .option("--systemd")
  .action(async (o: { codexHome?: string; systemd?: boolean }) => {
    const g = globals();
    const report = await runDoctor({ ...scheduleDeps(makeLogger({ verbose: g.verbose })), cliVersion: CLI_VERSION, nodeVersion: process.versions.node, createClient: clientFor, ...(o.codexHome ? { codexHomeOverride: o.codexHome } : {}), systemd: o.systemd === true });
    emit(g.json, report, formatDoctor(report));
    process.exitCode = report.exitCode;
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 5: Run the tests, then build and inspect the bundle**

```bash
npm run test -w cli && npm run typecheck -w cli && npm run lint -w cli
CODEX_KABOO_SERVER=https://example.convex.site npm run build -w cli
head -c 19 cli/dist/codex-kaboo.js; echo
grep -c '^#!/usr/bin/env node' cli/dist/codex-kaboo.js
test -x cli/dist/codex-kaboo.js && echo executable
grep -c '"https://example.convex.site"' cli/dist/codex-kaboo.js
node cli/dist/codex-kaboo.js --version
node cli/dist/codex-kaboo.js --help
node cli/dist/codex-kaboo.js status
node cli/dist/codex-kaboo.js sync --dry-run --codex-home cli/test/fixtures/codex-home | tail -3
```

Expected: tests pass; `#!/usr/bin/env node` appears exactly once at the top; `executable`; the baked server appears once; `0.1.0`; the help lists the seven commands; `status` prints "not logged in" and the scheduler line; the dry run ends with the `sync ok:` summary and the dry-run notice.

- [ ] **Step 6: Verify the package contents and the runtime-dependency-free tarball**

```bash
npm run build -w cli
cd cli && npm pack --dry-run --json | node -e '
const [pkg] = JSON.parse(require("fs").readFileSync(0, "utf8"));
const files = pkg.files.map((f) => f.path).sort();
console.log(files);
if (files.join(",") !== "dist/codex-kaboo.js,package.json") { console.error("unexpected files in the tarball"); process.exit(1); }
const manifest = require("./package.json");
if (Object.keys(manifest.dependencies ?? {}).length !== 0) { console.error("dependencies must be empty"); process.exit(1); }
console.log("tarball ok:", pkg.filename, pkg.size, "bytes");' && cd ..
```

Expected: `[ 'dist/codex-kaboo.js', 'package.json' ]` and `tarball ok: codex-kaboo-cli-0.1.0.tgz <size> bytes`.

- [ ] **Step 7: Commit**

```bash
git add cli/src/main.ts cli/src/commands/format.ts cli/test/commands/format.test.ts
git commit -F - <<'MSG'
Wire the codex-kaboo CLI commands and verify the single-file bundle

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

---

### Task 26: Real-data smoke test (privacy + totals audit) and README

**Files:**
- Create: `cli/scripts/raw-totals.mjs`, `cli/scripts/check-dry-run.mjs`
- Modify: `README.md` (CLI section)

**Interfaces:**
- Consumes: the built `cli/dist/codex-kaboo.js`, the real `~/.codex` on this Mac (read-only; `auth.json` is never opened — the CLI only reads `sessions/`, `archived_sessions/` and `version.json`).
- Produces: `raw-totals.mjs <codex-home>` → JSON `{ [sessionId]: { input, cachedInput, cacheWrite, output, reasoning, events, lines } }` computed independently of the parser but with the same `token_usage_record`-over-`token_count` precedence (Task 15); `check-dry-run.mjs <dry-run.json> <raw-totals.json>` → exit 0 with `PASS`, else the list of problems.

The dry-run JSON is the privacy audit: it contains the exact request bodies. The check asserts that no forbidden key (`command`, `cwd`, `path`, `stdout`, `unified_diff`, `content`, …) and no path-like string appears anywhere in them, that `machine.hostname` is null, and that every session's token totals, event count and line count equal the independent raw sums. At the time of writing this Mac holds 11 sessions and 426 non-zero `token_count` lines (four `token_count` lines are all-zero and produce no event); the session whose id ends in `1180` has input 1,437,354 / output 6,554 tokens over 23 responses. Those numbers drift as Codex keeps being used, so the check compares against the raw sums instead of hardcoding them.

- [ ] **Step 1: Write `cli/scripts/raw-totals.mjs`**

```js
#!/usr/bin/env node
// Usage: node cli/scripts/raw-totals.mjs [<codex-home>]
// Independent cross-check for the real-data smoke test. Mirrors the reducer's precedence rule
// (Task 15): if a file has any recognisable `token_usage_record` line, its usages are the totals and
// every `token_count` line in that file is ignored; otherwise the totals come from `token_count`
// `info.last_token_usage`. Null and all-zero usages are skipped either way, as is the trailing
// partial line. Prints session ids and numbers only — never text or paths.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const home = process.argv[2] ?? path.join(os.homedir(), ".codex");
const RE = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})(?:_([0-9a-f-]{36}))?\.jsonl(\.zst)?$/i;
const files = [];
function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (RE.test(entry.name)) files.push(full);
  }
}
for (const sub of ["sessions", "archived_sessions"]) walk(path.join(home, sub));

const out = {};
for (const file of files) {
  const m = RE.exec(path.basename(file));
  const sessionId = (m[2] ? `${m[1]}_${m[2]}` : m[1]).toLowerCase();
  let buffer = fs.readFileSync(file);
  if (m[3]) {
    if (typeof zlib.zstdDecompressSync !== "function") continue;
    buffer = zlib.zstdDecompressSync(buffer);
  }
  const text = buffer.toString("utf8");
  const lines = text.split("\n");
  lines.pop(); // "" after a trailing newline, or the unterminated partial line
  const empty = () => ({ input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, events: 0 });
  const fromTokenCount = empty();
  const fromUsageRecord = empty();
  let hasUsageRecords = false;
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    let usage;
    let totals;
    if (obj.type === "token_usage_record") {
      const payload = obj.payload ?? {};
      usage = payload.usage ?? payload.info?.last_token_usage ?? (typeof payload.input_tokens === "number" ? payload : null);
      if (!usage) continue; // unrecognised shape: the reducer ignores it and keeps the token_count events
      hasUsageRecords = true;
      totals = fromUsageRecord;
    } else if (obj.type === "event_msg" && obj.payload?.type === "token_count") {
      usage = obj.payload.info?.last_token_usage;
      if (!usage) continue;
      totals = fromTokenCount;
    } else {
      continue;
    }
    const values = [usage.input_tokens, usage.cached_input_tokens, usage.cache_write_input_tokens, usage.output_tokens, usage.reasoning_output_tokens]
      .map((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0));
    if (values.every((v) => v === 0)) continue;
    totals.input += values[0];
    totals.cachedInput += values[1];
    totals.cacheWrite += values[2];
    totals.output += values[3];
    totals.reasoning += values[4];
    totals.events += 1;
  }
  out[sessionId] = { ...(hasUsageRecords ? fromUsageRecord : fromTokenCount), lines: lines.length };
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
```

- [ ] **Step 2: Write `cli/scripts/check-dry-run.mjs`**

```js
#!/usr/bin/env node
// Usage: node cli/scripts/check-dry-run.mjs <dry-run.json> <raw-totals.json>
// Privacy and totals audit of `codex-kaboo sync --dry-run --json --codex-home ~/.codex`.
import fs from "node:fs";
import os from "node:os";

const [dryPath, rawPath] = process.argv.slice(2);
if (!dryPath || !rawPath) {
  console.error("usage: check-dry-run.mjs <dry-run.json> <raw-totals.json>");
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(dryPath, "utf8"));
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const problems = [];
const FORBIDDEN_KEYS = new Set([
  "command", "cwd", "path", "stdout", "stderr", "aggregated_output", "formatted_output", "unified_diff", "content",
  "message", "text", "query", "results", "arguments", "raw_content", "summary_text", "developer_instructions",
  "last_agent_message", "repository_url", "replacement_history",
]);
const home = os.homedir();

function scan(value, trail) {
  if (typeof value === "string") {
    if (value.includes(home) || /(^|[\\/])(Users|home)[\\/]/.test(value)) problems.push(`path-like string at ${trail}`);
    if (value.length > 256) problems.push(`string longer than 256 chars at ${trail}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scan(v, `${trail}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) problems.push(`forbidden key "${key}" at ${trail}`);
      scan(v, `${trail}.${key}`);
    }
  }
}

const batches = report.batches ?? [];
if (batches.length === 0) problems.push("no batches in the dry-run report (is the codex home right?)");
batches.forEach((batch, i) => scan(batch, `batches[${i}]`));
for (const batch of batches) {
  if (batch.machine.hostname !== null && batch.machine.hostname !== undefined) problems.push("machine.hostname is set (only expected after `login --hostname`)");
}

const sessions = new Map();
for (const batch of batches) for (const s of batch.sessions) sessions.set(s.sessionId, s);
const eventCounts = new Map();
for (const batch of batches) {
  for (const e of batch.tokenEvents) {
    eventCounts.set(e.sessionId, (eventCounts.get(e.sessionId) ?? 0) + 1);
    if (e.total !== e.input + e.output) problems.push(`event ${e.sessionId}#${e.seq}: total != input + output`);
    if (!sessions.has(e.sessionId)) problems.push(`event ${e.sessionId}#${e.seq}: no session summary in the batches`);
  }
}

const rows = [];
for (const [sessionId, expected] of Object.entries(raw)) {
  const s = sessions.get(sessionId);
  if (!s) {
    problems.push(`session ${sessionId} missing from the dry run`);
    continue;
  }
  const got = { input: s.tokens.input, cachedInput: s.tokens.cachedInput, cacheWrite: s.tokens.cacheWrite, output: s.tokens.output, reasoning: s.tokens.reasoning, events: s.responses, lines: s.lineCount };
  for (const key of Object.keys(got)) {
    if (got[key] !== expected[key]) problems.push(`${sessionId}: ${key} ${got[key]} != raw ${expected[key]}`);
  }
  if ((eventCounts.get(sessionId) ?? 0) !== expected.events) problems.push(`${sessionId}: ${eventCounts.get(sessionId) ?? 0} events shipped != raw ${expected.events}`);
  rows.push({ session: `…${sessionId.slice(-4)}`, lines: s.lineCount, events: s.responses, input: s.tokens.input, cached: s.tokens.cachedInput, output: s.tokens.output, model: s.model, project: s.project, subagent: s.isSubagent });
}
for (const sessionId of sessions.keys()) if (!raw[sessionId]) problems.push(`session ${sessionId} is not in the raw totals`);

console.table(rows);
const totalEvents = [...eventCounts.values()].reduce((a, b) => a + b, 0);
console.log(`${sessions.size} sessions, ${totalEvents} token events, ${batches.length} request(s)`);
if (problems.length > 0) {
  console.error("FAIL");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("PASS: no text, paths or forbidden keys; totals match the raw logs");
```

- [ ] **Step 3: Build and run the audit against the real logs**

```bash
TMP="${TMPDIR:-/tmp}"
npm run build -w cli
node cli/dist/codex-kaboo.js sync --dry-run --json --codex-home ~/.codex > "$TMP/ck-dry-run.json"
node cli/scripts/raw-totals.mjs ~/.codex > "$TMP/ck-raw-totals.json"
node cli/scripts/check-dry-run.mjs "$TMP/ck-dry-run.json" "$TMP/ck-raw-totals.json"
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const b = r.batches[0];
console.log("machine:", b.machine);
console.log("session keys:", Object.keys(b.sessions[0]).join(", "));
console.log("event keys:", Object.keys(b.tokenEvents[0]).join(", "));
console.log("first session:", JSON.stringify({ ...b.sessions[0], mcpTools: b.sessions[0].mcpTools, skills: b.sessions[0].skills }));' "$TMP/ck-dry-run.json"
```

Expected: a table with one row per real session (session `…1180`: lines 159, events 23, input 1437354, output 6554, model gpt-5.6-sol), the line `11 sessions, 426 token events, 1 request(s)` (or the current numbers if more sessions were created since), `PASS`, `machine.hostname: null`, and a first session whose fields are exactly the `SessionSummary` keys. Read the printed session with your own eyes: project is a bare directory name, `gitBranch` is a branch name, nothing else is text.

If the check fails on totals, compare with `node cli/scripts/raw-totals.mjs ~/.codex | head -30` and re-check the reducer rules (Task 15) before touching anything; if it fails on a forbidden key or a path-like string, that is a privacy bug in the parser — fix it in `parser/session.ts` and add a regression test to `cli/test/parser/session-items.test.ts`.

- [ ] **Step 4: Add the CLI section to `README.md`**

Append to `README.md`:

````markdown
## Collector CLI (`codex-kaboo`)

Each teammate installs the collector once; it parses the local Codex rollout logs
(`~/.codex/sessions`) every 15 minutes and uploads **metadata only** — token counts, model,
effort, tool kinds, skill names, project folder name, git branch, timestamps, line counts,
Codex/CLI versions, platform. It never uploads prompts, responses, command lines, file paths,
diff contents, repository URLs or your hostname (unless you pass `login --hostname`).
Audit exactly what would be sent with `codex-kaboo sync --dry-run --json`.

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
````

- [ ] **Step 5: Run the whole workspace once more and commit**

```bash
npm run typecheck && npm run lint && npm test
git add cli/scripts/raw-totals.mjs cli/scripts/check-dry-run.mjs README.md
git commit -F - <<'MSG'
Add the real-data dry-run audit scripts and CLI documentation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
```

Expected: everything green and the commit created locally. Do not push: this plan runs on a working branch that is integrated separately, and CI runs when that branch is pushed by whoever integrates it.

---

## Done when

- `npm test`, `npm run typecheck` and `npm run lint` pass at the root; CI is green on ubuntu/macos/windows × Node 20/22/24.
- `node cli/dist/codex-kaboo.js sync --dry-run --json --codex-home ~/.codex` passes `check-dry-run.mjs` (no text/paths, totals equal the raw sums).
- The tarball from `npm pack` contains only `package.json` and `dist/codex-kaboo.js` with empty `dependencies`.
- Plan 2 (`web/convex/`) can start: it consumes `shared/src/sync.ts`, `constants.ts`, `days.ts`, `metrics.ts` and `test-fixtures.ts` exactly as written here; Plan 3 (`web/src/`) can start: the `web` workspace exists with the `@shared/*` alias and the three vitest projects.
- Not covered here (by design): the Convex endpoint (Plan 2), packaging the tarball into `web/public/cli/` and setting `LATEST_CLI_VERSION` (`web/scripts/pack-cli.mjs`, Plan 3), and the end-to-end `sync` against a dev deployment (Plan 2's verification uses this CLI).
