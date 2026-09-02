# codex-kaboo Web Dashboard + Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js 16 dashboard under `web/src/` (home, per-user page, settings, sign-in), the CLI packaging script and Vercel/Convex production deployment, so three people can sign in with Clerk and see the Codex usage synced by the collector CLI.

**Architecture:** The web app is a client-rendered App Router UI: Clerk protects every route except sign-in/sign-up and `/cli/*`; a Convex client authenticated with Clerk runs reactive queries against the public API in `web/convex/` (Plan 2) and only renders data inside `<Authenticated>` after `users.ensure` resolved. URL state (range, section, view, tab) lives in nuqs search params; all range math is pure code in `src/lib/range.ts` driven by a client-only `today`. Charts are Recharts 3 inside shadcn `ChartContainer`, with pure data-transform modules that are unit-tested instead of mounting charts in jsdom. Deployment: `npx convex deploy --cmd "npm run build"` on Vercel (Root Directory `web`), with a `prebuild` that packs the CLI into `public/cli/`.

**Tech Stack:** Next 16.3.4 (App Router, Turbopack, `src/proxy.ts`), React 19.2, TypeScript ^5.9.3, Tailwind v4, shadcn 4 (`--base radix`), @clerk/nextjs 7.8.4, convex 1.45.0, recharts 3.10.1 (+ react-is), nuqs 2.10.1, lucide-react, react-day-picker 10 (via shadcn Calendar), date-fns 4, vitest 4.1 (`unit` node project + `dom` jsdom project), @testing-library/react 16.3, @testing-library/jest-dom, @testing-library/user-event, Vercel CLI 59, Convex CLI 1.45.

**Spec:** `docs/superpowers/specs/2026-09-01-codex-kaboo-design.md` (sections "Web app", "Metric definitions", "Deployment and one-time setup", "Verification"). Binding cross-plan contracts: `docs/superpowers/plans/2026-09-01-codex-kaboo-0-contracts.md` (§1 tooling, §9 Convex public API, §10 CLI strings, §11 env names). When this plan and the contracts disagree, the contracts win.

## Global Constraints

- Versions are pinned: next 16.3.4, react 19.2.x, @clerk/nextjs 7.8.4, convex 1.45.0, recharts 3.10.1, nuqs 2.10.1, typescript ^5.9.3, vitest 4.1.x. Never install `typescript@latest` (that is TS 7) or vitest 5 (needs Node ≥ 22.12 in CI).
- Imports: shared code via `@shared/*` (`web/tsconfig.json` paths → `../shared/src/*`); Convex API/types via `@convex/*` (→ `./convex/*`, added in Task 1); app code via `@/*` (→ `./src/*`). Never import `../../convex/...` by relative path from `src/`.
- Test commands (run from the repo root): `npm run test -w web -- --project unit`, `npm run test -w web -- --project dom`, `npm run typecheck -w web` (runs `next typegen && tsc --noEmit`), `npm run lint -w web`. Single test: `cd web && npx vitest run --project unit src/lib/format.test.ts`.
- Data fetching rule (every page/component task): data components render only inside Convex `<Authenticated>` and after `useEnsureUser` resolved (the `AppGate` from Task 2 guarantees this for everything under `src/app/(app)/`); range-dependent queries pass `"skip"` until `today` is known (and until `stats.bounds` is known for the ALL preset); never call `Date.now()` or `new Date()` during server render — only inside `useToday`/`useNow` (client stores) or event handlers.
- Privacy rule (hard, from the spec): the UI shows only token counts, model names, efforts, tool kinds, skill names, project basenames, git branches, timestamps/durations, line counts, Codex/CLI versions, platform/arch and user-chosen machine labels. It never displays hostnames unless the machine opted in (`hostname` non-null). Sync tokens are shown raw exactly once (create dialog) and never again.
- Public routes (Clerk proxy): `/sign-in(.*)`, `/sign-up(.*)`, `/cli/(.*)`. Everything else requires a signed-in Clerk user.
- Env names (contracts §11): `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `CLERK_FRONTEND_API_URL` (Convex env), `LATEST_CLI_VERSION` (Convex env, set by `pack-cli.mjs`), `CONVEX_DEPLOY_KEY` (Vercel), `CODEX_KABOO_SERVER` and `CODEX_KABOO_WEB_ORIGIN` (Vercel build env, baked into the CLI).
- CLI strings (contracts §10): `npm install -g https://<origin>/cli/codex-kaboo-cli.tgz` (npm ≥ 12 adds `--allow-remote=all`), `codex-kaboo login --token <token>`, `codex-kaboo install`, `codex-kaboo status`; `<origin>` = `window.location.origin`. Packed artifacts: `web/public/cli/codex-kaboo-cli.tgz`, `web/public/cli/codex-kaboo-cli-<version>.tgz`, `web/public/cli/version.json` = `{ "version", "builtAt", "commit" }`; CLI version `<package.json version>-build.<yyyymmddHHmm>.<sha7>`.
- Visual language (spec): off-white page `#f8f9fb`, white cards, 1 px `#e5e7eb` border, 12 px radius, no shadows, green accent `#008300`, Inter for UI, JetBrains Mono tabular numerals in tables only (never on hero/stat values); light theme only in v1 (dark tokens defined, not QA'd).
- Palette (validated, fixed order, never cycled; a 9th entity folds into "(other)" drawn in neutral gray `#9aa3ae`): categorical `#008300 #2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #4a3aa7 #e34948`; heat ramp `#eceff3` (zero) then `#6cc482 #2f9f55 #1a7a40 #0d532b`; status good `#0ca30c`, warning `#fab219`, critical `#d03b3b`; delta pills up `#006300` on `#e6f4e6`, down `#b42318` on `#fdecec`. Users get slots by ascending `userId` string; models by the price-registry order (Task 6), so colors never repaint when the range changes.
- Chart rules (dataviz skill): one axis per chart (never dual-axis); thin marks (bars ≤ 24 px, 2 px lines, area wash ≈ 12 % opacity); solid hairline grid; 2 px surface gaps between stacked segments; a legend for ≥ 2 series; text never in the series color; every chart card offers a Table view of the same rows; `isAnimationActive={false}` everywhere; refetches keep the previous render at reduced opacity (`useStableQuery`), never a skeleton flash.
- Recharts `dataKey`s never contain dots: rows use slot keys `s0…s7`/`other` and a `SeriesDef[]` carries labels and colors (model names such as `gpt-5.6-sol` would otherwise be read as nested paths).
- Every commit message ends with the two trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt`.

## File structure

```
web/
  next.config.ts                      turbopack.root = repo root (Task 1)
  tsconfig.json                       paths: @/*, @shared/*, @convex/* (Task 1)
  vitest.config.ts                    projects convex / unit / dom + aliases (Task 1)
  vitest.setup.dom.ts                 jest-dom matchers (Task 1)
  vercel.json                         buildCommand (Task 31)
  scripts/pack-cli.mjs                prebuild: build + pack the CLI into public/cli (Task 29)
  src/proxy.ts                        Clerk proxy with public routes (Task 2)
  src/app/layout.tsx                  fonts + ClerkProvider + ConvexClientProvider + NuqsAdapter (Tasks 1–2)
  src/app/globals.css                 design tokens (Task 1)
  src/app/providers.tsx               ConvexClientProvider (Task 2)
  src/app/sign-in/[[...sign-in]]/page.tsx, src/app/sign-up/[[...sign-up]]/page.tsx (Task 2)
  src/app/(app)/layout.tsx            AppGate + TopNav + main container (Tasks 2, 14)
  src/app/(app)/page.tsx              Home (Task 22)
  src/app/(app)/users/[userId]/page.tsx  User page (Task 26)
  src/app/(app)/settings/page.tsx     Settings (Task 28)
  src/lib/{format,range,search-params,colors,metrics,chart-data,heatmap,install}.ts + *.test.ts (Tasks 3–10)
  src/hooks/{use-today,use-now,use-range,use-stable-query,use-me,use-entity-colors,use-ensure-user,
             use-async-action}.ts (Tasks 2, 11), use-breakdowns.ts (Task 21)
  src/components/ui/*                 shadcn (Task 1)
  src/components/layout/{app-gate,top-nav,range-picker,user-menu,page-header}.tsx (Tasks 2, 14, 15)
  src/components/primitives/*         StatCard, DeltaPill, Num, SegmentedControl, DataTable, BarCell, Podium, RankMovement,
                                      SectionCard, EmptyState, InlineError, SectionErrorBoundary, InfoTooltip, CopyBox,
                                      AvatarName (Tasks 12–13), QuerySection (Task 21)
  src/components/charts/*             ChartCard, SeriesTooltip, TrendChart, StackedBarChart, StackedShareBar, QuotaGauge,
                                      ActivityHeatmap, DayHourHeatmap (Tasks 16–18)
  src/components/home/*               overview cards, quota card, cost structure, users/models/tools/projects/skills sections,
                                      shared per-model table columns, trend section, onboarding card (Tasks 19–22)
  src/components/user/*               overview/breakdown/efficiency/sessions tabs, machines and sources tables,
                                      data sync card (Tasks 23–26)
  src/components/settings/*           tokens, install, machines, prices (Tasks 27–28)
```

---

### Task 1: Design tokens, fonts, aliases, vitest projects and shadcn components

**Files:**
- Modify: `web/src/app/globals.css` (replace)
- Modify: `web/src/app/layout.tsx` (replace)
- Modify: `web/next.config.ts` (replace)
- Modify: `web/tsconfig.json` (add `@convex/*` path)
- Modify: `web/vitest.config.ts` (replace), Create: `web/vitest.setup.dom.ts`
- Modify: `web/package.json` (dev dependencies added by Steps 1 and 6: `tw-animate-css`, `@testing-library/user-event`)
- Create: `web/src/components/ui/*` via the shadcn CLI
- Test: `web/src/lib/smoke.test.ts` (alias resolution)

**Interfaces:**
- Consumes: Plan 1's `web/` scaffold (create-next-app + `shadcn init --base radix`), `shared/src/constants.ts` (`MAX_QUERY_RANGE_DAYS`).
- Produces: CSS custom properties `--status-good/--status-warning/--status-critical`, `--delta-up-fg/--delta-up-bg/--delta-down-fg/--delta-down-bg`, `--heat-0…--heat-4`, `--font-sans`, `--font-mono`; Tailwind utilities `font-sans`, `font-mono`; path aliases `@/*`, `@shared/*`, `@convex/*` usable from `src/` and from vitest; shadcn components `button card tabs toggle-group dialog alert-dialog input label table tooltip calendar popover badge skeleton dropdown-menu separator chart`.

- [ ] **Step 1: Add the shadcn components and the animation import dependency**

Run (from the repo root):
```bash
cd web && npx shadcn@latest add button card tabs toggle-group dialog alert-dialog input label table tooltip calendar popover badge skeleton dropdown-menu separator chart --yes --overwrite && ls src/components/ui && (ls node_modules/tw-animate-css >/dev/null 2>&1 || npm i -D tw-animate-css) && cd ..
```
Expected: `src/components/ui` lists `alert-dialog.tsx badge.tsx button.tsx calendar.tsx card.tsx chart.tsx dialog.tsx dropdown-menu.tsx input.tsx label.tsx popover.tsx separator.tsx skeleton.tsx table.tsx tabs.tsx toggle-group.tsx tooltip.tsx` (the CLI may also add `toggle.tsx`). If the shadcn CLI asks a question about the base, answer `radix` (the project was initialised with `--base radix`).

- [ ] **Step 2: Replace `web/src/app/globals.css` with the token set**

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --background: #f8f9fb;
  --foreground: #111827;
  --card: #ffffff;
  --card-foreground: #111827;
  --popover: #ffffff;
  --popover-foreground: #111827;
  --primary: #008300;
  --primary-foreground: #ffffff;
  --secondary: #f1f3f6;
  --secondary-foreground: #111827;
  --muted: #f1f3f6;
  --muted-foreground: #6b7280;
  --accent: #eef7ee;
  --accent-foreground: #006300;
  --destructive: #d03b3b;
  --border: #e5e7eb;
  --input: #e5e7eb;
  --ring: #008300;
  --chart-1: #008300;
  --chart-2: #2a78d6;
  --chart-3: #eb6834;
  --chart-4: #1baf7a;
  --chart-5: #eda100;
  --radius: 0.75rem;
  --sidebar: #ffffff;
  --sidebar-foreground: #111827;
  --sidebar-primary: #008300;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #eef7ee;
  --sidebar-accent-foreground: #006300;
  --sidebar-border: #e5e7eb;
  --sidebar-ring: #008300;

  /* codex-kaboo semantic tokens */
  --status-good: #0ca30c;
  --status-warning: #fab219;
  --status-critical: #d03b3b;
  --delta-up-fg: #006300;
  --delta-up-bg: #e6f4e6;
  --delta-down-fg: #b42318;
  --delta-down-bg: #fdecec;
  --heat-0: #eceff3;
  --heat-1: #6cc482;
  --heat-2: #2f9f55;
  --heat-3: #1a7a40;
  --heat-4: #0d532b;
  --grid-line: #eceff3;
  --other-series: #9aa3ae;
}

/* Dark tokens are defined for completeness; v1 ships light only and does not QA dark. */
.dark {
  --background: #0f1115;
  --foreground: #e5e7eb;
  --card: #161a21;
  --card-foreground: #e5e7eb;
  --popover: #161a21;
  --popover-foreground: #e5e7eb;
  --primary: #4fbf4f;
  --primary-foreground: #0f1115;
  --secondary: #1f242d;
  --secondary-foreground: #e5e7eb;
  --muted: #1f242d;
  --muted-foreground: #9aa3ae;
  --accent: #16301a;
  --accent-foreground: #8fe08f;
  --destructive: #ef6b6b;
  --border: #262c36;
  --input: #262c36;
  --ring: #4fbf4f;
  --status-good: #4fbf4f;
  --status-warning: #f0c454;
  --status-critical: #ef6b6b;
  --delta-up-fg: #8fe08f;
  --delta-up-bg: #16301a;
  --delta-down-fg: #f4a3a3;
  --delta-down-bg: #3a1b1b;
  --heat-0: #1f242d;
  --heat-1: #2f6b3d;
  --heat-2: #3d8f52;
  --heat-3: #57b56e;
  --heat-4: #8fe08f;
  --grid-line: #262c36;
  --other-series: #6b7280;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-status-good: var(--status-good);
  --color-status-warning: var(--status-warning);
  --color-status-critical: var(--status-critical);
  --color-delta-up-fg: var(--delta-up-fg);
  --color-delta-up-bg: var(--delta-up-bg);
  --color-delta-down-fg: var(--delta-down-fg);
  --color-delta-down-bg: var(--delta-down-bg);
  --color-heat-0: var(--heat-0);
  --color-heat-1: var(--heat-1);
  --color-heat-2: var(--heat-2);
  --color-heat-3: var(--heat-3);
  --color-heat-4: var(--heat-4);
  --color-grid-line: var(--grid-line);
  --color-other-series: var(--other-series);
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }
}
```

- [ ] **Step 3: Replace `web/src/app/layout.tsx` (fonts only; providers are added in Task 2)**

```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "codex-kaboo",
  description: "Codex usage dashboard for a shared account",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Replace `web/next.config.ts`**

```ts
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    // The npm workspace root holds the lockfile and `shared/`.
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
```

- [ ] **Step 5: Add the `@convex/*` alias to `web/tsconfig.json`**

Edit the `compilerOptions.paths` object so it reads exactly:
```json
"paths": {
  "@/*": ["./src/*"],
  "@shared/*": ["../shared/src/*"],
  "@convex/*": ["./convex/*"]
}
```
Run: `node -e "const t=require('./web/tsconfig.json');console.log(JSON.stringify(t.compilerOptions.paths))"`
Expected: `{"@/*":["./src/*"],"@shared/*":["../shared/src/*"],"@convex/*":["./convex/*"]}`

- [ ] **Step 6: Replace `web/vitest.config.ts` and create `web/vitest.setup.dom.ts`**

`web/vitest.config.ts`:
```ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(__dirname, "src"),
  "@shared": path.resolve(__dirname, "../shared/src"),
  "@convex": path.resolve(__dirname, "convex"),
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
        resolve: { alias },
      },
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
        resolve: { alias },
      },
      {
        plugins: [react()],
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
        resolve: { alias },
      },
    ],
  },
});
```

`web/vitest.setup.dom.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

Run: `ls web/node_modules/@testing-library/user-event >/dev/null 2>&1 || npm i -D @testing-library/user-event -w web`
Expected: exits 0 (installs `@testing-library/user-event` if Plan 1 did not).

- [ ] **Step 7: Write the alias smoke test `web/src/lib/smoke.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { MAX_QUERY_RANGE_DAYS } from "@shared/constants";

describe("workspace aliases", () => {
  it("resolves @shared/* from vitest", () => {
    expect(MAX_QUERY_RANGE_DAYS).toBe(1100);
  });
});
```

- [ ] **Step 8: Run the checks**

Run: `npm run test -w web -- --project unit && npm run typecheck -w web && npm run lint -w web`
Expected: `✓ src/lib/smoke.test.ts (1 test)`, typecheck exits 0, lint reports no errors.

- [ ] **Step 9: Visual check**

Run: `npm run dev -w web` (leave running in a second terminal) and open `http://localhost:3000`.
Expected: the default Next page renders on an off-white `#f8f9fb` background with Inter (check the computed `font-family` of `body` in devtools starts with `Inter`). Stop the dev server afterwards only if you do not need it for the next task.

- [ ] **Step 10: Commit**

```bash
git add web/src/app/globals.css web/src/app/layout.tsx web/next.config.ts web/tsconfig.json web/vitest.config.ts web/vitest.setup.dom.ts web/src/components/ui web/src/lib/smoke.test.ts web/package.json package-lock.json
git commit -m "$(cat <<'MSG'
Add design tokens, fonts, path aliases and shadcn components to web

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 2: Clerk proxy, providers, sign-in/sign-up routes and the authenticated app gate

**Files:**
- Create: `web/src/proxy.ts`
- Create: `web/src/app/providers.tsx`
- Modify: `web/src/app/layout.tsx` (wrap children with providers)
- Create: `web/src/app/sign-in/[[...sign-in]]/page.tsx`, `web/src/app/sign-up/[[...sign-up]]/page.tsx`
- Create: `web/src/hooks/use-ensure-user.ts`, `web/src/hooks/use-me.ts`
- Create: `web/src/components/layout/app-gate.tsx`, `web/src/components/layout/current-user.tsx`
- Create: `web/src/app/(app)/layout.tsx`; Move: `web/src/app/page.tsx` → `web/src/app/(app)/page.tsx` (replaced)
- Create: `web/.env.local` entries (never committed)

**Interfaces:**
- Consumes: Convex `api.users.ensure` (mutation → `Id<"users">`), `api.users.me` (→ `MeResult`) from contracts §9.
- Produces: `useEnsureUser(): { ready: Id<"users"> | null; error: string | null; retry: () => void }`; `useMe(): MeResult | null | undefined` (`undefined` = loading); `useCurrentUserId(): Id<"users">` (context, throws outside `AppGate`); `<AppGate>` (renders children only when authenticated and ensured, and renders the `users.ensure` failure with a Retry button instead of a permanent skeleton); the `(app)` route group whose pages are always authenticated.

- [ ] **Step 1: Create `web/src/proxy.ts`**

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/cli/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and common static files; `.tgz` is deliberately NOT in this list,
    // so /cli/*.tgz reaches the proxy and is let through by `isPublicRoute`.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
```

- [ ] **Step 2: Create `web/src/app/providers.tsx`**

```tsx
"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not set (run `npx convex dev` in web/ once)");
}
const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
```

- [ ] **Step 3: Wrap the root layout body with the providers**

Replace the `<body>` element in `web/src/app/layout.tsx` with:
```tsx
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/sign-in">
          <ConvexClientProvider>
            <NuqsAdapter>{children}</NuqsAdapter>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
```
and add these imports at the top of the file:
```tsx
import { ClerkProvider } from "@clerk/nextjs";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ConvexClientProvider } from "./providers";
```

- [ ] **Step 4: Create the sign-in and sign-up pages**

`web/src/app/sign-in/[[...sign-in]]/page.tsx`:
```tsx
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignIn />
    </main>
  );
}
```

`web/src/app/sign-up/[[...sign-up]]/page.tsx`:
```tsx
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignUp />
    </main>
  );
}
```

- [ ] **Step 5: Create the hooks `use-ensure-user.ts` and `use-me.ts`**

`web/src/hooks/use-ensure-user.ts`:
```ts
"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export type EnsureUserState = {
  /** The Convex user id once `users.ensure` resolved; `null` while pending or after a failure. */
  ready: Id<"users"> | null;
  /** The message of the last `users.ensure` failure, `null` when there was none. */
  error: string | null;
  /** Runs `users.ensure` again and clears the error. */
  retry: () => void;
};

/** Calls `users.ensure` once per sign-in and surfaces the id, the failure and a retry. */
export function useEnsureUser(): EnsureUserState {
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const [ready, setReady] = useState<Id<"users"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) {
      setReady(null);
      setError(null);
      return;
    }
    let cancelled = false;
    ensure({})
      .then((id) => {
        if (cancelled) return;
        setReady(id);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, ensure, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { ready, error, retry };
}
```

`web/src/hooks/use-me.ts`:
```ts
"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { MeResult } from "@convex/lib/types";

/** The signed-in user's Convex document; `undefined` while loading. */
export function useMe(): MeResult | null | undefined {
  return useQuery(api.users.me, {});
}
```

- [ ] **Step 6: Create `current-user.tsx` and `app-gate.tsx`**

`web/src/components/layout/current-user.tsx`:
```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Id } from "@convex/_generated/dataModel";

const CurrentUserContext = createContext<Id<"users"> | null>(null);

export function CurrentUserProvider({
  userId,
  children,
}: {
  userId: Id<"users">;
  children: ReactNode;
}) {
  return <CurrentUserContext.Provider value={userId}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUserId(): Id<"users"> {
  const id = useContext(CurrentUserContext);
  if (id === null) {
    throw new Error("useCurrentUserId must be used inside <AppGate>");
  }
  return id;
}
```

`web/src/components/layout/app-gate.tsx`:
```tsx
"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useEnsureUser } from "@/hooks/use-ensure-user";
import { CurrentUserProvider } from "./current-user";

export function ShellSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6" aria-busy="true">
      <Skeleton className="mb-6 h-10 w-full" />
      <div className="grid gap-4 md:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-6 h-72 w-full" />
    </div>
  );
}

function EnsuredUser({ children }: { children: ReactNode }) {
  const { ready, error, retry } = useEnsureUser();
  if (error !== null) {
    // Task 12 swaps this block for <EmptyState/> once the primitive exists.
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm font-medium">Could not load your account</p>
          <p className="max-w-md text-xs text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  if (ready === null) return <ShellSkeleton />;
  return <CurrentUserProvider userId={ready}>{children}</CurrentUserProvider>;
}

/** Renders children only for a signed-in user whose Convex `users` row exists. */
export function AppGate({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <ShellSkeleton />
      </AuthLoading>
      <Unauthenticated>
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-muted-foreground">You are signed out.</p>
          <Link href="/sign-in" className="text-sm font-medium text-primary underline">
            Sign in
          </Link>
        </main>
      </Unauthenticated>
      <Authenticated>
        <EnsuredUser>{children}</EnsuredUser>
      </Authenticated>
    </>
  );
}
```

- [ ] **Step 7: Create the `(app)` route group layout and a first page**

Run: `mkdir -p "web/src/app/(app)" && git mv web/src/app/page.tsx "web/src/app/(app)/page.tsx"`
Expected: exits 0 and `web/src/app/page.tsx` no longer exists — leaving it in place would give two pages resolving to `/` and fail `next build`. Verify with `ls web/src/app/page.tsx` → `No such file or directory`.

`web/src/app/(app)/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import { AppGate } from "@/components/layout/app-gate";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppGate>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center px-4 md:px-6">
          <span className="text-sm font-semibold">codex-kaboo</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">{children}</main>
    </AppGate>
  );
}
```

`web/src/app/(app)/page.tsx` (temporary; replaced in Task 22):
```tsx
"use client";

import { useMe } from "@/hooks/use-me";

export default function HomePage() {
  const me = useMe();
  if (me === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return <p className="text-sm">Signed in as {me?.name ?? "unknown"}</p>;
}
```

- [ ] **Step 8: Add the Clerk env vars to `web/.env.local` (git-ignored)**

Append to `web/.env.local` (keep the `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` lines written by `npx convex dev`), pasting the values from the user's Clerk dashboard:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
```
(The sign-up URL is not an env var: `<ClerkProvider signUpUrl="/sign-up">` in Step 3 is its single source of truth, and contracts §11 lists no sign-up env name.)
This step needs the user's Clerk keys and cannot be automated; if they are not available yet, continue with Tasks 3–13 (pure code) and come back.

- [ ] **Step 9: Run the checks**

Run: `npm run typecheck -w web && npm run lint -w web`
Expected: both exit 0.

- [ ] **Step 10: Manual check in the browser**

Run: `npm run dev -w web`, then:
- `curl -sI http://localhost:3000/ | head -1` → `HTTP/1.1 307 Temporary Redirect` (to `/sign-in`).
- `curl -sI http://localhost:3000/cli/nothing.tgz | head -1` → `HTTP/1.1 404 Not Found` (public route, no redirect).
- Open `http://localhost:3000/sign-in`, sign in; the home page shows `Signed in as <your name>`; the Convex dashboard's `users` table has one row.

- [ ] **Step 11: Commit**

```bash
git add web/src/proxy.ts web/src/hooks/use-ensure-user.ts web/src/hooks/use-me.ts web/src/components/layout
git add -A web/src/app   # stages the new (app)/ pages, providers.tsx, sign-in/sign-up and the deletion of web/src/app/page.tsx
git commit -m "$(cat <<'MSG'
Add Clerk proxy, Convex providers, auth routes and the authenticated app gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 3: `lib/format.ts` — number, money, percent, duration and date formatting

**Files:**
- Create: `web/src/lib/format.ts`
- Test: `web/src/lib/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatInt(n)`, `formatCompact(n)`, `formatUsd(n)`, `formatPercent(fraction, digits?)`, `formatDeltaPercent(change)`, `formatDurationMs(ms)`, `formatHours(ms)`, `formatRelative(fromMs, nowMs)`, `formatResetsIn(resetsAtMs, nowMs)`, `formatDay(day)`, `formatDayShort(day)`, `formatMonth(day)`, `formatDateTime(ms)`, `formatNullable(value, fn)` — all `(…) => string`, deterministic (no locale lookups, no `Date.now()`).

- [ ] **Step 1: Write the failing tests `web/src/lib/format.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatDateTime,
  formatDay,
  formatDayShort,
  formatDeltaPercent,
  formatDurationMs,
  formatHours,
  formatInt,
  formatMonth,
  formatNullable,
  formatPercent,
  formatRelative,
  formatResetsIn,
  formatUsd,
} from "./format";

describe("formatInt", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1,000"],
    [1234567.6, "1,234,568"],
    [-42, "-42"],
  ])("%s → %s", (input, expected) => {
    expect(formatInt(input)).toBe(expected);
  });
});

describe("formatCompact", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1K"],
    [1234, "1.2K"],
    [12900, "12.9K"],
    [999999, "1M"],
    [1_500_000, "1.5M"],
    [5_600_000_000, "5.6B"],
    [2_100_000_000_000, "2.1T"],
    [-1234, "-1.2K"],
  ])("%s → %s", (input, expected) => {
    expect(formatCompact(input)).toBe(expected);
  });
});

describe("formatUsd", () => {
  it.each([
    [0, "$0.00"],
    [0.004, "<$0.01"],
    [0.01, "$0.01"],
    [12.345, "$12.35"],
    [99.999, "$100"],
    [100, "$100"],
    [1234.5, "$1,235"],
    [-3.5, "-$3.50"],
  ])("%s → %s", (input, expected) => {
    expect(formatUsd(input)).toBe(expected);
  });
});

describe("formatPercent / formatDeltaPercent", () => {
  it("formats fractions", () => {
    expect(formatPercent(0.4231)).toBe("42.3%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(0.4231, 0)).toBe("42%");
    expect(formatPercent(null)).toBe("—");
  });
  it("formats signed deltas with a real minus sign", () => {
    expect(formatDeltaPercent(0.25)).toBe("+25.0%");
    expect(formatDeltaPercent(-0.032)).toBe("−3.2%");
    expect(formatDeltaPercent(0)).toBe("0.0%");
    expect(formatDeltaPercent(null)).toBe("—");
  });
});

describe("formatDurationMs", () => {
  it.each([
    [0, "0s"],
    [-5, "0s"],
    [850, "850ms"],
    [12_000, "12s"],
    [725_000, "12m 5s"],
    [11_520_000, "3h 12m"],
    [187_200_000, "2d 4h"],
    [86_400_000, "1d 0h"],
  ])("%s → %s", (input, expected) => {
    expect(formatDurationMs(input)).toBe(expected);
  });
  it("formats hours with one decimal", () => {
    expect(formatHours(45_000_000)).toBe("12.5h");
    expect(formatHours(0)).toBe("0h");
    expect(formatHours(360_000_000)).toBe("100h");
  });
});

describe("formatRelative / formatResetsIn", () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0);
  it("describes elapsed time coarsely", () => {
    expect(formatRelative(now - 10_000, now)).toBe("just now");
    expect(formatRelative(now - 3 * 60_000, now)).toBe("3 min ago");
    expect(formatRelative(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(formatRelative(now - 5 * 86_400_000, now)).toBe("5 d ago");
    expect(formatRelative(now + 60_000, now)).toBe("just now");
  });
  it("describes the quota reset", () => {
    expect(formatResetsIn(null, now)).toBe("Reset time unknown");
    expect(formatResetsIn(now - 1, now)).toBe("Reset passed");
    expect(formatResetsIn(now + 30_000, now)).toBe("Resets in under a minute");
    expect(formatResetsIn(now + 187_200_000, now)).toBe("Resets in 2d 4h");
  });
});

describe("day formatting", () => {
  it("formats day strings without touching the local zone", () => {
    expect(formatDay("2026-09-01")).toBe("Sep 1, 2026");
    expect(formatDayShort("2026-12-25")).toBe("Dec 25");
    expect(formatMonth("2026-02-03")).toBe("Feb 2026");
  });
  it("formats a timestamp in local time as `Mon D, HH:MM`", () => {
    const d = new Date(2026, 8, 1, 14, 5);
    expect(formatDateTime(d.getTime())).toBe("Sep 1, 14:05");
  });
  it("formatNullable falls back to an em dash", () => {
    expect(formatNullable(null, formatCompact)).toBe("—");
    expect(formatNullable(1234, formatCompact)).toBe("1.2K");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/format.test.ts`
Expected: FAIL with `Failed to resolve import "./format"`.

- [ ] **Step 3: Implement `web/src/lib/format.ts`**

```ts
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const EM_DASH = "—";
const MINUS = "−";

function group(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const digits = String(rounded);
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 && rounded !== 0 ? `-${withCommas}` : withCommas;
}

export function formatInt(n: number): string {
  return group(n);
}

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs < 999.5) return group(n);
  const units: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size - size / 2000) {
      const value = abs / size;
      const text = value >= 999.95 ? trimZero((abs / size).toFixed(0)) : trimZero(value.toFixed(1));
      return `${sign}${text}${suffix}`;
    }
  }
  return group(n);
}

export function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs === 0) return "$0.00";
  if (abs < 0.005) return "<$0.01";
  if (abs < 99.995) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${group(abs)}`;
}

export function formatPercent(fraction: number | null, digits = 1): string {
  if (fraction === null || !Number.isFinite(fraction)) return EM_DASH;
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatDeltaPercent(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return EM_DASH;
  const pct = Math.abs(change * 100).toFixed(1);
  if (change > 0) return `+${pct}%`;
  if (change < 0) return `${MINUS}${pct}%`;
  return `${pct}%`;
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`;
  const days = Math.floor(totalHours / 24);
  return `${days}d ${totalHours % 24}h`;
}

export function formatHours(ms: number): string {
  const hours = Math.max(0, ms) / 3_600_000;
  if (hours >= 100) return `${Math.round(hours)}h`;
  return `${trimZero(hours.toFixed(1))}h`;
}

export function formatRelative(fromMs: number, nowMs: number): string {
  const diff = nowMs - fromMs;
  if (diff < 45_000) return "just now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(diff / 86_400_000);
  return `${days} d ago`;
}

export function formatResetsIn(resetsAtMs: number | null, nowMs: number): string {
  if (resetsAtMs === null) return "Reset time unknown";
  const diff = resetsAtMs - nowMs;
  if (diff <= 0) return "Reset passed";
  if (diff < 60_000) return "Resets in under a minute";
  const text = formatDurationMs(diff);
  const coarse = text.includes("d ") || text.includes("h ") ? text : text.replace(/\s\d+s$/, "");
  return `Resets in ${coarse}`;
}

function parts(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

export function formatDay(day: string): string {
  const { y, m, d } = parts(day);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatDayShort(day: string): string {
  const { m, d } = parts(day);
  return `${MONTHS[m - 1]} ${d}`;
}

export function formatMonth(day: string): string {
  const { y, m } = parts(day);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
}

export function formatNullable<T>(value: T | null | undefined, fn: (v: T) => string): string {
  return value === null || value === undefined ? EM_DASH : fn(value);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run --project unit src/lib/format.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/format.ts web/src/lib/format.test.ts
git commit -m "$(cat <<'MSG'
Add number, money, duration and date formatters for the dashboard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 4: `lib/range.ts` — presets, custom ranges and the ALL preset

**Files:**
- Create: `web/src/lib/range.ts`
- Test: `web/src/lib/range.test.ts`

**Interfaces:**
- Consumes: `@shared/days` (`addDays`, `compareDays`, `daysBetween`, `isValidDay`), `@shared/constants` (`MAX_CUSTOM_RANGE_DAYS`, `MAX_QUERY_RANGE_DAYS`), `@convex/lib/types` (`BoundsResult`), `formatDay`/`formatDayShort` from Task 3.
- Produces: `PRESETS`, `type Preset`, `DEFAULT_PRESET`, `type RangeParams = { range: Preset; from: string | null; to: string | null }`, `type ResolvedRange = { kind: Preset | "custom"; from: string; to: string; days: number; previous: boolean; label: string }`, `isCustom(params)`, `resolveRange(params, today, bounds?)`, `presetLabel(preset)`.

- [ ] **Step 1: Write the failing tests `web/src/lib/range.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET, isCustom, presetLabel, resolveRange, type RangeParams } from "./range";

const preset = (range: RangeParams["range"]): RangeParams => ({ range, from: null, to: null });

describe("resolveRange presets", () => {
  it("1D is today only, with a previous period", () => {
    expect(resolveRange(preset("1D"), "2026-09-01")).toEqual({
      kind: "1D",
      from: "2026-09-01",
      to: "2026-09-01",
      days: 1,
      previous: true,
      label: "Today",
    });
  });
  it("30D crosses a month boundary", () => {
    const r = resolveRange(preset("30D"), "2026-03-01");
    expect(r?.from).toBe("2026-01-31");
    expect(r?.to).toBe("2026-03-01");
    expect(r?.days).toBe(30);
  });
  it("30D respects leap years", () => {
    expect(resolveRange(preset("30D"), "2024-03-01")?.from).toBe("2024-02-01");
  });
  it("7D crosses a year boundary", () => {
    expect(resolveRange(preset("7D"), "2026-01-01")?.from).toBe("2025-12-26");
  });
  it("90D", () => {
    const r = resolveRange(preset("90D"), "2026-09-01");
    expect(r?.from).toBe("2026-06-04");
    expect(r?.label).toBe("Last 90 days");
  });
});

describe("resolveRange ALL", () => {
  it("is unresolved until bounds are known", () => {
    expect(resolveRange(preset("ALL"), "2026-09-01")).toBeNull();
    expect(resolveRange(preset("ALL"), "2026-09-01", null)).toBeNull();
  });
  it("uses the first data day and hides deltas", () => {
    const r = resolveRange(preset("ALL"), "2026-09-01", { firstDay: "2026-07-10", lastDay: "2026-09-01" });
    expect(r).toEqual({
      kind: "ALL",
      from: "2026-07-10",
      to: "2026-09-01",
      days: 54,
      previous: false,
      label: "All time",
    });
  });
  it("falls back to today when there is no data", () => {
    const r = resolveRange(preset("ALL"), "2026-09-01", { firstDay: null, lastDay: null });
    expect(r?.from).toBe("2026-09-01");
    expect(r?.previous).toBe(false);
  });
  it("clamps to the server's 1100-day cap", () => {
    const r = resolveRange(preset("ALL"), "2026-09-01", { firstDay: "2020-01-01", lastDay: "2026-09-01" });
    expect(r?.days).toBe(1100);
    expect(r?.from).toBe("2023-08-29");
  });
});

describe("resolveRange custom", () => {
  it("uses from/to when both are valid", () => {
    const r = resolveRange({ range: DEFAULT_PRESET, from: "2026-08-01", to: "2026-08-15" }, "2026-09-01");
    expect(r).toEqual({
      kind: "custom",
      from: "2026-08-01",
      to: "2026-08-15",
      days: 15,
      previous: true,
      label: "Aug 1 – Aug 15, 2026",
    });
  });
  it("clamps `to` to today", () => {
    const r = resolveRange({ range: DEFAULT_PRESET, from: "2026-08-20", to: "2026-12-31" }, "2026-09-01");
    expect(r?.to).toBe("2026-09-01");
    expect(r?.kind).toBe("custom");
  });
  it("falls back to 30D when the span exceeds 400 days", () => {
    const r = resolveRange({ range: DEFAULT_PRESET, from: "2024-01-01", to: "2026-09-01" }, "2026-09-01");
    expect(r?.kind).toBe("30D");
  });
  it("falls back to 30D for invalid days or from > to", () => {
    expect(resolveRange({ range: "7D", from: "2026-02-30", to: "2026-03-01" }, "2026-09-01")?.kind).toBe("30D");
    expect(resolveRange({ range: "7D", from: "2026-03-05", to: "2026-03-01" }, "2026-09-01")?.kind).toBe("30D");
    expect(resolveRange({ range: "7D", from: "2026-09-05", to: "2026-09-06" }, "2026-09-01")?.kind).toBe("30D");
  });
  it("isCustom requires both ends", () => {
    expect(isCustom({ range: "7D", from: "2026-08-01", to: null })).toBe(false);
    expect(isCustom({ range: "7D", from: "2026-08-01", to: "2026-08-02" })).toBe(true);
  });
});

describe("presetLabel", () => {
  it("names every preset", () => {
    expect(presetLabel("1D")).toBe("Today");
    expect(presetLabel("7D")).toBe("Last 7 days");
    expect(presetLabel("30D")).toBe("Last 30 days");
    expect(presetLabel("90D")).toBe("Last 90 days");
    expect(presetLabel("ALL")).toBe("All time");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/range.test.ts`
Expected: FAIL with `Failed to resolve import "./range"`.

- [ ] **Step 3: Implement `web/src/lib/range.ts`**

```ts
import { MAX_CUSTOM_RANGE_DAYS, MAX_QUERY_RANGE_DAYS } from "@shared/constants";
import { addDays, compareDays, daysBetween, isValidDay } from "@shared/days";
import type { BoundsResult } from "@convex/lib/types";
import { formatDay, formatDayShort } from "./format";

export const PRESETS = ["1D", "7D", "30D", "90D", "ALL"] as const;
export type Preset = (typeof PRESETS)[number];
export const DEFAULT_PRESET: Preset = "30D";

const PRESET_DAYS: Record<Exclude<Preset, "ALL">, number> = { "1D": 1, "7D": 7, "30D": 30, "90D": 90 };

export type RangeParams = { range: Preset; from: string | null; to: string | null };

export type ResolvedRange = {
  kind: Preset | "custom";
  from: string;
  to: string;
  days: number;
  /** Whether the previous period exists (delta pills shown, server folds `previousPeriod`). */
  previous: boolean;
  label: string;
};

export function presetLabel(preset: Preset): string {
  switch (preset) {
    case "1D":
      return "Today";
    case "ALL":
      return "All time";
    default:
      return `Last ${PRESET_DAYS[preset]} days`;
  }
}

export function isCustom(params: RangeParams): boolean {
  return params.from !== null && params.to !== null;
}

function customLabel(from: string, to: string): string {
  return `${formatDayShort(from)} – ${formatDay(to)}`;
}

function resolvePreset(preset: Exclude<Preset, "ALL">, today: string): ResolvedRange {
  const days = PRESET_DAYS[preset];
  return {
    kind: preset,
    from: addDays(today, -(days - 1)),
    to: today,
    days,
    previous: true,
    label: presetLabel(preset),
  };
}

function resolveCustom(from: string, to: string, today: string): ResolvedRange | null {
  if (!isValidDay(from) || !isValidDay(to)) return null;
  const clampedTo = compareDays(to, today) > 0 ? today : to;
  if (compareDays(from, clampedTo) > 0) return null;
  const days = daysBetween(from, clampedTo);
  if (days > MAX_CUSTOM_RANGE_DAYS) return null;
  return { kind: "custom", from, to: clampedTo, days, previous: true, label: customLabel(from, clampedTo) };
}

/**
 * Pure range resolution. Returns `null` only for the ALL preset while `bounds` is unknown.
 * Invalid custom ranges fall back to the default preset.
 */
export function resolveRange(
  params: RangeParams,
  today: string,
  bounds?: BoundsResult | null,
): ResolvedRange | null {
  if (params.from !== null && params.to !== null) {
    return resolveCustom(params.from, params.to, today) ?? resolvePreset(DEFAULT_PRESET, today);
  }
  if (params.range === "ALL") {
    if (bounds === undefined || bounds === null) return null;
    const earliest = addDays(today, -(MAX_QUERY_RANGE_DAYS - 1));
    const first = bounds.firstDay ?? today;
    const from = compareDays(first, earliest) < 0 ? earliest : first;
    return {
      kind: "ALL",
      from,
      to: today,
      days: daysBetween(from, today),
      previous: false,
      label: presetLabel("ALL"),
    };
  }
  return resolvePreset(params.range, today);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run --project unit src/lib/range.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/range.ts web/src/lib/range.test.ts
git commit -m "$(cat <<'MSG'
Add pure range resolution for presets, custom ranges and all-time

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 5: `lib/search-params.ts` — nuqs parsers shared by hooks, hrefs and tests

**Files:**
- Create: `web/src/lib/search-params.ts`
- Test: `web/src/lib/search-params.test.ts`

**Interfaces:**
- Consumes: `nuqs/server` (`parseAsString`, `parseAsStringLiteral`, `createSerializer`), `PRESETS`/`DEFAULT_PRESET`/`RangeParams`/`isCustom` from Task 4.
- Produces: `SECTIONS`, `VIEWS`, `TABS` (+ types `Section`, `View`, `Tab`), `rangeParsers` (`{ range, from, to }`), `sectionParser`, `viewParser`, `tabParser`, `rangeHref(pathname, params)`, `presetParams(preset)`, `customParams(from, to)`.

- [ ] **Step 1: Write the failing tests `web/src/lib/search-params.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  customParams,
  presetParams,
  rangeHref,
  rangeParsers,
  sectionParser,
  tabParser,
  viewParser,
} from "./search-params";

describe("parsers", () => {
  it("range defaults to 30D and rejects unknown values", () => {
    expect(rangeParsers.range.parseServerSide(undefined)).toBe("30D");
    expect(rangeParsers.range.parseServerSide("7D")).toBe("7D");
    expect(rangeParsers.range.parseServerSide("bogus")).toBe("30D");
  });
  it("section/view/tab default and validate", () => {
    expect(sectionParser.parseServerSide(undefined)).toBe("users");
    expect(sectionParser.parseServerSide("models")).toBe("models");
    expect(viewParser.parseServerSide("efficiency")).toBe("efficiency");
    expect(viewParser.parseServerSide("x")).toBe("volume");
    expect(tabParser.parseServerSide("sessions")).toBe("sessions");
    expect(tabParser.parseServerSide(undefined)).toBe("overview");
  });
});

describe("rangeHref", () => {
  it("keeps the preset visible in the URL, even the default", () => {
    expect(rangeHref("/users/abc", presetParams("30D"))).toBe("/users/abc?range=30D");
    expect(rangeHref("/", presetParams("7D"))).toBe("/?range=7D");
  });
  it("writes from/to for custom ranges and drops the preset", () => {
    expect(rangeHref("/settings", customParams("2026-08-01", "2026-08-15"))).toBe(
      "/settings?from=2026-08-01&to=2026-08-15",
    );
  });
  it("carries only the range keys, never anything else", () => {
    const preset = new URL(rangeHref("/", { range: "90D", from: null, to: null }), "https://x.test");
    expect([...preset.searchParams.keys()]).toEqual(["range"]);
    const custom = new URL(rangeHref("/", customParams("2026-08-01", "2026-08-15")), "https://x.test");
    expect([...custom.searchParams.keys()].sort()).toEqual(["from", "to"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/search-params.test.ts`
Expected: FAIL with `Failed to resolve import "./search-params"`.

- [ ] **Step 3: Implement `web/src/lib/search-params.ts`**

```ts
import { createSerializer, parseAsString, parseAsStringLiteral } from "nuqs/server";
import { DEFAULT_PRESET, PRESETS, isCustom, type Preset, type RangeParams } from "./range";

export const SECTIONS = ["users", "models", "tools", "projects", "skills"] as const;
export type Section = (typeof SECTIONS)[number];
export const VIEWS = ["volume", "efficiency"] as const;
export type View = (typeof VIEWS)[number];
export const TABS = ["overview", "breakdown", "efficiency", "sessions"] as const;
export type Tab = (typeof TABS)[number];

const push = { history: "push" as const };

export const rangeParsers = {
  range: parseAsStringLiteral(PRESETS)
    .withDefault(DEFAULT_PRESET)
    .withOptions({ ...push, clearOnDefault: false }),
  from: parseAsString.withOptions(push),
  to: parseAsString.withOptions(push),
};

export const sectionParser = parseAsStringLiteral(SECTIONS).withDefault("users").withOptions(push);
export const viewParser = parseAsStringLiteral(VIEWS).withDefault("volume").withOptions(push);
export const tabParser = parseAsStringLiteral(TABS).withDefault("overview").withOptions(push);

const serializeRange = createSerializer(rangeParsers, { clearOnDefault: false });

export function presetParams(preset: Preset): RangeParams {
  return { range: preset, from: null, to: null };
}

export function customParams(from: string, to: string): RangeParams {
  return { range: DEFAULT_PRESET, from, to };
}

/** Builds an href that carries only the range state (page-local params are dropped). */
export function rangeHref(pathname: string, params: RangeParams): string {
  if (isCustom(params)) {
    return serializeRange(pathname, { from: params.from, to: params.to });
  }
  return serializeRange(pathname, { range: params.range });
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run --project unit src/lib/search-params.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/search-params.ts web/src/lib/search-params.test.ts
git commit -m "$(cat <<'MSG'
Add shared nuqs parsers and range-preserving hrefs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 6: `lib/colors.ts` — palette constants and stable entity → color slots

**Files:**
- Create: `web/src/lib/colors.ts`
- Test: `web/src/lib/colors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CATEGORICAL` (8 hex), `OTHER_COLOR`, `HEAT_RAMP` (5 hex), `STATUS_COLORS`, `DELTA_COLORS`, `type ColorMap = ReadonlyMap<string, string>`, `assignSlots(keys)`, `colorFor(map, key)`, `userColorMap(userIds)`, `modelRegistryOrder(pricedModels, seenModels)`, `modelColorMap(pricedModels, seenModels)`, `quotaColor(usedPercent)`, `heatColor(level)`.

- [ ] **Step 1: Write the failing tests `web/src/lib/colors.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  CATEGORICAL,
  OTHER_COLOR,
  assignSlots,
  colorFor,
  heatColor,
  modelColorMap,
  modelRegistryOrder,
  quotaColor,
  userColorMap,
} from "./colors";

describe("assignSlots", () => {
  it("assigns the fixed palette in order and folds the 9th into gray", () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const map = assignSlots(keys);
    expect(map.get("a")).toBe(CATEGORICAL[0]);
    expect(map.get("h")).toBe(CATEGORICAL[7]);
    expect(map.get("i")).toBe(OTHER_COLOR);
    expect(colorFor(map, "unknown")).toBe(OTHER_COLOR);
  });
  it("ignores duplicate keys", () => {
    const map = assignSlots(["a", "a", "b"]);
    expect(map.get("b")).toBe(CATEGORICAL[1]);
  });
});

describe("userColorMap", () => {
  it("is stable regardless of input order", () => {
    const a = userColorMap(["u2", "u1", "u3"]);
    const b = userColorMap(["u3", "u2", "u1"]);
    expect(a.get("u1")).toBe(CATEGORICAL[0]);
    expect(b.get("u1")).toBe(CATEGORICAL[0]);
    expect(a.get("u3")).toBe(b.get("u3"));
  });
  it("keeps a survivor's slot when the view reorders, and repaints when the list is filtered", () => {
    const all = userColorMap(["u1", "u2", "u3"]);
    expect(all.get("u3")).toBe(CATEGORICAL[2]);
    // Reordering the same registry cannot repaint anyone.
    expect(userColorMap(["u3", "u1", "u2"]).get("u3")).toBe(all.get("u3"));
    // Filtering does repaint — which is why `useUserColors` builds the map from `api.users.list`
    // (the full registry) and never from the rows currently on screen.
    expect(userColorMap(["u3"]).get("u3")).toBe(CATEGORICAL[0]);
    expect(userColorMap(["u3"]).get("u3")).not.toBe(all.get("u3"));
  });
});

describe("modelRegistryOrder", () => {
  it("puts priced models newest-first, then unpriced seen models alphabetically", () => {
    const priced = ["gpt-5", "gpt-5.6-sol", "gpt-5.4", "gpt-5.6-luna", "o3", "gpt-5-mini"];
    const seen = ["codex-auto-review", "gpt-5.6-sol", "gpt-5.7-preview"];
    expect(modelRegistryOrder(priced, seen)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.4",
      "gpt-5",
      "gpt-5-mini",
      "o3",
      "codex-auto-review",
      "gpt-5.7-preview",
    ]);
  });
  it("gives the newest priced models the first slots", () => {
    const map = modelColorMap(["gpt-5", "gpt-5.6-sol"], ["gpt-5.6-sol"]);
    expect(map.get("gpt-5.6-sol")).toBe(CATEGORICAL[0]);
    expect(map.get("gpt-5")).toBe(CATEGORICAL[1]);
  });
});

describe("status helpers", () => {
  it("maps quota usage to status colors", () => {
    expect(quotaColor(10)).toBe("#0ca30c");
    expect(quotaColor(60)).toBe("#fab219");
    expect(quotaColor(84.9)).toBe("#fab219");
    expect(quotaColor(85)).toBe("#d03b3b");
  });
  it("maps heat levels to the ramp", () => {
    expect(heatColor(0)).toBe("#eceff3");
    expect(heatColor(4)).toBe("#0d532b");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/colors.test.ts`
Expected: FAIL with `Failed to resolve import "./colors"`.

- [ ] **Step 3: Implement `web/src/lib/colors.ts`**

```ts
export const CATEGORICAL = [
  "#008300",
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#4a3aa7",
  "#e34948",
] as const;
export const OTHER_COLOR = "#9aa3ae";
export const HEAT_RAMP = ["#eceff3", "#6cc482", "#2f9f55", "#1a7a40", "#0d532b"] as const;
export const STATUS_COLORS = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b" } as const;
export const DELTA_COLORS = {
  up: { fg: "#006300", bg: "#e6f4e6" },
  down: { fg: "#b42318", bg: "#fdecec" },
} as const;

export type ColorMap = ReadonlyMap<string, string>;

/** Fixed-order slot assignment: the first 8 distinct keys get the palette, the rest are gray. */
export function assignSlots(keys: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of keys) {
    if (map.has(key)) continue;
    const slot = map.size;
    map.set(key, slot < CATEGORICAL.length ? CATEGORICAL[slot]! : OTHER_COLOR);
  }
  return map;
}

export function colorFor(map: ColorMap, key: string): string {
  return map.get(key) ?? OTHER_COLOR;
}

export function userColorMap(userIds: readonly string[]): Map<string, string> {
  return assignSlots([...userIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

function modelVersion(model: string): number | null {
  const match = /^gpt-(\d+(?:\.\d+)?)/.exec(model);
  return match ? Number(match[1]) : null;
}

function comparePriced(a: string, b: string): number {
  const va = modelVersion(a);
  const vb = modelVersion(b);
  if (va !== null && vb !== null && va !== vb) return vb - va;
  if (va !== null && vb === null) return -1;
  if (va === null && vb !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Priced models newest-first (by `gpt-<version>`), then unpriced seen models alphabetically. */
export function modelRegistryOrder(pricedModels: readonly string[], seenModels: readonly string[]): string[] {
  const priced = [...new Set(pricedModels)].sort(comparePriced);
  const pricedSet = new Set(priced);
  const extras = [...new Set(seenModels)]
    .filter((m) => !pricedSet.has(m))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [...priced, ...extras];
}

export function modelColorMap(pricedModels: readonly string[], seenModels: readonly string[]): Map<string, string> {
  return assignSlots(modelRegistryOrder(pricedModels, seenModels));
}

export function quotaColor(usedPercent: number): string {
  if (usedPercent < 60) return STATUS_COLORS.good;
  if (usedPercent < 85) return STATUS_COLORS.warning;
  return STATUS_COLORS.critical;
}

export function heatColor(level: 0 | 1 | 2 | 3 | 4): string {
  return HEAT_RAMP[level];
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run --project unit src/lib/colors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/colors.ts web/src/lib/colors.test.ts
git commit -m "$(cat <<'MSG'
Add the validated palette and stable entity color slots

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 7: `lib/metrics.ts` — metric definitions, value formatting and delta polarity

**Files:**
- Create: `web/src/lib/metrics.ts`
- Test: `web/src/lib/metrics.test.ts`

**Interfaces:**
- Consumes: `MetricKey`, `Metric`, `SummaryResult` from `@convex/lib/types`; formatters from Task 3.
- Produces: `type MetricKind`, `type GoodDirection = "up" | "down" | "neutral"`, `type MetricDef = { key: MetricKey; label: string; kind: MetricKind; goodDirection: GoodDirection; help: string }`, `METRIC_DEFS: Record<MetricKey, MetricDef>`, `VOLUME_CARD_KEYS`, `EFFICIENCY_CARD_KEYS`, `USER_OVERVIEW_KEYS` (13 keys), `formatMetricValue(kind, value)`, `deltaTone(change, goodDirection)`, `metricOf(summary, key)`.
- Never redefines shared math: division guards come from `ratio` in `@shared/metrics` (contracts §5), which every caller imports directly.

- [ ] **Step 1: Write the failing tests `web/src/lib/metrics.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  EFFICIENCY_CARD_KEYS,
  METRIC_DEFS,
  USER_OVERVIEW_KEYS,
  VOLUME_CARD_KEYS,
  deltaTone,
  formatMetricValue,
} from "./metrics";

describe("METRIC_DEFS", () => {
  it("defines every card key", () => {
    for (const key of [...VOLUME_CARD_KEYS, ...EFFICIENCY_CARD_KEYS, ...USER_OVERVIEW_KEYS]) {
      expect(METRIC_DEFS[key].label.length).toBeGreaterThan(0);
      expect(METRIC_DEFS[key].help.length).toBeGreaterThan(0);
    }
    expect(USER_OVERVIEW_KEYS).toHaveLength(13);
  });
  it("marks latency and waste metrics as lower-is-better", () => {
    expect(METRIC_DEFS.ttftP50Ms.goodDirection).toBe("down");
    expect(METRIC_DEFS.tokensPerLine.goodDirection).toBe("down");
    expect(METRIC_DEFS.compactions.goodDirection).toBe("down");
    expect(METRIC_DEFS.cacheHitRate.goodDirection).toBe("up");
    expect(METRIC_DEFS.totalTokens.goodDirection).toBe("up");
  });
  it("marks metrics with no better direction as neutral", () => {
    expect(METRIC_DEFS.costUsd.goodDirection).toBe("neutral");
    expect(METRIC_DEFS.linesRemoved.goodDirection).toBe("neutral");
  });
});

describe("formatMetricValue", () => {
  it.each([
    ["tokens", 1_234_567, "1.2M"],
    ["usd", 12.5, "$12.50"],
    ["percent", 0.42, "42.0%"],
    ["duration", 725_000, "12m 5s"],
    ["hours", 45_000_000, "12.5h"],
    ["count", 1234, "1,234"],
    ["ratio", 3.456, "3.5"],
  ] as const)("%s %s → %s", (kind, value, expected) => {
    expect(formatMetricValue(kind, value)).toBe(expected);
  });
  it("renders null as an em dash", () => {
    expect(formatMetricValue("percent", null)).toBe("—");
  });
});

describe("deltaTone", () => {
  it("is positive when the change goes in the good direction", () => {
    expect(deltaTone(0.2, "up")).toEqual({ tone: "up", good: true });
    expect(deltaTone(-0.2, "up")).toEqual({ tone: "down", good: false });
    expect(deltaTone(-0.2, "down")).toEqual({ tone: "down", good: true });
    expect(deltaTone(0.2, "down")).toEqual({ tone: "up", good: false });
  });
  it("is flat for zero or unknown", () => {
    expect(deltaTone(0, "up")).toEqual({ tone: "flat", good: null });
    expect(deltaTone(null, "up")).toEqual({ tone: "flat", good: null });
  });
  it("keeps the direction but no verdict for neutral metrics", () => {
    expect(deltaTone(0.2, "neutral")).toEqual({ tone: "up", good: null });
    expect(deltaTone(-0.2, "neutral")).toEqual({ tone: "down", good: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/metrics.test.ts`
Expected: FAIL with `Failed to resolve import "./metrics"`.

- [ ] **Step 3: Implement `web/src/lib/metrics.ts`**

```ts
import type { Metric, MetricKey, SummaryResult } from "@convex/lib/types";
import {
  EM_DASH,
  formatCompact,
  formatDurationMs,
  formatHours,
  formatInt,
  formatPercent,
  formatUsd,
} from "./format";

export type MetricKind = "tokens" | "usd" | "percent" | "duration" | "hours" | "count" | "ratio";
/** `"neutral"` = the direction carries no verdict (spending more is neither good nor bad). */
export type GoodDirection = "up" | "down" | "neutral";
export type MetricDef = {
  key: MetricKey;
  label: string;
  kind: MetricKind;
  goodDirection: GoodDirection;
  help: string;
};

function def(key: MetricKey, label: string, kind: MetricKind, goodDirection: GoodDirection, help: string): MetricDef {
  return { key, label, kind, goodDirection, help };
}

export const METRIC_DEFS: Record<MetricKey, MetricDef> = {
  totalTokens: def("totalTokens", "Total tokens", "tokens", "up", "Input + output tokens of every model response in the period, including sub-agent threads."),
  inputTokens: def("inputTokens", "Input context", "tokens", "up", "Prompt tokens sent to the model (cached tokens included)."),
  cachedInputTokens: def("cachedInputTokens", "Cached input", "tokens", "up", "Input tokens served from the prompt cache."),
  outputTokens: def("outputTokens", "Output tokens", "tokens", "up", "Tokens generated by the model (reasoning included)."),
  reasoningTokens: def("reasoningTokens", "Reasoning tokens", "tokens", "up", "Hidden reasoning tokens, a subset of output tokens."),
  subagentTokens: def("subagentTokens", "Sub-agent tokens", "tokens", "up", "Tokens used by sub-agent threads such as the auto-review guardian."),
  costUsd: def("costUsd", "Estimated cost", "usd", "neutral", "Tokens priced at OpenAI API list prices from the Settings page. Unpriced models count as $0."),
  linesAdded: def("linesAdded", "Generated lines", "count", "up", "Lines added by file changes (diff '+' lines plus new-file contents)."),
  linesRemoved: def("linesRemoved", "Removed lines", "count", "neutral", "Lines removed by file changes."),
  filesChanged: def("filesChanged", "Files changed", "count", "up", "Files touched by file-change items."),
  sessions: def("sessions", "Sessions", "count", "up", "Codex threads started in the period (sub-agent threads excluded)."),
  turns: def("turns", "Turns", "count", "up", "User turns (task_started events) in main threads."),
  responses: def("responses", "Responses", "count", "up", "Model responses (token events)."),
  messages: def("messages", "Messages", "count", "up", "User plus agent messages in main threads."),
  userMessages: def("userMessages", "User messages", "count", "up", "Messages typed by the user."),
  agentMessages: def("agentMessages", "Agent messages", "count", "up", "Messages written by the agent."),
  cacheHitRate: def("cacheHitRate", "Cache hit rate", "percent", "up", "Cached input tokens divided by input tokens."),
  tokensPerTurn: def("tokensPerTurn", "Tokens per turn", "tokens", "down", "Total tokens divided by turns."),
  tokensPerLine: def("tokensPerLine", "Tokens per line", "tokens", "down", "Total tokens divided by generated lines."),
  avgSessionActiveMs: def("avgSessionActiveMs", "Avg session", "duration", "up", "Active time divided by sessions."),
  activeRate: def("activeRate", "Active rate", "percent", "up", "Active time divided by wall time."),
  activeMs: def("activeMs", "Active hours", "hours", "up", "Sum of turn durations (the model was working)."),
  wallMs: def("wallMs", "Total hours", "hours", "up", "Sum of session spans from first to last event."),
  ttftAvgMs: def("ttftAvgMs", "TTFT mean", "duration", "down", "Mean time to first token per turn."),
  ttftP50Ms: def("ttftP50Ms", "TTFT median", "duration", "down", "Approximate median time to first token, interpolated from a 16-bucket histogram."),
  compactions: def("compactions", "Compactions", "count", "down", "Context compactions (a sign of long, expensive threads)."),
  activeDays: def("activeDays", "Active days", "count", "up", "Days with at least one session or token event."),
};

export const VOLUME_CARD_KEYS = ["totalTokens", "costUsd", "linesAdded", "sessions"] as const;
export const EFFICIENCY_CARD_KEYS = [
  "cacheHitRate",
  "tokensPerTurn",
  "avgSessionActiveMs",
  "ttftP50Ms",
  "compactions",
] as const;
export const USER_OVERVIEW_KEYS = [
  "costUsd",
  "totalTokens",
  "linesAdded",
  "tokensPerLine",
  "inputTokens",
  "outputTokens",
  "activeDays",
  "cacheHitRate",
  "activeMs",
  "sessions",
  "wallMs",
  "messages",
  "userMessages",
] as const;

export function formatMetricValue(kind: MetricKind, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  switch (kind) {
    case "tokens":
      return formatCompact(value);
    case "usd":
      return formatUsd(value);
    case "percent":
      return formatPercent(value);
    case "duration":
      return formatDurationMs(value);
    case "hours":
      return formatHours(value);
    case "count":
      return formatInt(value);
    case "ratio":
      return value.toFixed(1);
  }
}

export type DeltaTone = "up" | "down" | "flat";

export function deltaTone(change: number | null, goodDirection: GoodDirection): { tone: DeltaTone; good: boolean | null } {
  if (change === null || !Number.isFinite(change) || change === 0) return { tone: "flat", good: null };
  const tone: DeltaTone = change > 0 ? "up" : "down";
  // A neutral metric keeps its arrow but gets no better/worse verdict.
  if (goodDirection === "neutral") return { tone, good: null };
  return { tone, good: tone === goodDirection };
}

export function metricOf(summary: SummaryResult | undefined, key: MetricKey): Metric | null {
  return summary ? summary.metrics[key] : null;
}
```

Division guards use `ratio` from `@shared/metrics` (contracts §5: `ratio(numerator, denominator)`, `denominator ≤ 0 → null`); this module never redefines it.

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run --project unit src/lib/metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/metrics.ts web/src/lib/metrics.test.ts
git commit -m "$(cat <<'MSG'
Add metric definitions with formatting kinds and delta polarity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 8: `lib/chart-data.ts` — rows/series for stacked charts, peak and top-N folding

**Files:**
- Create: `web/src/lib/chart-data.ts`
- Test: `web/src/lib/chart-data.test.ts`

**Interfaces:**
- Consumes: `TrendsResult`, `CostByKind` from `@convex/lib/types`; `OTHER_KEY` from `@shared/constants` (contracts §2 — never redeclared here); `ColorMap`, `colorFor`, `OTHER_COLOR`, `CATEGORICAL` from Task 6; `formatDayShort`, `formatMonth` from Task 3.
- Produces: `type SeriesDef = { key: string; label: string; color: string; entity: string }`, `type ChartRow = { x: string; label: string } & Record<string, number | string>`, `type Stacked = { rows: ChartRow[]; series: SeriesDef[]; peak: { x: string; label: string; total: number } | null; total: number }`, `type Segment = { key: string; label: string; value: number; share: number; color: string }`, `bucketLabel(bucket, granularity)`, `trendByUser(trends, colors)`, `trendByModel(trends, colors, topN?)`, `trendSingle(trends, metric, color)`, `foldTopN(items, n, otherKey?)`, `costStructureSegments(costByKind)`, `shareSegments(items, colors, topN?)`.

- [ ] **Step 1: Write the failing tests `web/src/lib/chart-data.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { TrendsResult } from "@convex/lib/types";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORICAL, OTHER_COLOR, assignSlots } from "./colors";
import {
  bucketLabel,
  costStructureSegments,
  foldTopN,
  shareSegments,
  trendByModel,
  trendByUser,
  trendSingle,
} from "./chart-data";

const tokens = (total: number) => ({ input: total, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total });
const u1 = "u1" as Id<"users">;
const u2 = "u2" as Id<"users">;

const trends: TrendsResult = {
  bucket: "day",
  users: [
    { userId: u1, name: "Ada", imageUrl: null },
    { userId: u2, name: "Bob", imageUrl: null },
  ],
  models: ["gpt-5.6-sol", "gpt-5.6-luna", "m3", "m4", "m5", "m6", "m7", "m8", "m9"],
  peak: { bucket: "2026-09-02", total: 400 },
  points: [
    {
      bucket: "2026-09-01",
      total: 100,
      tokens: tokens(100),
      costUsd: 1,
      activeMs: 3_600_000,
      sessions: 1,
      byUser: [{ key: "u1", tokens: 100, costUsd: 1, activeMs: 3_600_000 }],
      byModel: [{ key: "gpt-5.6-sol", tokens: 100 }],
    },
    {
      bucket: "2026-09-02",
      total: 400,
      tokens: tokens(400),
      costUsd: 3,
      activeMs: 7_200_000,
      sessions: 2,
      byUser: [
        { key: "u1", tokens: 100, costUsd: 1, activeMs: 3_600_000 },
        { key: "u2", tokens: 300, costUsd: 2, activeMs: 3_600_000 },
      ],
      byModel: [
        { key: "gpt-5.6-sol", tokens: 100 },
        { key: "gpt-5.6-luna", tokens: 100 },
        { key: "m3", tokens: 20 },
        { key: "m4", tokens: 20 },
        { key: "m5", tokens: 20 },
        { key: "m6", tokens: 10 },
        { key: "m7", tokens: 10 },
        { key: "m8", tokens: 10 },
        { key: "m9", tokens: 10 },
      ],
    },
  ],
};

describe("bucketLabel", () => {
  it("labels days/weeks by day and months by month", () => {
    expect(bucketLabel("2026-09-01", "day")).toBe("Sep 1");
    expect(bucketLabel("2026-08-31", "week")).toBe("Aug 31");
    expect(bucketLabel("2026-09-01", "month")).toBe("Sep 2026");
  });
});

describe("trendByUser", () => {
  const colors = assignSlots(["u1", "u2"]);
  it("builds one slot series per user sorted by total desc, zero-filled rows and the peak", () => {
    const stacked = trendByUser(trends, colors);
    expect(stacked.series.map((s) => s.label)).toEqual(["Bob", "Ada"]);
    expect(stacked.series[0]).toEqual({ key: "s0", label: "Bob", color: CATEGORICAL[1], entity: "u2" });
    expect(stacked.rows).toEqual([
      { x: "2026-09-01", label: "Sep 1", s0: 0, s1: 100 },
      { x: "2026-09-02", label: "Sep 2", s0: 300, s1: 100 },
    ]);
    expect(stacked.peak).toEqual({ x: "2026-09-02", label: "Sep 2", total: 400 });
    expect(stacked.total).toBe(500);
  });
});

describe("trendByModel", () => {
  it("keeps the top 7 models and folds the rest into other, never using dotted keys", () => {
    const colors = assignSlots(["gpt-5.6-sol", "gpt-5.6-luna"]);
    const stacked = trendByModel(trends, colors, 7);
    expect(stacked.series).toHaveLength(8);
    expect(stacked.series[0]).toEqual({ key: "s0", label: "gpt-5.6-sol", color: CATEGORICAL[0], entity: "gpt-5.6-sol" });
    expect(stacked.series[7]).toEqual({ key: "other", label: "Other", color: OTHER_COLOR, entity: "(other)" });
    for (const s of stacked.series) expect(s.key).not.toContain(".");
    expect(stacked.rows[1]?.other).toBe(20); // m8 + m9
    expect(stacked.rows[0]?.other).toBe(0);
  });
});

describe("trendSingle", () => {
  it("maps tokens, cost and hours to a single series", () => {
    expect(trendSingle(trends, "tokens", "#000").rows.map((r) => r.s0)).toEqual([100, 400]);
    expect(trendSingle(trends, "cost", "#000").rows.map((r) => r.s0)).toEqual([1, 3]);
    expect(trendSingle(trends, "hours", "#000").rows.map((r) => r.s0)).toEqual([1, 2]);
    expect(trendSingle(trends, "tokens", "#000").series).toEqual([
      { key: "s0", label: "Tokens", color: "#000", entity: "total" },
    ]);
  });
});

describe("foldTopN / segments", () => {
  it("folds the tail into an other entry only when needed", () => {
    const items = [
      { key: "a", value: 5 },
      { key: "b", value: 3 },
      { key: "c", value: 1 },
    ];
    expect(foldTopN(items, 2)).toEqual([
      { key: "a", value: 5 },
      { key: "b", value: 3 },
      { key: "(other)", value: 1 },
    ]);
    expect(foldTopN(items, 3)).toEqual(items);
  });
  it("computes cost structure shares", () => {
    const segs = costStructureSegments({ input: 5, cached: 1, output: 3, reasoning: 1 });
    expect(segs.map((s) => s.key)).toEqual(["input", "cached", "output", "reasoning"]);
    expect(segs[0]?.share).toBeCloseTo(0.5);
    expect(segs.reduce((acc, s) => acc + s.share, 0)).toBeCloseTo(1);
  });
  it("returns zero shares when everything is zero", () => {
    const segs = costStructureSegments({ input: 0, cached: 0, output: 0, reasoning: 0 });
    expect(segs.every((s) => s.share === 0)).toBe(true);
  });
  it("builds share segments with entity colors", () => {
    const colors = assignSlots(["x", "y"]);
    const segs = shareSegments(
      [
        { key: "y", value: 1 },
        { key: "x", value: 3 },
      ],
      colors,
    );
    expect(segs[0]).toEqual({ key: "x", label: "x", value: 3, share: 0.75, color: CATEGORICAL[0] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/chart-data.test.ts`
Expected: FAIL with `Failed to resolve import "./chart-data"`.

- [ ] **Step 3: Implement `web/src/lib/chart-data.ts`**

```ts
import { OTHER_KEY } from "@shared/constants";
import type { CostByKind, TrendsResult } from "@convex/lib/types";
import { CATEGORICAL, OTHER_COLOR, colorFor, type ColorMap } from "./colors";
import { formatDayShort, formatMonth } from "./format";

export type SeriesDef = { key: string; label: string; color: string; entity: string };
export type ChartRow = { x: string; label: string } & Record<string, number | string>;
export type Peak = { x: string; label: string; total: number } | null;
export type Stacked = { rows: ChartRow[]; series: SeriesDef[]; peak: Peak; total: number };
export type Segment = { key: string; label: string; value: number; share: number; color: string };

export function bucketLabel(bucket: string, granularity: "day" | "week" | "month"): string {
  return granularity === "month" ? formatMonth(bucket) : formatDayShort(bucket);
}

function sumByEntity(
  points: TrendsResult["points"],
  pick: (p: TrendsResult["points"][number]) => { key: string; value: number }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const p of points) {
    for (const { key, value } of pick(p)) totals.set(key, (totals.get(key) ?? 0) + value);
  }
  return totals;
}

function sortedEntities(totals: Map<string, number>): string[] {
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key]) => key);
}

function assemble(
  trends: TrendsResult,
  entities: string[],
  labelOf: (entity: string) => string,
  colorOf: (entity: string) => string,
  valueOf: (p: TrendsResult["points"][number], entity: string) => number,
  otherEntities: string[] = [],
): Stacked {
  const series: SeriesDef[] = entities.map((entity, i) => ({
    key: `s${i}`,
    label: labelOf(entity),
    color: colorOf(entity),
    entity,
  }));
  if (otherEntities.length > 0) {
    series.push({ key: "other", label: "Other", color: OTHER_COLOR, entity: OTHER_KEY });
  }
  let peak: Peak = null;
  let total = 0;
  const rows: ChartRow[] = [];
  for (const p of trends.points) {
    const row: ChartRow = { x: p.bucket, label: bucketLabel(p.bucket, trends.bucket) };
    let rowTotal = 0;
    entities.forEach((entity, i) => {
      const v = valueOf(p, entity);
      row[`s${i}`] = v;
      rowTotal += v;
    });
    if (otherEntities.length > 0) {
      const other = otherEntities.reduce((acc, e) => acc + valueOf(p, e), 0);
      row.other = other;
      rowTotal += other;
    }
    total += rowTotal;
    if (rowTotal > 0 && (peak === null || rowTotal > peak.total)) {
      peak = { x: p.bucket, label: row.label, total: rowTotal };
    }
    rows.push(row);
  }
  return { rows, series, peak, total };
}

export function trendByUser(trends: TrendsResult, colors: ColorMap): Stacked {
  const totals = sumByEntity(trends.points, (p) => p.byUser.map((u) => ({ key: u.key, value: u.tokens })));
  const names = new Map(trends.users.map((u) => [u.userId as string, u.name]));
  return assemble(
    trends,
    sortedEntities(totals),
    (id) => names.get(id) ?? id,
    (id) => colorFor(colors, id),
    (p, id) => p.byUser.find((u) => u.key === id)?.tokens ?? 0,
  );
}

export function trendByModel(trends: TrendsResult, colors: ColorMap, topN = 7): Stacked {
  const totals = sumByEntity(trends.points, (p) => p.byModel.map((m) => ({ key: m.key, value: m.tokens })));
  const ordered = sortedEntities(totals);
  const top = ordered.length > topN + 1 ? ordered.slice(0, topN) : ordered;
  const rest = ordered.slice(top.length);
  return assemble(
    trends,
    top,
    (m) => m,
    (m) => colorFor(colors, m),
    (p, m) => p.byModel.find((x) => x.key === m)?.tokens ?? 0,
    rest,
  );
}

export type TrendMetric = "tokens" | "cost" | "hours";

export function trendSingle(trends: TrendsResult, metric: TrendMetric, color: string): Stacked {
  const label = metric === "tokens" ? "Tokens" : metric === "cost" ? "Cost" : "Hours";
  return assemble(trends, ["total"], () => label, () => color, (p) => {
    if (metric === "tokens") return p.total;
    if (metric === "cost") return p.costUsd;
    return p.activeMs / 3_600_000;
  });
}

export function foldTopN<T extends { key: string; value: number }>(
  items: T[],
  n: number,
  otherKey = OTHER_KEY,
): { key: string; value: number }[] {
  const sorted = [...items].sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1));
  if (sorted.length <= n) return sorted.map(({ key, value }) => ({ key, value }));
  const head = sorted.slice(0, n).map(({ key, value }) => ({ key, value }));
  const tail = sorted.slice(n).reduce((acc, item) => acc + item.value, 0);
  return [...head, { key: otherKey, value: tail }];
}

const COST_KINDS: { key: keyof CostByKind; label: string; color: string }[] = [
  { key: "input", label: "Input", color: CATEGORICAL[1] },
  { key: "cached", label: "Cached input", color: CATEGORICAL[0] },
  { key: "output", label: "Output", color: CATEGORICAL[2] },
  { key: "reasoning", label: "Reasoning", color: CATEGORICAL[6] },
];

export function costStructureSegments(cost: CostByKind): Segment[] {
  const total = COST_KINDS.reduce((acc, k) => acc + cost[k.key], 0);
  return COST_KINDS.map((k) => ({
    key: k.key,
    label: k.label,
    value: cost[k.key],
    share: total > 0 ? cost[k.key] / total : 0,
    color: k.color,
  }));
}

export function shareSegments(items: { key: string; value: number }[], colors: ColorMap, topN = 8): Segment[] {
  const folded = foldTopN(items, topN);
  const total = folded.reduce((acc, i) => acc + i.value, 0);
  return folded.map((i) => ({
    key: i.key,
    label: i.key === OTHER_KEY ? "Other" : i.key,
    value: i.value,
    share: total > 0 ? i.value / total : 0,
    color: i.key === OTHER_KEY ? OTHER_COLOR : colorFor(colors, i.key),
  }));
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run --project unit src/lib/chart-data.test.ts`
Expected: PASS (`trendByModel` with 9 models yields 7 named series plus `other`; with ≤ 8 models no fold happens because `ordered.length > topN + 1` is false).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/chart-data.ts web/src/lib/chart-data.test.ts
git commit -m "$(cat <<'MSG'
Add chart data transforms with slot keys, peak and top-N folding

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 9: `lib/heatmap.ts` — activity grid (weeks × 7) and heat levels

**Files:**
- Create: `web/src/lib/heatmap.ts`
- Test: `web/src/lib/heatmap.test.ts`

**Interfaces:**
- Consumes: `@shared/days` (`addDays`, `compareDays`, `weekStart`), `ActivityHeatmapResult` from `@convex/lib/types`; month labels use a local `MONTHS` table.
- Produces: `type ActivityCell = { day: string; level: 0|1|2|3|4; tokens: number; sessions: number; costUsd: number; inRange: boolean }`, `type ActivityGrid = { weeks: ActivityCell[][]; monthLabels: { column: number; label: string }[]; from: string; to: string }`, `ACTIVITY_THRESHOLDS`, `activityLevel(tokens)`, `buildActivityGrid(from, to, days)`, `heatLevel(value, max)`, `WEEKDAY_LABELS`, `hourLabel(h)`.

- [ ] **Step 1: Write the failing tests `web/src/lib/heatmap.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { activityLevel, buildActivityGrid, heatLevel, hourLabel, WEEKDAY_LABELS } from "./heatmap";

describe("activityLevel", () => {
  it.each([
    [0, 0],
    [1, 1],
    [9_999_999, 1],
    [10_000_000, 2],
    [99_999_999, 2],
    [100_000_000, 3],
    [999_999_999, 3],
    [1_000_000_000, 4],
  ])("%s → level %s", (tokens, level) => {
    expect(activityLevel(tokens)).toBe(level);
  });
});

describe("buildActivityGrid", () => {
  const day = (d: string, tokens: number) => ({ day: d, tokens, sessions: 1, costUsd: 0 });
  it("aligns weeks to Monday and pads out-of-range cells", () => {
    // 2026-08-05 is a Wednesday, 2026-08-16 a Sunday.
    const grid = buildActivityGrid("2026-08-05", "2026-08-16", [day("2026-08-05", 5), day("2026-08-10", 20_000_000)]);
    expect(grid.weeks).toHaveLength(2);
    expect(grid.weeks[0]?.map((c) => c.inRange)).toEqual([false, false, true, true, true, true, true]);
    expect(grid.weeks[0]?.[2]).toMatchObject({ day: "2026-08-05", level: 1, tokens: 5 });
    expect(grid.weeks[1]?.[0]).toMatchObject({ day: "2026-08-10", level: 2 });
    expect(grid.weeks[1]?.[6]).toMatchObject({ day: "2026-08-16", level: 0, inRange: true });
    expect(grid.monthLabels).toEqual([{ column: 0, label: "Aug" }]);
  });
  it("labels the column that contains the first day of each month", () => {
    const grid = buildActivityGrid("2026-08-24", "2026-09-13", []);
    expect(grid.weeks).toHaveLength(3);
    expect(grid.monthLabels).toEqual([
      { column: 0, label: "Aug" },
      { column: 1, label: "Sep" },
    ]);
  });
});

describe("heatLevel", () => {
  it("quantises into 5 steps with zero reserved", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(25, 100)).toBe(1);
    expect(heatLevel(26, 100)).toBe(2);
    expect(heatLevel(100, 100)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
  });
  it("labels", () => {
    expect(WEEKDAY_LABELS).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(hourLabel(0)).toBe("00");
    expect(hourLabel(13)).toBe("13");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/heatmap.test.ts`
Expected: FAIL with `Failed to resolve import "./heatmap"`.

- [ ] **Step 3: Implement `web/src/lib/heatmap.ts`**

```ts
import { addDays, compareDays, weekStart } from "@shared/days";
import type { ActivityHeatmapResult } from "@convex/lib/types";

export type HeatLevel = 0 | 1 | 2 | 3 | 4;
export type ActivityDay = ActivityHeatmapResult["days"][number];
export type ActivityCell = {
  day: string;
  level: HeatLevel;
  tokens: number;
  sessions: number;
  costUsd: number;
  inRange: boolean;
};
export type ActivityGrid = {
  weeks: ActivityCell[][];
  monthLabels: { column: number; label: string }[];
  from: string;
  to: string;
};

export const ACTIVITY_THRESHOLDS = [10_000_000, 100_000_000, 1_000_000_000] as const;
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function activityLevel(tokens: number): HeatLevel {
  if (tokens <= 0) return 0;
  if (tokens < ACTIVITY_THRESHOLDS[0]) return 1;
  if (tokens < ACTIVITY_THRESHOLDS[1]) return 2;
  if (tokens < ACTIVITY_THRESHOLDS[2]) return 3;
  return 4;
}

export function buildActivityGrid(from: string, to: string, days: ActivityDay[]): ActivityGrid {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const weeks: ActivityCell[][] = [];
  const monthLabels: { column: number; label: string }[] = [];
  let cursor = weekStart(from);
  let column = 0;
  while (compareDays(cursor, to) <= 0) {
    const week: ActivityCell[] = [];
    let labelled = false;
    for (let i = 0; i < 7; i++) {
      const day = addDays(cursor, i);
      const inRange = compareDays(day, from) >= 0 && compareDays(day, to) <= 0;
      const data = inRange ? byDay.get(day) : undefined;
      const tokens = data?.tokens ?? 0;
      week.push({
        day,
        level: inRange ? activityLevel(tokens) : 0,
        tokens,
        sessions: data?.sessions ?? 0,
        costUsd: data?.costUsd ?? 0,
        inRange,
      });
      if (!labelled && inRange && (column === 0 || day.endsWith("-01"))) {
        monthLabels.push({ column, label: MONTHS[Number(day.slice(5, 7)) - 1]! });
        labelled = true;
      }
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
    column += 1;
  }
  return { weeks, monthLabels, from, to };
}

export function heatLevel(value: number, max: number): HeatLevel {
  if (value <= 0 || max <= 0) return 0;
  const level = Math.ceil((value / max) * 4);
  return Math.min(4, Math.max(1, level)) as HeatLevel;
}

export function hourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run --project unit src/lib/heatmap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/heatmap.ts web/src/lib/heatmap.test.ts
git commit -m "$(cat <<'MSG'
Add activity heatmap grid builder and heat level quantisation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 10: `lib/install.ts` — collector install commands and Codex version checks

**Files:**
- Create: `web/src/lib/install.ts`
- Test: `web/src/lib/install.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type InstallOs = "macos" | "linux" | "windows"`, `INSTALL_OS`, `tgzUrl(origin)`, `installCommands(origin, token?)`, `installSteps(os, origin, token?)`, `TESTED_CODEX_VERSION`, `compareVersions(a, b)`, `isNewerThanTested(version)`.

- [ ] **Step 1: Write the failing tests `web/src/lib/install.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { compareVersions, installCommands, installSteps, isNewerThanTested, tgzUrl } from "./install";

const origin = "https://codex-kaboo.vercel.app";

describe("install strings", () => {
  it("builds the four commands from the origin", () => {
    expect(tgzUrl(origin)).toBe("https://codex-kaboo.vercel.app/cli/codex-kaboo-cli.tgz");
    const c = installCommands(origin);
    expect(c.install).toBe("npm install -g https://codex-kaboo.vercel.app/cli/codex-kaboo-cli.tgz");
    expect(c.installNpm12).toBe(
      "npm install -g --allow-remote=all https://codex-kaboo.vercel.app/cli/codex-kaboo-cli.tgz",
    );
    expect(c.login).toBe("codex-kaboo login --token <token>");
    expect(installCommands(origin, "ck_abc").login).toBe("codex-kaboo login --token ck_abc");
    expect(c.schedule).toBe("codex-kaboo install");
    expect(c.status).toBe("codex-kaboo status");
  });
  it("lists per-OS steps with the same commands and OS-specific notes", () => {
    const mac = installSteps("macos", origin);
    expect(mac.map((s) => s.command)).toEqual([
      "npm install -g https://codex-kaboo.vercel.app/cli/codex-kaboo-cli.tgz",
      "codex-kaboo login --token <token>",
      "codex-kaboo install",
      "codex-kaboo status",
    ]);
    expect(installSteps("windows", origin)[0]?.note).toContain("%AppData%\\npm");
    expect(installSteps("linux", origin)[0]?.note).toContain("EACCES");
    expect(installSteps("macos", origin)[2]?.note).toContain("launchd");
  });
});

describe("versions", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("0.151.0", "0.150.1")).toBe(1);
    expect(compareVersions("0.150.1", "0.150.1")).toBe(0);
    expect(compareVersions("0.9.0", "0.150.1")).toBe(-1);
    expect(compareVersions("0.150.1-beta.1", "0.150.1")).toBe(0);
  });
  it("flags Codex versions newer than the tested one", () => {
    expect(isNewerThanTested("0.150.1")).toBe(false);
    expect(isNewerThanTested("0.152.0")).toBe(true);
    expect(isNewerThanTested(null)).toBe(false);
    expect(isNewerThanTested("garbage")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/install.test.ts`
Expected: FAIL with `Failed to resolve import "./install"`.

- [ ] **Step 3: Implement `web/src/lib/install.ts`**

```ts
export type InstallOs = "macos" | "linux" | "windows";
export const INSTALL_OS: { id: InstallOs; label: string }[] = [
  { id: "macos", label: "macOS" },
  { id: "linux", label: "Linux" },
  { id: "windows", label: "Windows" },
];

export const TESTED_CODEX_VERSION = "0.150.1";

export function tgzUrl(origin: string): string {
  return `${origin}/cli/codex-kaboo-cli.tgz`;
}

export function installCommands(origin: string, token?: string) {
  const url = tgzUrl(origin);
  return {
    install: `npm install -g ${url}`,
    installNpm12: `npm install -g --allow-remote=all ${url}`,
    login: `codex-kaboo login --token ${token ?? "<token>"}`,
    schedule: "codex-kaboo install",
    status: "codex-kaboo status",
  };
}

export type InstallStep = { title: string; command: string; note?: string };

const INSTALL_NOTES: Record<InstallOs, string> = {
  macos: "Needs Node 18+ (22+ recommended). With npm 12 or newer add --allow-remote=all.",
  linux:
    "Needs Node 18+. If you get EACCES with a system Node, use nvm/fnm or `npm config set prefix ~/.npm-global` and add it to PATH. With npm 12 or newer add --allow-remote=all.",
  windows:
    "Needs Node 18+. Make sure %AppData%\\npm is on PATH and, in PowerShell, that the execution policy allows npm scripts (`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`). With npm 12 or newer add --allow-remote=all.",
};

const SCHEDULE_NOTES: Record<InstallOs, string> = {
  macos: "Registers a launchd agent (com.codex-kaboo.sync) that syncs every 15 minutes and runs one sync now.",
  linux: "Adds a crontab block that syncs every 15 minutes (use `codex-kaboo install --systemd` for a user timer instead) and runs one sync now.",
  windows: "Creates the scheduled task codex-kaboo-sync (every 15 minutes, hidden window) and runs one sync now.",
};

export function installSteps(os: InstallOs, origin: string, token?: string): InstallStep[] {
  const c = installCommands(origin, token);
  return [
    { title: "Install the collector", command: c.install, note: INSTALL_NOTES[os] },
    { title: "Log in with your sync token", command: c.login, note: "Create a token on the Settings page. Only metadata is uploaded, never prompts, commands or file paths." },
    { title: "Schedule background sync", command: c.schedule, note: SCHEDULE_NOTES[os] },
    { title: "Check the status", command: c.status, note: "Shows the resolved Codex home, the last sync result and whether the schedule is healthy." },
  ];
}

function parseVersion(v: string): number[] | null {
  const core = v.trim().split("-")[0] ?? "";
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split(".").map(Number);
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function isNewerThanTested(version: string | null): boolean {
  if (version === null || parseVersion(version) === null) return false;
  return compareVersions(version, TESTED_CODEX_VERSION) === 1;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run --project unit src/lib/install.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/install.ts web/src/lib/install.test.ts
git commit -m "$(cat <<'MSG'
Add collector install command strings and Codex version checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 11: Hooks — `useToday`, `useNow`, `useRange`, `useStableQuery`, entity colors

**Files:**
- Create: `web/src/hooks/use-today.ts`, `web/src/hooks/use-now.ts`, `web/src/hooks/use-range.ts`, `web/src/hooks/use-stable-query.ts`, `web/src/hooks/use-entity-colors.ts`, `web/src/hooks/use-async-action.ts`
- Test: `web/src/hooks/use-today.test.ts`, `web/src/hooks/use-stable-query.test.tsx`, `web/src/hooks/use-async-action.test.tsx`

**Interfaces:**
- Consumes: `resolveRange`/`isCustom`/`RangeParams`/`ResolvedRange`/`Preset` (Task 4), `rangeParsers`/`rangeHref` (Task 5), `userColorMap`/`modelColorMap`/`ColorMap` (Task 6), Convex `api.stats.bounds`, `api.users.list`, `api.prices.list`.
- Produces: `localDay(date: Date): string`; `useToday(): string | null`; `useNow(): number | null`; `useRange(): { params: RangeParams; resolved: ResolvedRange | null; today: string | null; setPreset(preset: Preset): void; setCustom(from: string, to: string): void }`; `useRangeHref(): (pathname: string) => string`; `useStableQuery(query, args): { data, isStale }`; `useUserColors(): ColorMap`; `useModelColors(seenModels: readonly string[]): ColorMap`; `useAsyncAction<TArgs extends unknown[]>(fn: (...args: TArgs) => Promise<unknown>): { run: (...args: TArgs) => Promise<void>; pending: boolean; error: string | null; reset: () => void }` — the single wrapper every mutation/action call site uses so failures are rendered, never swallowed.

- [ ] **Step 1: Write the failing tests**

`web/src/hooks/use-today.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { localDay } from "./use-today";

describe("localDay", () => {
  it("formats a local Date as YYYY-MM-DD with zero padding", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDay(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});
```

`web/src/hooks/use-stable-query.test.tsx`:
```tsx
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));

import { useStableQuery } from "./use-stable-query";

describe("useStableQuery", () => {
  it("keeps the previous data while new args are loading", () => {
    const query = {} as never;
    useQueryMock.mockReturnValueOnce(undefined);
    const { result, rerender } = renderHook(({ args }) => useStableQuery(query, args), {
      initialProps: { args: { from: "a" } as never },
    });
    expect(result.current).toEqual({ data: undefined, isStale: false });

    useQueryMock.mockReturnValue({ value: 1 });
    rerender({ args: { from: "a" } as never });
    expect(result.current).toEqual({ data: { value: 1 }, isStale: false });

    useQueryMock.mockReturnValue(undefined);
    rerender({ args: { from: "b" } as never });
    expect(result.current).toEqual({ data: { value: 1 }, isStale: true });

    useQueryMock.mockReturnValue({ value: 2 });
    rerender({ args: { from: "b" } as never });
    expect(result.current).toEqual({ data: { value: 2 }, isStale: false });
  });
});
```

`web/src/hooks/use-async-action.test.tsx`:
```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAsyncAction } from "./use-async-action";

describe("useAsyncAction", () => {
  it("toggles pending and stores the message of a rejected call", async () => {
    let reject: ((reason: unknown) => void) | undefined;
    const fn = () =>
      new Promise<void>((_resolve, r) => {
        reject = r;
      });
    const { result } = renderHook(() => useAsyncAction(fn));
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();

    act(() => {
      void result.current.run();
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      reject?.(new Error("revoke failed"));
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe("revoke failed");

    act(() => {
      result.current.reset();
    });
    expect(result.current.error).toBeNull();
  });

  it("stringifies a non-Error rejection and clears the error on a later success", async () => {
    let fail = true;
    const { result } = renderHook(() =>
      useAsyncAction(() => (fail ? Promise.reject("nope") : Promise.resolve())),
    );
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toBe("nope");

    fail = false;
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project unit src/hooks/use-today.test.ts && npx vitest run --project dom src/hooks/use-stable-query.test.tsx src/hooks/use-async-action.test.tsx`
Expected: both FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement the hooks**

`web/src/hooks/use-today.ts`:
```ts
"use client";

import { useSyncExternalStore } from "react";

export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const listeners = new Set<() => void>();
let current: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  const next = localDay(new Date());
  if (next !== current) {
    current = next;
    listeners.forEach((l) => l());
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) timer = setInterval(tick, 60_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): string {
  if (current === null) current = localDay(new Date());
  return current;
}

/** The viewer's local calendar day; `null` during server render and hydration. */
export function useToday(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
```

`web/src/hooks/use-now.ts`:
```ts
"use client";

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let now: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const STEP_MS = 30_000;

function tick() {
  now = Math.floor(Date.now() / STEP_MS) * STEP_MS;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) timer = setInterval(tick, STEP_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  if (now === null) now = Math.floor(Date.now() / STEP_MS) * STEP_MS;
  return now;
}

/** Wall clock rounded to 30 s, for "3 min ago" labels; `null` during server render. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
```

`web/src/hooks/use-stable-query.ts`:
```ts
"use client";

import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { useState } from "react";

/** `useQuery` that keeps the last data while the arguments change, so range switches dim instead of flashing. */
export function useStableQuery<Q extends FunctionReference<"query">>(
  query: Q,
  args: OptionalRestArgsOrSkip<Q>[0],
): { data: FunctionReturnType<Q> | undefined; isStale: boolean } {
  const result = useQuery(query, ...([args] as OptionalRestArgsOrSkip<Q>));
  const [previous, setPrevious] = useState<FunctionReturnType<Q> | undefined>(undefined);
  if (result !== undefined && result !== previous) {
    setPrevious(result);
  }
  if (result !== undefined) return { data: result, isStale: false };
  return { data: previous, isStale: previous !== undefined };
}
```

`web/src/hooks/use-range.ts`:
```ts
"use client";

import { useQuery } from "convex/react";
import { useQueryStates } from "nuqs";
import { useCallback, useMemo } from "react";
import { api } from "@convex/_generated/api";
import { isCustom, resolveRange, type Preset, type RangeParams, type ResolvedRange } from "@/lib/range";
import { rangeHref, rangeParsers } from "@/lib/search-params";
import { useToday } from "./use-today";

export function useRange(): {
  params: RangeParams;
  resolved: ResolvedRange | null;
  today: string | null;
  setPreset: (preset: Preset) => void;
  setCustom: (from: string, to: string) => void;
} {
  const [params, setParams] = useQueryStates(rangeParsers);
  const today = useToday();
  // Exactly the inverse of `resolveRange`'s ALL branch: a half-filled custom range
  // (`?range=ALL&from=<day>` with no `to`) must still fetch bounds, or the page never resolves.
  const needBounds = !isCustom(params) && params.range === "ALL" && today !== null;
  const bounds = useQuery(api.stats.bounds, needBounds ? {} : "skip");
  const resolved = useMemo(
    () => (today === null ? null : resolveRange(params, today, needBounds ? (bounds ?? null) : undefined)),
    [params, today, needBounds, bounds],
  );
  const setPreset = useCallback(
    (preset: Preset) => {
      void setParams({ range: preset, from: null, to: null });
    },
    [setParams],
  );
  const setCustom = useCallback(
    (from: string, to: string) => {
      void setParams({ range: null, from, to });
    },
    [setParams],
  );
  return { params, resolved, today, setPreset, setCustom };
}

/** Builds hrefs that keep the current range and drop page-local params. */
export function useRangeHref(): (pathname: string) => string {
  const [params] = useQueryStates(rangeParsers);
  return useCallback((pathname: string) => rangeHref(pathname, params), [params]);
}
```

`web/src/hooks/use-entity-colors.ts`:
```ts
"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "@convex/_generated/api";
import { modelColorMap, userColorMap, type ColorMap } from "@/lib/colors";

const EMPTY: ColorMap = new Map();

/** Stable user → color slots from the full user list (never from the filtered leaderboard). */
export function useUserColors(): ColorMap {
  const users = useQuery(api.users.list, {});
  return useMemo(() => (users ? userColorMap(users.map((u) => u.userId as string)) : EMPTY), [users]);
}

/** Stable model → color slots from the price registry plus models seen in the current view. */
export function useModelColors(seenModels: readonly string[]): ColorMap {
  const prices = useQuery(api.prices.list, {});
  const seenKey = seenModels.join(" ");
  return useMemo(
    () => modelColorMap(prices ? prices.map((p) => p.model) : [], seenKey === "" ? [] : seenKey.split(" ")),
    [prices, seenKey],
  );
}
```

`web/src/hooks/use-async-action.ts`:
```ts
"use client";

import { useCallback, useState } from "react";

export type AsyncAction<TArgs extends unknown[]> = {
  /** Runs `fn`; never rejects — a failure lands in `error` instead. */
  run: (...args: TArgs) => Promise<void>;
  pending: boolean;
  error: string | null;
  reset: () => void;
};

/**
 * Wraps a Convex mutation/action (or any promise-returning call) so the UI can render its
 * failure. Put success side effects inside `fn` — they only run when `fn` resolves.
 */
export function useAsyncAction<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<unknown>,
): AsyncAction<TArgs> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs) => {
      setPending(true);
      setError(null);
      try {
        await fn(...args);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [fn],
  );

  const reset = useCallback(() => setError(null), []);

  return { run, pending, error, reset };
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `cd web && npx vitest run --project unit src/hooks/use-today.test.ts && npx vitest run --project dom src/hooks/use-stable-query.test.tsx src/hooks/use-async-action.test.tsx && cd .. && npm run typecheck -w web`
Expected: all three test files PASS; typecheck exits 0. If `OptionalRestArgsOrSkip` is not exported by the installed `convex/react`, type the second parameter as `args: FunctionArgs<Q> | "skip"` (import `FunctionArgs` from `convex/server`) and call `useQuery(query, args as never)`; the behaviour and the test stay the same.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks
git commit -m "$(cat <<'MSG'
Add client-only clock, range, stable query, async action and entity color hooks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 12: Primitives A — `Num`, `DeltaPill`, `StatCard`, `SectionCard`, `EmptyState`, `InfoTooltip`, `AvatarName`

**Files:**
- Create: `web/src/components/primitives/num.tsx`, `delta-pill.tsx`, `stat-card.tsx`, `section-card.tsx`, `empty-state.tsx`, `inline-error.tsx`, `info-tooltip.tsx`, `avatar-name.tsx`
- Modify: `web/src/components/layout/app-gate.tsx` (render the `users.ensure` failure through `<EmptyState>`)
- Test: `web/src/components/primitives/stat-card.test.tsx`

**Interfaces:**
- Consumes: `formatMetricValue`, `deltaTone`, `MetricKind`, `GoodDirection` (Task 7), `formatDeltaPercent` (Task 3), shadcn `Card`, `Tooltip`, `Badge`, `Button`.
- Produces: `<Num value kind className? />`; `<DeltaPill change goodDirection previousLabel? />` (a `goodDirection` of `"neutral"` renders gray with the direction arrow and no better/worse verdict); `<StatCard label value kind? change? goodDirection? help? badge? footer? size? />` (`value` may be a `number | null` with `kind`, or a `ReactNode`); `<SectionCard title description? help? actions? children />`; `<EmptyState title description? action? />`; `<InlineError message className? />` (12 px red line with `role="alert"`, `null` message renders nothing); `<InfoTooltip text />`; `<AvatarName name imageUrl color? size? hideName? />`.

- [ ] **Step 1: Write the failing test `web/src/components/primitives/stat-card.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeltaPill } from "./delta-pill";
import { InlineError } from "./inline-error";
import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("renders label, formatted value and a positive delta pill", () => {
    render(<StatCard label="Total tokens" value={1_234_567} kind="tokens" change={0.25} goodDirection="up" />);
    expect(screen.getByText("Total tokens")).toBeInTheDocument();
    expect(screen.getByText("1.2M")).toBeInTheDocument();
    const pill = screen.getByLabelText("+25.0% vs previous period, better");
    expect(pill).toHaveAttribute("data-tone", "up");
    expect(pill).toHaveAttribute("data-good", "true");
  });
  it("hides the delta when change is null and shows an em dash for null values", () => {
    render(<StatCard label="Cache hit rate" value={null} kind="percent" change={null} goodDirection="up" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/vs previous/)).not.toBeInTheDocument();
  });
});

describe("DeltaPill", () => {
  it("marks a drop in a lower-is-better metric as good", () => {
    render(<DeltaPill change={-0.1} goodDirection="down" />);
    const pill = screen.getByLabelText("−10.0% vs previous period, better");
    expect(pill).toHaveAttribute("data-tone", "down");
    expect(pill).toHaveAttribute("data-good", "true");
  });
  it("renders a flat pill for zero", () => {
    render(<DeltaPill change={0} goodDirection="up" />);
    expect(screen.getByLabelText("0.0% vs previous period")).toHaveAttribute("data-tone", "flat");
  });
  it("keeps the arrow but passes no verdict for a neutral metric", () => {
    render(<DeltaPill change={0.2} goodDirection="neutral" />);
    const pill = screen.getByLabelText("+20.0% vs previous period");
    expect(pill).toHaveAttribute("data-tone", "up");
    expect(pill).not.toHaveAttribute("data-good");
    expect(pill).toHaveClass("bg-[#f3f4f6]", "text-[#4b5563]");
  });
});

describe("InlineError", () => {
  it("renders the message as an alert", () => {
    render(<InlineError message="Network request failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Network request failed");
  });
  it("renders nothing when there is no message", () => {
    const { container } = render(<InlineError message={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project dom src/components/primitives/stat-card.test.tsx`
Expected: FAIL with `Failed to resolve import "./delta-pill"`.

- [ ] **Step 3: Implement the primitives**

`web/src/components/primitives/num.tsx`:
```tsx
import { formatMetricValue, type MetricKind } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export function Num({ value, kind, className }: { value: number | null; kind: MetricKind; className?: string }) {
  return <span className={cn("tabular", className)}>{formatMetricValue(kind, value)}</span>;
}
```

`web/src/components/primitives/delta-pill.tsx`:
```tsx
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatDeltaPercent } from "@/lib/format";
import { deltaTone, type GoodDirection } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export function DeltaPill({
  change,
  goodDirection,
  previousLabel = "vs previous period",
}: {
  change: number | null;
  goodDirection: GoodDirection;
  previousLabel?: string;
}) {
  if (change === null) return null;
  const { tone, good } = deltaTone(change, goodDirection);
  const text = formatDeltaPercent(change);
  const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : Minus;
  const label = `${text} ${previousLabel}${good === null ? "" : good ? ", better" : ", worse"}`;
  return (
    <span
      aria-label={label}
      title={label}
      data-tone={tone}
      data-good={good === null ? undefined : String(good)}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular",
        good === true && "bg-delta-up-bg text-delta-up-fg",
        good === false && "bg-delta-down-bg text-delta-down-fg",
        // Neutral metrics (goodDirection "neutral") and flat changes: gray, arrow unchanged.
        good === null && "bg-[#f3f4f6] text-[#4b5563]",
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {text}
    </span>
  );
}
```

`web/src/components/primitives/info-tooltip.tsx`:
```tsx
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="How to read this data">
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
```

`web/src/components/primitives/stat-card.tsx`:
```tsx
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMetricValue, type GoodDirection, type MetricKind } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { DeltaPill } from "./delta-pill";
import { InfoTooltip } from "./info-tooltip";

type StatCardProps = {
  label: string;
  value: number | null | ReactNode;
  kind?: MetricKind;
  change?: number | null;
  goodDirection?: GoodDirection;
  help?: string;
  badge?: string;
  footer?: ReactNode;
  size?: "md" | "sm";
  className?: string;
};

export function StatCard({
  label,
  value,
  kind = "count",
  change = null,
  goodDirection = "up",
  help,
  badge,
  footer,
  size = "md",
  className,
}: StatCardProps) {
  const rendered = typeof value === "number" || value === null ? formatMetricValue(kind, value) : value;
  return (
    <Card className={cn("gap-1 rounded-xl border-border p-4 shadow-none", className)}>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>{label}</span>
        {help ? <InfoTooltip text={help} /> : null}
        {badge ? (
          <Badge variant="outline" className="ml-auto rounded-full text-[10px] font-medium">
            {badge}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={cn("font-semibold leading-none", size === "md" ? "text-2xl" : "text-lg")}>{rendered}</span>
        <DeltaPill change={change} goodDirection={goodDirection} />
      </div>
      {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}
```

`web/src/components/primitives/section-card.tsx`:
```tsx
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./info-tooltip";

export function SectionCard({
  title,
  description,
  help,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  help?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("gap-3 rounded-xl border-border p-4 shadow-none", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            {title}
            {help ? <InfoTooltip text={help} /> : null}
          </h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}
```

`web/src/components/primitives/empty-state.tsx`:
```tsx
import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-xs text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}
```

`web/src/components/primitives/inline-error.tsx`:
```tsx
import { cn } from "@/lib/utils";

/** One red 12 px line for a failed mutation/action; renders nothing when there is no error. */
export function InlineError({ message, className }: { message: string | null; className?: string }) {
  if (message === null) return null;
  return (
    <p role="alert" className={cn("text-xs text-destructive", className)}>
      {message}
    </p>
  );
}
```

`web/src/components/primitives/avatar-name.tsx`:
```tsx
/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function AvatarName({
  name,
  imageUrl,
  color,
  size = "sm",
  hideName = false,
}: {
  name: string;
  imageUrl: string | null;
  color?: string;
  size?: "sm" | "lg";
  hideName?: boolean;
}) {
  const dim = size === "lg" ? "size-12 text-base" : "size-6 text-[10px]";
  const ring = color ? { boxShadow: `0 0 0 2px ${color}` } : undefined;
  return (
    <span className="inline-flex items-center gap-2">
      {imageUrl ? (
        <img src={imageUrl} alt="" className={cn("rounded-full object-cover", dim)} style={ring} />
      ) : (
        <span
          className={cn("inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground", dim)}
          style={ring}
          aria-hidden="true"
        >
          {initials(name) || "?"}
        </span>
      )}
      {hideName ? <span className="sr-only">{name}</span> : <span className="truncate text-sm">{name}</span>}
    </span>
  );
}
```

- [ ] **Step 4: Point `AppGate`'s error branch at `EmptyState`**

In `web/src/components/layout/app-gate.tsx`, replace the placeholder error markup written in Task 2
(the `<div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed …">`
block and its comment) with the primitive, and add `import { EmptyState } from "@/components/primitives/empty-state";`:
```tsx
  if (error !== null) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        <EmptyState
          title="Could not load your account"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }
```

- [ ] **Step 5: Run the test, typecheck and lint**

Run: `cd web && npx vitest run --project dom src/components/primitives/stat-card.test.tsx && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS (6 tests); typecheck and lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/primitives web/src/components/layout/app-gate.tsx
git commit -m "$(cat <<'MSG'
Add stat card, delta pill and layout primitives

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 13: Primitives B — `SegmentedControl`, `DataTable` + `BarCell`, `Podium`, `RankMovement`, `SectionErrorBoundary`, `CopyBox`

**Files:**
- Create: `web/src/components/primitives/segmented-control.tsx`, `data-table.tsx`, `bar-cell.tsx`, `podium.tsx`, `rank-movement.tsx`, `section-error-boundary.tsx`, `copy-box.tsx`
- Test: `web/src/components/primitives/data-table.test.tsx`, `web/src/components/primitives/segmented-control.test.tsx`

**Interfaces:**
- Consumes: shadcn `ToggleGroup`, `Table`, `Button`; `AvatarName`, `EmptyState` and `InlineError` (Task 12); `useAsyncAction` (Task 11).
- Produces: `<SegmentedControl options value onChange ariaLabel size? className? />`; `type Column<T> = { key: string; header: string; align?: "left" | "right"; render: (row: T) => ReactNode; bar?: (row: T) => number; width?: string }`; `<DataTable columns rows rowKey scale? emptyLabel? onRowClick? barColor? />`; `<BarCell value max scale color?>{children}</BarCell>`; `barWidth(value, max, scale): number` (0–1); `<Podium entries />` with `entries: { rank: 1 | 2 | 3; name: string; imageUrl: string | null; color: string; value: string; sub?: string; href?: string }[]`; `<RankMovement rank previousRank />`; `<SectionErrorBoundary title?>` (class component); `<CopyBox value label? />`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/primitives/data-table.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { barWidth } from "./bar-cell";
import { DataTable, type Column } from "./data-table";

type Row = { id: string; name: string; tokens: number };
const rows: Row[] = [
  { id: "a", name: "Ada", tokens: 1000 },
  { id: "b", name: "Bob", tokens: 10 },
];
const columns: Column<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "tokens", header: "Tokens", align: "right", render: (r) => String(r.tokens), bar: (r) => r.tokens },
];

describe("barWidth", () => {
  it("is linear by default and log10(v+1) when asked", () => {
    expect(barWidth(10, 1000, "linear")).toBeCloseTo(0.01);
    expect(barWidth(10, 1000, "log")).toBeCloseTo(Math.log10(11) / Math.log10(1001));
    expect(barWidth(0, 0, "linear")).toBe(0);
    expect(barWidth(5, 1000, "linear")).toBeCloseTo(0.005);
  });
});

describe("DataTable", () => {
  it("renders headers, rows and bar widths", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} scale="linear" />);
    expect(screen.getByRole("columnheader", { name: "Tokens" })).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    const bars = screen.getAllByTestId("bar-fill");
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "1%" });
  });
  it("shows the empty label when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyLabel="No data in this range" />);
    expect(screen.getByText("No data in this range")).toBeInTheDocument();
  });
});
```

`web/src/components/primitives/segmented-control.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const options = [
  { value: "volume", label: "Volume" },
  { value: "efficiency", label: "Efficiency" },
];

describe("SegmentedControl", () => {
  it("calls onChange with the clicked value", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="View" options={options} value="volume" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Efficiency" }));
    expect(onChange).toHaveBeenCalledWith("efficiency");
  });
  it("never empties: clicking the selected option keeps it selected", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="View" options={options} value="volume" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Volume" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Volume" })).toHaveAttribute("aria-checked", "true");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project dom src/components/primitives/data-table.test.tsx src/components/primitives/segmented-control.test.tsx`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement the components**

`web/src/components/primitives/segmented-control.tsx`:
```tsx
"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "sm",
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      aria-label={ariaLabel}
      size={size}
      className={cn("rounded-lg border border-border bg-muted p-0.5", className)}
      onValueChange={(next) => {
        // Radix emits "" when the active item is clicked again; a segmented control is never empty.
        if (next && next !== value) onChange(next as T);
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-none"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
```

`web/src/components/primitives/bar-cell.tsx`:
```tsx
import type { ReactNode } from "react";

export type BarScale = "linear" | "log";

export function barWidth(value: number, max: number, scale: BarScale): number {
  if (max <= 0 || value <= 0) return 0;
  if (scale === "log") return Math.min(1, Math.log10(value + 1) / Math.log10(max + 1));
  return Math.min(1, value / max);
}

export function BarCell({
  value,
  max,
  scale,
  color = "var(--primary)",
  children,
}: {
  value: number;
  max: number;
  scale: BarScale;
  color?: string;
  children: ReactNode;
}) {
  const pct = Math.round(barWidth(value, max, scale) * 10000) / 100;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
        <div data-testid="bar-fill" className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="tabular">{children}</span>
    </div>
  );
}
```

`web/src/components/primitives/data-table.tsx`:
```tsx
import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { BarCell, type BarScale } from "./bar-cell";

export type Column<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  bar?: (row: T) => number;
  width?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  scale = "linear",
  emptyLabel = "No data in this range",
  onRowClick,
  barColor,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  scale?: BarScale;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
  barColor?: (row: T) => string;
}) {
  const maxima = new Map<string, number>();
  for (const c of columns) {
    const bar = c.bar;
    if (bar) maxima.set(c.key, rows.reduce((m, r) => Math.max(m, bar(r)), 0));
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cn("text-xs", c.align === "right" && "text-right")}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && "cursor-pointer")}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn("text-sm", c.align === "right" && "text-right font-mono tabular")}>
                    {c.bar ? (
                      <BarCell value={c.bar(row)} max={maxima.get(c.key) ?? 0} scale={scale} color={barColor?.(row)}>
                        {c.render(row)}
                      </BarCell>
                    ) : (
                      c.render(row)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

`web/src/components/primitives/rank-movement.tsx`:
```tsx
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function RankMovement({ rank, previousRank }: { rank: number; previousRank: number | null }) {
  if (previousRank === null) {
    return <span className="text-xs text-muted-foreground">new</span>;
  }
  const delta = previousRank - rank;
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" aria-label="No rank change">
        <Minus className="size-3" aria-hidden="true" />
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular", up ? "text-delta-up-fg" : "text-delta-down-fg")}
      aria-label={up ? `Up ${delta} places` : `Down ${-delta} places`}
    >
      {up ? <ArrowUp className="size-3" aria-hidden="true" /> : <ArrowDown className="size-3" aria-hidden="true" />}
      {Math.abs(delta)}
    </span>
  );
}
```

`web/src/components/primitives/podium.tsx`:
```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AvatarName } from "./avatar-name";

export type PodiumEntry = {
  rank: 1 | 2 | 3;
  name: string;
  imageUrl: string | null;
  color: string;
  value: string;
  sub?: string;
  href?: string;
};

const HEIGHT: Record<1 | 2 | 3, string> = { 1: "h-24", 2: "h-16", 3: "h-12" };

export function Podium({ entries }: { entries: PodiumEntry[] }) {
  const byRank = new Map(entries.map((e) => [e.rank, e]));
  const order: (1 | 2 | 3)[] = [2, 1, 3];
  return (
    <div className="grid grid-cols-3 items-end gap-3">
      {order.map((rank) => {
        const e = byRank.get(rank);
        if (!e) return <div key={rank} />;
        const body = (
          <div className="flex flex-col items-center gap-2">
            <AvatarName name={e.name} imageUrl={e.imageUrl} color={e.color} size="lg" hideName />
            <span className="max-w-full truncate text-sm font-medium">{e.name}</span>
            <span className="text-lg font-semibold">{e.value}</span>
            {e.sub ? <span className="text-xs text-muted-foreground">{e.sub}</span> : null}
            <div
              className={cn(
                "flex w-full items-start justify-center rounded-t-lg bg-accent pt-2 text-sm font-semibold text-accent-foreground",
                HEIGHT[rank],
              )}
            >
              #{rank}
            </div>
          </div>
        );
        return e.href ? (
          <Link key={rank} href={e.href} className="block rounded-lg hover:bg-muted/50">
            {body}
          </Link>
        ) : (
          <div key={rank}>{body}</div>
        );
      })}
    </div>
  );
}
```

`web/src/components/primitives/section-error-boundary.tsx`:
```tsx
"use client";

import { ConvexError } from "convex/values";
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

type Props = { title?: string; children: ReactNode };
type State = { error: Error | null };

function describeError(error: Error): string {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string } | string;
    const code = typeof data === "string" ? data : data.code;
    if (code === "bad_range") return "The selected range is invalid.";
    if (code === "unauthenticated" || code === "user_not_registered") return "Your session expired. Reload the page.";
    if (code === "forbidden") return "You are not allowed to do that.";
    return `Request failed (${code ?? "unknown"}).`;
  }
  return error.message || "Something went wrong.";
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("section error", error);
  }

  render() {
    if (this.state.error) {
      return (
        <EmptyState
          title={this.props.title ?? "This section could not load"}
          description={describeError(this.state.error)}
          action={
            <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
              Retry
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
```

`web/src/components/primitives/copy-box.tsx`:
```tsx
"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAsyncAction } from "@/hooks/use-async-action";
import { InlineError } from "./inline-error";

export function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  // `writeText` rejects in an insecure context or when the permission is denied — show that.
  const copy = useAsyncAction(async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  });
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="flex flex-col gap-1">
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs">{value}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={copied ? "Copied" : "Copy"}
          onClick={() => void copy.run()}
        >
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
        </Button>
      </div>
      <InlineError message={copy.error} />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `cd web && npx vitest run --project dom src/components/primitives && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: all dom tests PASS; typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/primitives
git commit -m "$(cat <<'MSG'
Add segmented control, data table with bars, podium and error boundary primitives

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 14: `RangePicker` — preset rows plus a calendar range, driven by nuqs

**Files:**
- Create: `web/src/components/layout/range-picker.tsx`
- Test: `web/src/components/layout/range-picker.test.tsx`

**Interfaces:**
- Consumes: `useRange` (Task 11), `localDay` (Task 11), `PRESETS`/`presetLabel`/`isCustom` (Task 4), `formatDay` (Task 3), shadcn `Popover`, `Calendar`, `Button`.
- Produces: `<RangePicker />` (no props; reads and writes the `range`/`from`/`to` search params).

- [ ] **Step 1: Check which module the shadcn Calendar imports `DayPicker` from**

Run: `grep -n "from \"react-day-picker\"\|from \"@daypicker/react\"" web/src/components/ui/calendar.tsx`
Expected: one import line. Use that same module name for the `DateRange` type import below (the code below assumes `react-day-picker`; if the grep prints `@daypicker/react`, import `DateRange` from there instead).

- [ ] **Step 2: Write the failing test `web/src/components/layout/range-picker.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { withNuqsTestingAdapter, type OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/hooks/use-today", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-today")>()),
  useToday: () => "2026-09-15",
}));

import { RangePicker } from "./range-picker";

describe("RangePicker", () => {
  it("shows the current preset and pushes ?range=7D when a preset row is clicked", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    render(<RangePicker />, { wrapper: withNuqsTestingAdapter({ searchParams: "?range=30D", onUrlUpdate }) });
    const trigger = screen.getByRole("button", { name: /Change date range/ });
    expect(trigger).toHaveTextContent("Last 30 days");
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("option", { name: /Last 7 days/ }));
    expect(onUrlUpdate).toHaveBeenCalledOnce();
    const event = onUrlUpdate.mock.calls[0]![0]!;
    expect(event.queryString).toBe("?range=7D");
    expect(event.options.history).toBe("push");
  });

  it("writes from/to for a custom range and drops the preset", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    render(<RangePicker />, { wrapper: withNuqsTestingAdapter({ searchParams: "?range=30D", onUrlUpdate }) });
    await userEvent.click(screen.getByRole("button", { name: /Change date range/ }));
    await userEvent.click(screen.getByRole("button", { name: /September 3(rd)?, 2026/ }));
    await userEvent.click(screen.getByRole("button", { name: /September 10(th)?, 2026/ }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    const event = onUrlUpdate.mock.calls.at(-1)![0]!;
    expect(event.searchParams.get("from")).toBe("2026-09-03");
    expect(event.searchParams.get("to")).toBe("2026-09-10");
    expect(event.searchParams.get("range")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run --project dom src/components/layout/range-picker.test.tsx`
Expected: FAIL with `Failed to resolve import "./range-picker"`.

- [ ] **Step 4: Implement `web/src/components/layout/range-picker.tsx`**

```tsx
"use client";

import { CalendarIcon, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRange } from "@/hooks/use-range";
import { localDay } from "@/hooks/use-today";
import { formatDay } from "@/lib/format";
import { PRESETS, isCustom, presetLabel, type Preset } from "@/lib/range";
import { cn } from "@/lib/utils";

function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function RangePicker() {
  const { params, resolved, today, setPreset, setCustom } = useRange();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const custom = isCustom(params);
  const label = resolved?.label ?? (custom ? "Custom range" : presetLabel(params.range));
  const todayDate = today ? dayToDate(today) : undefined;
  const canApply = draft?.from !== undefined && draft?.to !== undefined;

  const choosePreset = (preset: Preset) => {
    setPreset(preset);
    setOpen(false);
  };

  const apply = () => {
    if (!draft?.from || !draft.to) return;
    setCustom(localDay(draft.from), localDay(draft.to));
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDraft(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full font-medium" aria-label="Change date range">
          <CalendarIcon className="size-3.5" aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex">
          <ul role="listbox" aria-label="Presets" className="w-44 border-r border-border p-1">
            {PRESETS.map((preset) => {
              const selected = !custom && params.range === preset;
              return (
                <li key={preset}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => choosePreset(preset)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                      selected && "font-semibold",
                    )}
                  >
                    {presetLabel(preset)}
                    {selected ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-2 p-2">
            <p className="px-1 text-xs font-medium text-muted-foreground">Custom range (up to 400 days)</p>
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={todayDate}
              disabled={todayDate ? { after: todayDate } : undefined}
            />
            <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">
                {draft?.from ? formatDay(localDay(draft.from)) : "Pick a start day"}
                {draft?.to ? ` – ${formatDay(localDay(draft.to))}` : ""}
              </span>
              <Button size="sm" disabled={!canApply} onClick={apply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Run the test, typecheck and lint**

Run: `cd web && npx vitest run --project dom src/components/layout/range-picker.test.tsx && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS (2 tests); typecheck and lint exit 0. If the day-button accessible names differ in the installed react-day-picker (check with `screen.logTestingPlaygroundURL()` or `screen.debug()`), adjust only the two regexes in the test to the printed label format.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/layout/range-picker.tsx web/src/components/layout/range-picker.test.tsx
git commit -m "$(cat <<'MSG'
Add the range picker with preset rows and a custom calendar range

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 15: `TopNav`, `UserMenu`, `PageHeader` and the app layout wiring

**Files:**
- Create: `web/src/components/layout/top-nav.tsx`, `web/src/components/layout/user-menu.tsx`, `web/src/components/layout/page-header.tsx`
- Modify: `web/src/app/(app)/layout.tsx`
- Create: `web/src/app/(app)/settings/page.tsx` (placeholder, replaced in Task 28)
- Test: `web/src/components/layout/top-nav.test.tsx`

**Interfaces:**
- Consumes: `useRangeHref` (Task 11), `useCurrentUserId` (Task 2), `RangePicker` (Task 14), Clerk `UserButton`.
- Produces: `<TopNav />`, `<TopNavFallback />`, `<UserMenu />`, `<PageHeader title description? actions? />`.

- [ ] **Step 1: Create `web/src/components/layout/user-menu.tsx`**

```tsx
"use client";

import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";

export function UserMenu() {
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link label="Settings" labelIcon={<Settings className="size-4" />} href="/settings" />
        <UserButton.Action label="manageAccount" />
        <UserButton.Action label="signOut" />
      </UserButton.MenuItems>
    </UserButton>
  );
}
```

- [ ] **Step 2: Create `web/src/components/layout/top-nav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRangeHref } from "@/hooks/use-range";
import { cn } from "@/lib/utils";
import { useCurrentUserId } from "./current-user";
import { RangePicker } from "./range-picker";
import { UserMenu } from "./user-menu";

export function TopNav() {
  const pathname = usePathname();
  const userId = useCurrentUserId();
  const href = useRangeHref();
  const myPage = `/users/${userId}`;
  const links = [
    { label: "Insights", href: href("/"), active: pathname === "/" },
    { label: "My Page", href: href(myPage), active: pathname === myPage },
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 md:px-6">
        <Link href={href("/")} className="flex items-center gap-2 text-sm font-semibold">
          <span className="inline-block size-2.5 rounded-full bg-primary" aria-hidden="true" />
          codex-kaboo
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              aria-current={l.active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                l.active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <RangePicker />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

export function TopNavFallback() {
  return <header className="h-14 border-b border-border bg-card" aria-hidden="true" />;
}
```

- [ ] **Step 3: Create `web/src/components/layout/page-header.tsx`**

```tsx
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Replace `web/src/app/(app)/layout.tsx`**

```tsx
import { Suspense, type ReactNode } from "react";
import { AppGate } from "@/components/layout/app-gate";
import { TopNav, TopNavFallback } from "@/components/layout/top-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppGate>
      <Suspense fallback={<TopNavFallback />}>
        <TopNav />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
    </AppGate>
  );
}
```

- [ ] **Step 5: Create the placeholder `web/src/app/(app)/settings/page.tsx`**

```tsx
import { PageHeader } from "@/components/layout/page-header";

export default function SettingsPage() {
  return <PageHeader title="Settings" description="Sync tokens, collector install, machines and model prices." />;
}
```

- [ ] **Step 6: Write and run `web/src/components/layout/top-nav.test.tsx`**

The range-preserving hrefs are the one non-obvious behaviour here, so they get a dom test. `next/link`,
the range picker and the Clerk-backed user menu are stubbed; only the href building and the active
state are under test.
```tsx
import { render, screen } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("./current-user", () => ({ useCurrentUserId: () => "u1" as Id<"users"> }));
vi.mock("./range-picker", () => ({ RangePicker: () => <div data-testid="range-picker" /> }));
vi.mock("./user-menu", () => ({ UserMenu: () => <div data-testid="user-menu" /> }));

import { TopNav } from "./top-nav";

describe("TopNav", () => {
  it("carries the selected range on every link and marks the active one", () => {
    render(<TopNav />, { wrapper: withNuqsTestingAdapter({ searchParams: "?range=7D" }) });
    const insights = screen.getByRole("link", { name: "Insights" });
    const myPage = screen.getByRole("link", { name: "My Page" });
    expect(insights).toHaveAttribute("href", "/?range=7D");
    expect(myPage).toHaveAttribute("href", "/users/u1?range=7D");
    expect(insights).toHaveAttribute("aria-current", "page");
    expect(myPage).not.toHaveAttribute("aria-current");
  });
});
```

Run: `cd web && npx vitest run --project dom src/components/layout/top-nav.test.tsx && cd ..`
Expected: PASS (1 test).

- [ ] **Step 7: Typecheck, lint and check in the browser**

Run: `npm run typecheck -w web && npm run lint -w web`
Expected: both exit 0.
Then with `npm run dev -w web` running, open `http://localhost:3000/?range=7D`: the nav shows the green dot logo, `Insights` highlighted, `My Page`, the range pill reading `Last 7 days`, and the Clerk avatar. Click `My Page`: the URL becomes `/users/<id>?range=7D` (range survives, page content is the 404 from Next until Task 26 — acceptable). Open the avatar menu: `Settings` navigates to `/settings` and shows the placeholder header. Open the range pill, choose `Today`: the URL becomes `?range=1D`.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/layout/top-nav.tsx web/src/components/layout/top-nav.test.tsx web/src/components/layout/user-menu.tsx web/src/components/layout/page-header.tsx "web/src/app/(app)/layout.tsx" "web/src/app/(app)/settings/page.tsx"
git commit -m "$(cat <<'MSG'
Add the top navigation with range picker and user menu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 16: Charts A — `ChartCard`, `ChartLegend`, `SeriesTooltip`, `TrendChart`, `StackedBarChart`

**Files:**
- Create: `web/src/components/charts/series-tooltip.tsx`, `web/src/components/charts/chart-legend.tsx`, `web/src/components/charts/chart-card.tsx`, `web/src/components/charts/trend-chart.tsx`
- Test: `web/src/components/charts/chart-card.test.tsx` (table view only; Recharts is never mounted in jsdom)

**Interfaces:**
- Consumes: `Stacked`, `SeriesDef`, `ChartRow` (Task 8); `SectionCard`, `SegmentedControl`, `DataTable`, `EmptyState` (Tasks 12–13); shadcn `ChartContainer`, `ChartConfig`, `Badge`; Recharts 3 (`ComposedChart`, `Area`, `Bar`, `Line`, `CartesianGrid`, `XAxis`, `YAxis`, `Tooltip`, `TooltipContentProps`).
- Produces: `<SeriesTooltip series format />` (Recharts `content` element); `<ChartLegend series />`; `<ChartCard title stacked format description? help? actions? showPeak? children />` (Chart | Table toggle, peak pill); `<TrendChart stacked format variant? height? />` with `variant: "area" | "bars" | "both"` (default `"area"`); `<StackedBarChart stacked format height? />` = bars variant.

- [ ] **Step 1: Write the failing test `web/src/components/charts/chart-card.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Stacked } from "@/lib/chart-data";
import { formatCompact } from "@/lib/format";
import { ChartCard } from "./chart-card";

const stacked: Stacked = {
  series: [
    { key: "s0", label: "Ada", color: "#008300", entity: "u1" },
    { key: "s1", label: "Bob", color: "#2a78d6", entity: "u2" },
  ],
  rows: [
    { x: "2026-09-01", label: "Sep 1", s0: 1000, s1: 500 },
    { x: "2026-09-02", label: "Sep 2", s0: 2000, s1: 0 },
  ],
  peak: { x: "2026-09-02", label: "Sep 2", total: 2000 },
  total: 3500,
};

describe("ChartCard", () => {
  it("shows the peak pill and switches to a table of the same rows", async () => {
    render(
      <ChartCard title="Token usage trend" stacked={stacked} format={formatCompact}>
        <div data-testid="chart" />
      </ChartCard>,
    );
    expect(screen.getByText(/Peak 2K/)).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Table" }));
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Ada" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeInTheDocument();
    expect(screen.getByText("1.5K")).toBeInTheDocument();
  });
  it("renders an empty state when there are no rows", () => {
    render(
      <ChartCard title="Empty" stacked={{ ...stacked, rows: [], peak: null, total: 0 }} format={formatCompact}>
        <div data-testid="chart" />
      </ChartCard>,
    );
    expect(screen.getByText("No data in this range")).toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project dom src/components/charts/chart-card.test.tsx`
Expected: FAIL with `Failed to resolve import "./chart-card"`.

- [ ] **Step 3: Implement the chart components**

`web/src/components/charts/series-tooltip.tsx`:
```tsx
"use client";

import type { TooltipContentProps } from "recharts";
import type { SeriesDef } from "@/lib/chart-data";

type Props = Partial<TooltipContentProps<number, string>> & {
  series: SeriesDef[];
  format: (value: number) => string;
};

/** Custom Recharts tooltip: every series at the hovered X, sorted by value, plus a total. */
export function SeriesTooltip({ active, payload, label, series, format }: Props) {
  if (!active || !payload || payload.length === 0) return null;
  const byKey = new Map(series.map((s) => [s.key, s]));
  const rows = payload
    .map((p) => ({ key: String(p.dataKey), value: typeof p.value === "number" ? p.value : 0, def: byKey.get(String(p.dataKey)) }))
    .filter((r): r is { key: string; value: number; def: SeriesDef } => r.def !== undefined)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((acc, r) => acc + r.value, 0);
  return (
    <div className="min-w-40 rounded-md border border-border bg-popover px-3 py-2 text-xs">
      <p className="mb-1 font-medium">{label}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: r.def.color }} aria-hidden="true" />
            <span className="text-muted-foreground">{r.def.label}</span>
            <span className="ml-auto font-medium tabular">{format(r.value)}</span>
          </li>
        ))}
      </ul>
      {rows.length > 1 ? (
        <p className="mt-1 flex justify-between border-t border-border pt-1 font-medium">
          <span>Total</span>
          <span className="tabular">{format(total)}</span>
        </p>
      ) : null}
    </div>
  );
}
```

`web/src/components/charts/chart-legend.tsx`:
```tsx
import type { SeriesDef } from "@/lib/chart-data";

/** HTML legend (never inside the SVG). Rendered only for two or more series. */
export function ChartLegend({ series, shape = "rect" }: { series: SeriesDef[]; shape?: "rect" | "line" }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            className={shape === "rect" ? "inline-block size-2.5 rounded-sm" : "inline-block h-0.5 w-3 rounded-full"}
            style={{ backgroundColor: s.color }}
            aria-hidden="true"
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
```

`web/src/components/charts/chart-card.tsx`:
```tsx
"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { SectionCard } from "@/components/primitives/section-card";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import type { ChartRow, Stacked } from "@/lib/chart-data";
import { ChartLegend } from "./chart-legend";

const MODES = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
] as const;

function rowTotal(row: ChartRow, keys: string[]): number {
  return keys.reduce((acc, k) => acc + Number(row[k] ?? 0), 0);
}

export function ChartCard({
  title,
  description,
  help,
  actions,
  stacked,
  format,
  showPeak = true,
  legendShape = "rect",
  children,
}: {
  title: string;
  description?: string;
  help?: string;
  actions?: ReactNode;
  stacked: Stacked;
  format: (value: number) => string;
  showPeak?: boolean;
  legendShape?: "rect" | "line";
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"chart" | "table">("chart");
  const keys = stacked.series.map((s) => s.key);
  const columns: Column<ChartRow>[] = [
    { key: "x", header: "Period", render: (r) => r.label },
    ...stacked.series.map(
      (s): Column<ChartRow> => ({ key: s.key, header: s.label, align: "right", render: (r) => format(Number(r[s.key] ?? 0)) }),
    ),
    { key: "total", header: "Total", align: "right", render: (r) => format(rowTotal(r, keys)) },
  ];
  return (
    <SectionCard
      title={title}
      description={description}
      help={help}
      actions={
        <>
          {showPeak && stacked.peak ? (
            <Badge variant="outline" className="rounded-full font-normal">
              Peak {format(stacked.peak.total)} · {stacked.peak.label}
            </Badge>
          ) : null}
          {actions}
          <SegmentedControl ariaLabel="Display" options={MODES} value={mode} onChange={setMode} />
        </>
      }
      bodyClassName="flex flex-col gap-3"
    >
      {stacked.rows.length === 0 ? (
        <EmptyState title="No data in this range" />
      ) : mode === "chart" ? (
        <>
          {children}
          <ChartLegend series={stacked.series} shape={legendShape} />
        </>
      ) : (
        <DataTable columns={columns} rows={stacked.rows} rowKey={(r) => r.x} />
      )}
    </SectionCard>
  );
}
```

`web/src/components/charts/trend-chart.tsx`:
```tsx
"use client";

import { Area, Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type { Stacked } from "@/lib/chart-data";
import { SeriesTooltip } from "./series-tooltip";

export type TrendVariant = "area" | "bars" | "both";
const TOTAL_KEY = "__t";

export function TrendChart({
  stacked,
  format,
  variant = "area",
  height = 260,
}: {
  stacked: Stacked;
  format: (value: number) => string;
  variant?: TrendVariant;
  height?: number;
}) {
  const config = Object.fromEntries(stacked.series.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig;
  const rows =
    variant === "both"
      ? stacked.rows.map((r) => ({ ...r, [TOTAL_KEY]: stacked.series.reduce((acc, s) => acc + Number(r[s.key] ?? 0), 0) }))
      : stacked.rows;
  const last = stacked.series.length - 1;
  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke="var(--grid-line)" strokeWidth={1} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} fontSize={11} />
        <YAxis width="auto" tickLine={false} axisLine={false} tickFormatter={format} fontSize={11} />
        {variant === "area"
          ? stacked.series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId="a"
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.12}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
            ))
          : stacked.series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="a"
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={1}
                maxBarSize={24}
                radius={i === last ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
        {variant === "both" ? (
          <Line
            type="monotone"
            dataKey={TOTAL_KEY}
            stroke="var(--foreground)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            isAnimationActive={false}
            name="Total"
          />
        ) : null}
        <Tooltip
          cursor={{ stroke: "var(--border)", fill: "var(--muted)", fillOpacity: 0.4 }}
          content={<SeriesTooltip series={stacked.series} format={format} />}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

export function StackedBarChart(props: { stacked: Stacked; format: (value: number) => string; height?: number }) {
  return <TrendChart {...props} variant="bars" />;
}
```

- [ ] **Step 4: Run the test, typecheck and lint**

Run: `cd web && npx vitest run --project dom src/components/charts/chart-card.test.tsx && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS (2 tests); typecheck and lint exit 0. If `TooltipContentProps` is not exported from the `recharts` root in the installed version, import it as `import type { TooltipContentProps } from "recharts/types/component/Tooltip";`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/charts
git commit -m "$(cat <<'MSG'
Add chart card with table view, legend, tooltip and the trend chart

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 17: Charts B — `StackedShareBar` and `QuotaGauge`

**Files:**
- Create: `web/src/components/charts/stacked-share-bar.tsx`, `web/src/components/charts/quota-gauge.tsx`
- Test: `web/src/components/charts/stacked-share-bar.test.tsx`, `web/src/components/charts/quota-gauge.test.tsx`

**Interfaces:**
- Consumes: `Segment` (Task 8), `quotaColor` (Task 6), `formatPercent` (Task 3).
- Produces: `<StackedShareBar segments format showLegend? />`; `<QuotaGauge usedPercent />`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/charts/stacked-share-bar.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatUsd } from "@/lib/format";
import { StackedShareBar } from "./stacked-share-bar";

describe("StackedShareBar", () => {
  it("renders one segment per non-zero item with its share width and a legend row", () => {
    render(
      <StackedShareBar
        format={formatUsd}
        segments={[
          { key: "input", label: "Input", value: 7.5, share: 0.75, color: "#2a78d6" },
          { key: "output", label: "Output", value: 2.5, share: 0.25, color: "#eb6834" },
          { key: "reasoning", label: "Reasoning", value: 0, share: 0, color: "#4a3aa7" },
        ]}
      />,
    );
    const segments = screen.getAllByTestId("share-segment");
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveStyle({ width: "75%" });
    expect(screen.getByLabelText("Input: $7.50 (75.0%)")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});
```

`web/src/components/charts/quota-gauge.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuotaGauge } from "./quota-gauge";

describe("QuotaGauge", () => {
  it("labels the value and colors the arc by threshold", () => {
    const { container } = render(<QuotaGauge usedPercent={42.4} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="gauge-fill"]')).toHaveAttribute("stroke", "#0ca30c");
    expect(screen.getByRole("img", { name: "Weekly quota used: 42%" })).toBeInTheDocument();
  });
  it("turns red at 85% and caps the arc at 100", () => {
    const { container } = render(<QuotaGauge usedPercent={130} />);
    const fill = container.querySelector('[data-testid="gauge-fill"]');
    expect(fill).toHaveAttribute("stroke", "#d03b3b");
    expect(fill).toHaveAttribute("stroke-dasharray", "100 100");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run --project dom src/components/charts/stacked-share-bar.test.tsx src/components/charts/quota-gauge.test.tsx`
Expected: FAIL with `Failed to resolve import`.

- [ ] **Step 3: Implement the components**

`web/src/components/charts/stacked-share-bar.tsx`:
```tsx
import type { Segment } from "@/lib/chart-data";
import { formatPercent } from "@/lib/format";

/** A 100 % horizontal bar with 2 px surface gaps, plus a legend row per segment (never a pie). */
export function StackedShareBar({
  segments,
  format,
  showLegend = true,
}: {
  segments: Segment[];
  format: (value: number) => string;
  showLegend?: boolean;
}) {
  const visible = segments.filter((s) => s.share > 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-sm bg-muted" role="list" aria-label="Share">
        {visible.map((s) => (
          <div
            key={s.key}
            role="listitem"
            data-testid="share-segment"
            aria-label={`${s.label}: ${format(s.value)} (${formatPercent(s.share)})`}
            title={`${s.label}: ${format(s.value)} (${formatPercent(s.share)})`}
            className="h-full min-w-0.5 rounded-[2px]"
            style={{ width: `${s.share * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      {showLegend ? (
        <ul className="grid gap-1 text-xs sm:grid-cols-2">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden="true" />
              <span className="truncate text-muted-foreground">{s.label}</span>
              <span className="ml-auto font-medium tabular">{format(s.value)}</span>
              <span className="w-12 text-right text-muted-foreground tabular">{formatPercent(s.share)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

`web/src/components/charts/quota-gauge.tsx`:
```tsx
import { quotaColor } from "@/lib/colors";

/** 180° arc meter: green < 60 %, amber 60–85 %, red ≥ 85 %, always with a text label. */
export function QuotaGauge({ usedPercent }: { usedPercent: number }) {
  const clamped = Math.max(0, Math.min(100, usedPercent));
  const label = `${Math.round(clamped)}%`;
  const color = quotaColor(usedPercent);
  return (
    <div className="flex flex-col items-center" role="img" aria-label={`Weekly quota used: ${label}`}>
      <svg viewBox="0 0 200 110" className="w-full max-w-56" aria-hidden="true">
        <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke="var(--muted)" strokeWidth={14} strokeLinecap="round" />
        <path
          data-testid="gauge-fill"
          d="M 15 100 A 85 85 0 0 1 185 100"
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${clamped} 100`}
        />
      </svg>
      <div className="-mt-10 text-center">
        <div className="text-3xl font-semibold leading-none">{label}</div>
        <div className="text-xs text-muted-foreground">of weekly quota used</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `cd web && npx vitest run --project dom src/components/charts && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS; typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/charts/stacked-share-bar.tsx web/src/components/charts/stacked-share-bar.test.tsx web/src/components/charts/quota-gauge.tsx web/src/components/charts/quota-gauge.test.tsx
git commit -m "$(cat <<'MSG'
Add the stacked share bar and the quota gauge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 18: Charts C — `ActivityHeatmap`, `DayHourHeatmap` and the shared cell tooltip

**Files:**
- Create: `web/src/components/charts/cell-tooltip.tsx`, `web/src/components/charts/activity-heatmap.tsx`, `web/src/components/charts/day-hour-heatmap.tsx`
- Test: `web/src/components/charts/heatmaps.test.tsx`

**Interfaces:**
- Consumes: `ActivityGrid`, `heatLevel`, `WEEKDAY_LABELS`, `hourLabel`, `ACTIVITY_THRESHOLDS` (Task 9); `heatColor` (Task 6); `formatCompact`, `formatUsd`, `formatDay` (Task 3).
- Produces: `useCellTooltip()` → `{ tip, show(event, content), hide }` and `<CellTooltip tip />`; `<ActivityHeatmap grid />`; `<DayHourHeatmap grid format />` (`grid: number[][]` 7 × 24).

- [ ] **Step 1: Write the failing test `web/src/components/charts/heatmaps.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildActivityGrid } from "@/lib/heatmap";
import { formatCompact } from "@/lib/format";
import { ActivityHeatmap } from "./activity-heatmap";
import { DayHourHeatmap } from "./day-hour-heatmap";

describe("ActivityHeatmap", () => {
  it("renders one cell per in-range day with an accessible label and heat color", () => {
    const grid = buildActivityGrid("2026-08-03", "2026-08-16", [
      { day: "2026-08-04", tokens: 25_000_000, sessions: 2, costUsd: 1.5 },
    ]);
    render(<ActivityHeatmap grid={grid} />);
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(14);
    const cell = screen.getByLabelText("Aug 4, 2026: 25M tokens, 2 sessions, $1.50");
    expect(cell).toHaveStyle({ backgroundColor: "#2f9f55" });
    expect(screen.getByText("Aug")).toBeInTheDocument();
  });
});

describe("DayHourHeatmap", () => {
  it("renders 7 × 24 cells and colors the maximum with the darkest step", () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    grid[0]![14] = 1_000_000;
    grid[4]![9] = 250_000;
    render(<DayHourHeatmap grid={grid} format={formatCompact} />);
    expect(screen.getAllByRole("gridcell")).toHaveLength(168);
    expect(screen.getByLabelText("Mon 14:00: 1M tokens")).toHaveStyle({ backgroundColor: "#0d532b" });
    expect(screen.getByLabelText("Fri 09:00: 250K tokens")).toHaveStyle({ backgroundColor: "#6cc482" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project dom src/components/charts/heatmaps.test.tsx`
Expected: FAIL with `Failed to resolve import "./activity-heatmap"`.

- [ ] **Step 3: Implement the shared tooltip and the heatmaps**

`web/src/components/charts/cell-tooltip.tsx`:
```tsx
"use client";

import { useCallback, useState, type ReactNode, type SyntheticEvent } from "react";

export type CellTip = { content: ReactNode; x: number; y: number } | null;

/** One positioned tooltip shared by every cell of a heatmap (hover and keyboard focus). */
export function useCellTooltip() {
  const [tip, setTip] = useState<CellTip>(null);
  const show = useCallback((event: SyntheticEvent<HTMLElement>, content: ReactNode) => {
    const target = event.currentTarget;
    const container = target.closest("[data-heatmap]") as HTMLElement | null;
    const rect = target.getBoundingClientRect();
    const base = container?.getBoundingClientRect() ?? { left: 0, top: 0 };
    setTip({ content, x: rect.left - base.left + rect.width / 2, y: rect.top - base.top });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function CellTooltip({ tip }: { tip: CellTip }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap"
      style={{ left: tip.x, top: tip.y - 6 }}
    >
      {tip.content}
    </div>
  );
}
```

`web/src/components/charts/activity-heatmap.tsx`:
```tsx
"use client";

import { heatColor } from "@/lib/colors";
import { formatCompact, formatDay, formatUsd } from "@/lib/format";
import { ACTIVITY_THRESHOLDS, WEEKDAY_LABELS, type ActivityCell, type ActivityGrid } from "@/lib/heatmap";
import { CellTooltip, useCellTooltip } from "./cell-tooltip";

function describeCell(c: ActivityCell): string {
  return `${formatDay(c.day)}: ${formatCompact(c.tokens)} tokens, ${c.sessions} sessions, ${formatUsd(c.costUsd)}`;
}

/** GitHub-style weeks × 7 grid with fixed bins (<10M, <100M, <1B, ≥1B tokens). */
export function ActivityHeatmap({ grid }: { grid: ActivityGrid }) {
  const { tip, show, hide } = useCellTooltip();
  const columns = grid.weeks.length;
  return (
    <div className="relative overflow-x-auto" data-heatmap>
      <CellTooltip tip={tip} />
      <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `auto repeat(${columns}, 11px)` }}>
        <div />
        {grid.weeks.map((_, col) => {
          const label = grid.monthLabels.find((m) => m.column === col)?.label;
          return (
            <div key={col} className="h-4 text-[10px] leading-4 text-muted-foreground">
              {label ?? ""}
            </div>
          );
        })}
        {WEEKDAY_LABELS.map((day, row) => (
          <div key={day} className="contents" role="row">
            <div className="pr-1 text-[10px] leading-[11px] text-muted-foreground">{row % 2 === 0 ? day : ""}</div>
            {grid.weeks.map((week, col) => {
              const c = week[row]!;
              if (!c.inRange) return <div key={col} className="size-[11px]" aria-hidden="true" />;
              const text = describeCell(c);
              return (
                <button
                  key={col}
                  type="button"
                  role="gridcell"
                  aria-label={text}
                  className="size-[11px] rounded-[2px] outline-offset-1"
                  style={{ backgroundColor: heatColor(c.level) }}
                  onMouseEnter={(e) => show(e, text)}
                  onFocus={(e) => show(e, text)}
                  onMouseLeave={hide}
                  onBlur={hide}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span key={level} className="inline-block size-[11px] rounded-[2px]" style={{ backgroundColor: heatColor(level) }} aria-hidden="true" />
        ))}
        <span>More</span>
        <span className="ml-2">
          bins: &lt;{formatCompact(ACTIVITY_THRESHOLDS[0])}, &lt;{formatCompact(ACTIVITY_THRESHOLDS[1])}, &lt;
          {formatCompact(ACTIVITY_THRESHOLDS[2])}, ≥{formatCompact(ACTIVITY_THRESHOLDS[2])} tokens
        </span>
      </div>
    </div>
  );
}
```

`web/src/components/charts/day-hour-heatmap.tsx`:
```tsx
"use client";

import { heatColor } from "@/lib/colors";
import { WEEKDAY_LABELS, heatLevel, hourLabel } from "@/lib/heatmap";
import { CellTooltip, useCellTooltip } from "./cell-tooltip";

/** Weekday × hour grid (Mon..Sun × 00..23), colored relative to the busiest cell. */
export function DayHourHeatmap({ grid, format }: { grid: number[][]; format: (value: number) => string }) {
  const { tip, show, hide } = useCellTooltip();
  const max = grid.reduce((m, row) => Math.max(m, ...row), 0);
  return (
    <div className="relative overflow-x-auto" data-heatmap>
      <CellTooltip tip={tip} />
      <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: "auto repeat(24, minmax(14px, 1fr))" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center text-[10px] text-muted-foreground">
            {h % 3 === 0 ? hourLabel(h) : ""}
          </div>
        ))}
        {WEEKDAY_LABELS.map((day, row) => (
          <div key={day} className="contents" role="row">
            <div className="pr-1 text-[10px] leading-[14px] text-muted-foreground">{day}</div>
            {Array.from({ length: 24 }, (_, hour) => {
              const value = grid[row]?.[hour] ?? 0;
              const text = `${day} ${hourLabel(hour)}:00: ${format(value)} tokens`;
              return (
                <button
                  key={hour}
                  type="button"
                  role="gridcell"
                  aria-label={text}
                  className="h-[14px] w-full min-w-[14px] rounded-[2px] outline-offset-1"
                  style={{ backgroundColor: heatColor(heatLevel(value, max)) }}
                  onMouseEnter={(e) => show(e, text)}
                  onFocus={(e) => show(e, text)}
                  onMouseLeave={hide}
                  onBlur={hide}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `cd web && npx vitest run --project dom src/components/charts/heatmaps.test.tsx && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS (2 tests); typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/charts/cell-tooltip.tsx web/src/components/charts/activity-heatmap.tsx web/src/components/charts/day-hour-heatmap.tsx web/src/components/charts/heatmaps.test.tsx
git commit -m "$(cat <<'MSG'
Add activity and weekday-hour heatmaps with a shared cell tooltip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 19: Home — overview stat cards, quota card and cost structure card

**Files:**
- Create: `web/src/components/home/metric-stat-card.tsx`, `web/src/components/home/cards-skeleton.tsx`, `web/src/components/home/quota-card.tsx`, `web/src/components/home/cost-structure-card.tsx`, `web/src/components/home/overview-cards.tsx`
- Test: `web/src/components/home/metric-stat-card.test.tsx`

**Interfaces:**
- Consumes: `api.stats.summary` (→ `SummaryResult`), `api.stats.quota` (→ `QuotaResult`); `useStableQuery`, `useNow` (Task 11); `StatCard`, `EmptyState`, `InfoTooltip` (Task 12); `QuotaGauge`, `StackedShareBar` (Task 17); `costStructureSegments` (Task 8); `METRIC_DEFS`, `VOLUME_CARD_KEYS`, `EFFICIENCY_CARD_KEYS` (Task 7); `ResolvedRange` (Task 4); `View` (Task 5).
- Produces: `<MetricStatCard metricKey metric badge? footer? size? />`; `<CardsSkeleton count />`; `<QuotaCard />`; `<CostStructureCard costByKind costUsd cacheSavingsUsd />`; `<OverviewCards range view />`.

- [ ] **Step 1: Write the failing test `web/src/components/home/metric-stat-card.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricStatCard } from "./metric-stat-card";

describe("MetricStatCard", () => {
  it("uses the metric definition for label, formatting and polarity", () => {
    render(<MetricStatCard metricKey="ttftP50Ms" metric={{ current: 1500, previous: 2000, change: -0.25 }} />);
    expect(screen.getByText("TTFT median")).toBeInTheDocument();
    expect(screen.getByText("1s")).toBeInTheDocument();
    expect(screen.getByLabelText("−25.0% vs previous period, better")).toBeInTheDocument();
  });
  it("hides the delta when there is no previous period", () => {
    render(<MetricStatCard metricKey="totalTokens" metric={{ current: 5_000_000, previous: null, change: null }} />);
    expect(screen.getByText("5M")).toBeInTheDocument();
    expect(screen.queryByText(/vs previous/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project dom src/components/home/metric-stat-card.test.tsx`
Expected: FAIL with `Failed to resolve import "./metric-stat-card"`.

- [ ] **Step 3: Implement the components**

`web/src/components/home/metric-stat-card.tsx`:
```tsx
import type { ReactNode } from "react";
import type { Metric, MetricKey } from "@convex/lib/types";
import { StatCard } from "@/components/primitives/stat-card";
import { METRIC_DEFS } from "@/lib/metrics";

export function MetricStatCard({
  metricKey,
  metric,
  badge,
  footer,
  size = "md",
}: {
  metricKey: MetricKey;
  metric: Metric;
  badge?: string;
  footer?: ReactNode;
  size?: "md" | "sm";
}) {
  const def = METRIC_DEFS[metricKey];
  return (
    <StatCard
      label={def.label}
      value={metric.current}
      kind={def.kind}
      change={metric.previous === null ? null : metric.change}
      goodDirection={def.goodDirection}
      help={def.help}
      badge={badge}
      footer={footer}
      size={size}
    />
  );
}
```

`web/src/components/home/cards-skeleton.tsx`:
```tsx
import { Skeleton } from "@/components/ui/skeleton";

export function CardsSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div className={className ?? "grid gap-4 md:grid-cols-2 xl:grid-cols-5"} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}
```

`web/src/components/home/quota-card.tsx`:
```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { QuotaGauge } from "@/components/charts/quota-gauge";
import { EmptyState } from "@/components/primitives/empty-state";
import { InfoTooltip } from "@/components/primitives/info-tooltip";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { formatRelative, formatResetsIn } from "@/lib/format";

const STALE_AFTER_MS = 2 * 3_600_000;

export function QuotaCard() {
  const quota = useQuery(api.stats.quota, {});
  const now = useNow();
  if (quota === undefined) return <Skeleton className="h-28 rounded-xl" />;
  return (
    <Card className="gap-2 rounded-xl border-border p-4 shadow-none">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Shared weekly quota</span>
        <InfoTooltip text="The newest rate-limit snapshot reported by any synced machine (primary window, 7 days). All three accounts share it." />
        {quota && now !== null && now - quota.observedAt > STALE_AFTER_MS ? (
          <Badge className="ml-auto rounded-full bg-status-warning/20 text-foreground">Stale</Badge>
        ) : null}
      </div>
      {quota === null ? (
        <EmptyState title="No quota data yet" description="Appears after the first sync from any machine." />
      ) : (
        <>
          <QuotaGauge usedPercent={quota.usedPercent} />
          <div className="text-xs text-muted-foreground">
            <div>
              {now === null ? "Resets soon" : formatResetsIn(quota.resetsAt, now)} · {quota.planType ?? "unknown plan"}
            </div>
            <div>
              as of {now === null ? "—" : formatRelative(quota.observedAt, now)} · {quota.machine.label} ({quota.user.name})
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
```

`web/src/components/home/cost-structure-card.tsx`:
```tsx
import type { CostByKind } from "@convex/lib/types";
import { StackedShareBar } from "@/components/charts/stacked-share-bar";
import { InfoTooltip } from "@/components/primitives/info-tooltip";
import { Card } from "@/components/ui/card";
import { costStructureSegments } from "@/lib/chart-data";
import { formatUsd } from "@/lib/format";

export function CostStructureCard({
  costByKind,
  costUsd,
  cacheSavingsUsd,
}: {
  costByKind: CostByKind;
  costUsd: number;
  cacheSavingsUsd: number;
}) {
  return (
    <Card className="gap-3 rounded-xl border-border p-4 shadow-none md:col-span-2 xl:col-span-1">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Cost structure</span>
        <InfoTooltip text="Estimated cost split into uncached input, cached input, output and reasoning tokens at API list prices. Reasoning is billed as output." />
        <span className="ml-auto text-sm font-semibold text-foreground">{formatUsd(costUsd)}</span>
      </div>
      <StackedShareBar segments={costStructureSegments(costByKind)} format={formatUsd} />
      <p className="text-xs text-muted-foreground">Cache savings {formatUsd(cacheSavingsUsd)} vs. no caching</p>
    </Card>
  );
}
```

`web/src/components/home/overview-cards.tsx`:
```tsx
"use client";

import { api } from "@convex/_generated/api";
import { useStableQuery } from "@/hooks/use-stable-query";
import { EFFICIENCY_CARD_KEYS, VOLUME_CARD_KEYS } from "@/lib/metrics";
import type { ResolvedRange } from "@/lib/range";
import type { View } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { CardsSkeleton } from "./cards-skeleton";
import { CostStructureCard } from "./cost-structure-card";
import { MetricStatCard } from "./metric-stat-card";
import { QuotaCard } from "./quota-card";

export function OverviewCards({ range, view }: { range: ResolvedRange; view: View }) {
  const { data: summary, isStale } = useStableQuery(api.stats.summary, {
    from: range.from,
    to: range.to,
    previous: range.previous,
  });
  const grid = view === "volume" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-5" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
  if (!summary) return <CardsSkeleton count={view === "volume" ? 5 : 6} className={grid} />;
  const keys = view === "volume" ? VOLUME_CARD_KEYS : EFFICIENCY_CARD_KEYS;
  return (
    <div className={cn(grid, isStale && "opacity-60 transition-opacity")}>
      {keys.map((key) => (
        <MetricStatCard
          key={key}
          metricKey={key}
          metric={summary.metrics[key]}
          badge={key === "costUsd" ? "API list price" : undefined}
          footer={
            key === "costUsd" && summary.unpricedModels.length > 0
              ? `Unpriced: ${summary.unpricedModels.join(", ")}`
              : undefined
          }
        />
      ))}
      {view === "volume" ? (
        <QuotaCard />
      ) : (
        <CostStructureCard
          costByKind={summary.costByKind}
          costUsd={summary.metrics.costUsd.current}
          cacheSavingsUsd={summary.cacheSavingsUsd}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test, typecheck and lint**

Run: `cd web && npx vitest run --project dom src/components/home/metric-stat-card.test.tsx && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS (2 tests); typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/home
git commit -m "$(cat <<'MSG'
Add home overview cards with quota gauge and cost structure

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 20: Home — Users section (podium, ranked table, metric toggle, Linear | Log, rank movement)

**Files:**
- Create: `web/src/components/home/users-section.tsx`, `web/src/lib/leaderboard.ts`
- Test: `web/src/lib/leaderboard.test.ts`

**Interfaces:**
- Consumes: `api.stats.leaderboard` (→ `LeaderboardResult`, rows of `LeaderboardRow`); `useStableQuery`, `useUserColors`, `useRangeHref` (Task 11); `Podium`, `DataTable`, `SegmentedControl`, `RankMovement`, `AvatarName`, `DeltaPill`, `SectionCard`, `EmptyState` (Tasks 12–13); `formatMetricValue` (Task 7).
- Produces: `type LeaderMetric = "tokens" | "cost" | "sessions" | "messages" | "lines" | "tokensPerLine"`; `LEADER_METRICS` (segmented options); `leaderValue(row, metric): number | null`; `leaderKind(metric): MetricKind`; `sortLeaderboard(rows, metric): LeaderboardRow[]`; `<UsersSection range />`.

- [ ] **Step 1: Write the failing test `web/src/lib/leaderboard.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { LeaderboardRow } from "@convex/lib/types";
import { leaderKind, leaderValue, sortLeaderboard } from "./leaderboard";

const row = (id: string, tokens: number, cost: number, lines: number): LeaderboardRow => ({
  userId: id as Id<"users">,
  name: id,
  imageUrl: null,
  tokens: { input: tokens, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: tokens },
  costUsd: cost,
  unpriced: false,
  sessions: 1,
  turns: 1,
  messages: 2,
  userMessages: 1,
  linesAdded: lines,
  linesRemoved: 0,
  tokensPerLine: lines > 0 ? tokens / lines : null,
  cacheHitRate: null,
  activeMs: 0,
  rank: 1,
  previousRank: null,
  previousTokens: null,
  change: null,
});

describe("leaderboard helpers", () => {
  it("reads the metric value and its display kind", () => {
    const r = row("a", 1000, 2.5, 10);
    expect(leaderValue(r, "tokens")).toBe(1000);
    expect(leaderValue(r, "cost")).toBe(2.5);
    expect(leaderValue(r, "lines")).toBe(10);
    expect(leaderValue(r, "tokensPerLine")).toBe(100);
    expect(leaderValue(row("b", 1000, 0, 0), "tokensPerLine")).toBeNull();
    expect(leaderKind("cost")).toBe("usd");
    expect(leaderKind("tokensPerLine")).toBe("tokens");
  });
  it("sorts descending with nulls last and keeps ties by name", () => {
    const rows = [row("b", 10, 0, 0), row("a", 10, 0, 5), row("c", 30, 0, 1)];
    expect(sortLeaderboard(rows, "tokens").map((r) => r.name)).toEqual(["c", "a", "b"]);
    expect(sortLeaderboard(rows, "tokensPerLine").map((r) => r.name)).toEqual(["c", "a", "b"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/leaderboard.test.ts`
Expected: FAIL with `Failed to resolve import "./leaderboard"`.

- [ ] **Step 3: Implement `web/src/lib/leaderboard.ts` and the section**

`web/src/lib/leaderboard.ts`:
```ts
import type { LeaderboardRow } from "@convex/lib/types";
import type { MetricKind } from "./metrics";

export type LeaderMetric = "tokens" | "cost" | "sessions" | "messages" | "lines" | "tokensPerLine";

export const LEADER_METRICS: { value: LeaderMetric; label: string }[] = [
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
  { value: "sessions", label: "Sessions" },
  { value: "messages", label: "Messages" },
  { value: "lines", label: "Generated lines" },
  { value: "tokensPerLine", label: "Tokens per line" },
];

export function leaderValue(row: LeaderboardRow, metric: LeaderMetric): number | null {
  switch (metric) {
    case "tokens":
      return row.tokens.total;
    case "cost":
      return row.costUsd;
    case "sessions":
      return row.sessions;
    case "messages":
      return row.messages;
    case "lines":
      return row.linesAdded;
    case "tokensPerLine":
      return row.tokensPerLine;
  }
}

export function leaderKind(metric: LeaderMetric): MetricKind {
  switch (metric) {
    case "tokens":
    case "tokensPerLine":
      return "tokens";
    case "cost":
      return "usd";
    default:
      return "count";
  }
}

export function sortLeaderboard(rows: LeaderboardRow[], metric: LeaderMetric): LeaderboardRow[] {
  return [...rows].sort((a, b) => {
    const va = leaderValue(a, metric);
    const vb = leaderValue(b, metric);
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || a.name.localeCompare(b.name);
  });
}
```

`web/src/components/home/users-section.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { LeaderboardRow } from "@convex/lib/types";
import { AvatarName } from "@/components/primitives/avatar-name";
import type { BarScale } from "@/components/primitives/bar-cell";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { DeltaPill } from "@/components/primitives/delta-pill";
import { EmptyState } from "@/components/primitives/empty-state";
import { Podium, type PodiumEntry } from "@/components/primitives/podium";
import { RankMovement } from "@/components/primitives/rank-movement";
import { SectionCard } from "@/components/primitives/section-card";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserColors } from "@/hooks/use-entity-colors";
import { useRangeHref } from "@/hooks/use-range";
import { useStableQuery } from "@/hooks/use-stable-query";
import { colorFor } from "@/lib/colors";
import { formatDeltaPercent } from "@/lib/format";
import { LEADER_METRICS, leaderKind, leaderValue, sortLeaderboard, type LeaderMetric } from "@/lib/leaderboard";
import { formatMetricValue } from "@/lib/metrics";
import type { ResolvedRange } from "@/lib/range";
import { cn } from "@/lib/utils";

const SCALES: { value: BarScale; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log" },
];

export function UsersSection({ range }: { range: ResolvedRange }) {
  const { data, isStale } = useStableQuery(api.stats.leaderboard, {
    from: range.from,
    to: range.to,
    previous: range.previous,
  });
  const colors = useUserColors();
  const href = useRangeHref();
  const [metric, setMetric] = useState<LeaderMetric>("tokens");
  const [scale, setScale] = useState<BarScale>("linear");
  const kind = leaderKind(metric);

  const actions = (
    <>
      <SegmentedControl ariaLabel="Ranking metric" options={LEADER_METRICS} value={metric} onChange={setMetric} />
      <SegmentedControl ariaLabel="Bar scale" options={SCALES} value={scale} onChange={setScale} />
    </>
  );

  if (!data) {
    return (
      <SectionCard title="Users" actions={actions}>
        <Skeleton className="h-64" />
      </SectionCard>
    );
  }

  const rows = sortLeaderboard(data.rows, metric);
  const podium: PodiumEntry[] = rows.slice(0, 3).map((r, i) => ({
    rank: (i + 1) as 1 | 2 | 3,
    name: r.name,
    imageUrl: r.imageUrl,
    color: colorFor(colors, r.userId),
    value: formatMetricValue(kind, leaderValue(r, metric)),
    sub: metric === "tokens" && r.change !== null ? `${formatDeltaPercent(r.change)} vs previous` : undefined,
    href: href(`/users/${r.userId}`),
  }));

  const columns: Column<LeaderboardRow>[] = [
    {
      key: "rank",
      header: "#",
      width: "4rem",
      render: (r) => (
        <span className="inline-flex items-center gap-2 tabular">
          {rows.indexOf(r) + 1}
          {metric === "tokens" && range.previous ? <RankMovement rank={r.rank} previousRank={r.previousRank} /> : null}
        </span>
      ),
    },
    {
      key: "user",
      header: "User",
      render: (r) => (
        <Link href={href(`/users/${r.userId}`)} className="hover:underline">
          <AvatarName name={r.name} imageUrl={r.imageUrl} color={colorFor(colors, r.userId)} />
        </Link>
      ),
    },
    {
      key: "metric",
      header: LEADER_METRICS.find((m) => m.value === metric)!.label,
      align: "right",
      bar: (r) => leaderValue(r, metric) ?? 0,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {metric === "cost" && r.unpriced ? (
            <Badge variant="outline" className="rounded-full text-[10px]">
              unpriced
            </Badge>
          ) : null}
          {formatMetricValue(kind, leaderValue(r, metric))}
        </span>
      ),
    },
    { key: "cache", header: "Cache hit", align: "right", render: (r) => formatMetricValue("percent", r.cacheHitRate) },
    { key: "active", header: "Active", align: "right", render: (r) => formatMetricValue("hours", r.activeMs) },
    {
      key: "delta",
      header: "vs previous",
      align: "right",
      render: (r) => (metric === "tokens" ? <DeltaPill change={r.change} goodDirection="up" /> : null),
    },
  ];

  return (
    <SectionCard
      title="Users"
      help="Ranked by the selected metric for the current range. Rank movement and the delta compare token totals with the previous period of the same length."
      actions={actions}
      bodyClassName={cn("flex flex-col gap-6", isStale && "opacity-60 transition-opacity")}
    >
      {rows.length === 0 ? (
        <EmptyState title="No usage in this range" description="Install the collector on a machine or widen the range." />
      ) : (
        <>
          <Podium entries={podium} />
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.userId} scale={scale} barColor={(r) => colorFor(colors, r.userId)} />
        </>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 4: Run the test, typecheck and lint**

Run: `cd web && npx vitest run --project unit src/lib/leaderboard.test.ts && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS; typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/leaderboard.ts web/src/lib/leaderboard.test.ts web/src/components/home/users-section.tsx
git commit -m "$(cat <<'MSG'
Add the users leaderboard section with podium, metric toggle and log bars

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 21: Home — Models, Tools, Projects and Skills sections

**Files:**
- Create: `web/src/hooks/use-breakdowns.ts`, `web/src/components/primitives/query-section.tsx`, `web/src/lib/breakdowns.ts`, `web/src/components/home/model-columns.tsx`, `web/src/components/home/models-section.tsx`, `web/src/components/home/tools-section.tsx`, `web/src/components/home/projects-section.tsx`, `web/src/components/home/skills-section.tsx`
- Test: `web/src/lib/breakdowns.test.ts`

**Interfaces:**
- Consumes: `api.stats.breakdowns` (→ `BreakdownsResult`); `useStableQuery`, `useModelColors` (Task 11); `StackedShareBar` (Task 17); `DataTable`, `SectionCard`, `SegmentedControl`, `EmptyState`, `StatCard` (Tasks 12–13); `shareSegments` (Task 8); `TOOL_KINDS`/`ToolKind` from `@shared/constants`; `cacheHitRate`/`ratio` from `@shared/metrics` (contracts §5 — the cache-hit and $/M-token math is never re-implemented).
- Produces: `useBreakdowns(range: ResolvedRange | null, userId?: Id<"users">): { data: BreakdownsResult | undefined; isStale: boolean }` — **the only `stats.breakdowns` call site in the app**; `<QuerySection title info? description? actions? data isStale bodyClassName? skeletonClassName?>{(data) => …}</QuerySection>` (renders the `SectionCard` + `Skeleton` loading state and the `isStale` dimming once, for every breakdown card); `TOOL_LABELS: Record<ToolKind, string>`; `SOURCE_LABELS: Record<string, string>`; `toolSegments(byTool): Segment[]` (fixed order and colors); `modelSegments(byModel, colors): Segment[]`; `sourceSegments(bySource): Segment[]`; `type ModelTableRow`, `modelTableRows(byModel): ModelTableRow[]` and `modelTableColumns({ responses?, usdPerMTok? }): Column<ModelTableRow>[]` — the single per-model table definition, reused by Task 25; `<ModelsSection range userId? />`, `<ToolsSection range userId? />`, `<ProjectsSection range userId? />`, `<SkillsSection range userId? />` (all accept an optional `userId: Id<"users">` so the user page reuses them).

- [ ] **Step 1: Write the failing test `web/src/lib/breakdowns.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { TOOL_KINDS } from "@shared/constants";
import type { ModelRow } from "@convex/lib/types";
import { assignSlots } from "./colors";
import { TOOL_LABELS, modelSegments, modelTableRows, sourceSegments, toolSegments } from "./breakdowns";

const modelRow = (key: string, input: number, cached: number, costUsd: number | null, responses = 1): ModelRow => ({
  key,
  effort: null,
  tokens: { input, cachedInput: cached, cacheWrite: 0, output: 0, reasoning: 0, total: input },
  responses,
  costUsd,
  share: 0.5,
});

describe("breakdown helpers", () => {
  it("labels every tool kind", () => {
    for (const kind of TOOL_KINDS) expect(TOOL_LABELS[kind].length).toBeGreaterThan(0);
  });
  it("builds tool segments in the fixed order with shares", () => {
    const segs = toolSegments([
      { key: "commandRead", count: 30, share: 0.75 },
      { key: "fileChange", count: 10, share: 0.25 },
    ]);
    expect(segs.map((s) => s.key)).toEqual(["commandRead", "fileChange"]);
    expect(segs[0]?.label).toBe("Read files");
    expect(segs[0]?.share).toBeCloseTo(0.75);
    expect(segs[0]?.color).not.toBe(segs[1]?.color);
  });
  it("builds model segments with registry colors", () => {
    const colors = assignSlots(["gpt-5.6-sol"]);
    const tokens = { input: 100, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 100 };
    const segs = modelSegments(
      [{ key: "gpt-5.6-sol", effort: null, tokens, responses: 1, costUsd: 0.1, share: 1 }],
      colors,
    );
    expect(segs).toEqual([{ key: "gpt-5.6-sol", label: "gpt-5.6-sol", value: 100, share: 1, color: "#008300" }]);
  });
  it("derives the shared per-model row with cache hit and $ per million tokens", () => {
    const rows = modelTableRows([modelRow("a", 2_000_000, 500_000, 3, 4), modelRow("b", 1_000_000, 0, null)]);
    expect(rows[0]).toEqual({ model: "a", tokens: 2_000_000, share: 0.5, responses: 4, cacheHitRate: 0.25, costUsd: 3, usdPerMTok: 1.5 });
    expect(rows[1]).toEqual({ model: "b", tokens: 1_000_000, share: 0.5, responses: 1, cacheHitRate: 0, costUsd: null, usdPerMTok: null });
  });
  it("labels source shares and gives each source its own color", () => {
    const segs = sourceSegments([
      { key: "cli", tokens: 80, sessions: 4, share: 0.8 },
      { key: "something_new", tokens: 20, sessions: 1, share: 0.2 },
    ]);
    expect(segs.map((s) => s.label)).toEqual(["CLI", "something_new"]);
    expect(segs[0]?.value).toBe(80);
    expect(segs[0]?.color).not.toBe(segs[1]?.color);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/breakdowns.test.ts`
Expected: FAIL with `Failed to resolve import "./breakdowns"`.

- [ ] **Step 3: Implement `web/src/lib/breakdowns.ts`, the shared `useBreakdowns` hook, `<QuerySection>` and the per-model columns**

```ts
import { TOOL_KINDS, type ToolKind } from "@shared/constants";
import { cacheHitRate, ratio } from "@shared/metrics";
import type { BreakdownsResult } from "@convex/lib/types";
import { CATEGORICAL, OTHER_COLOR, type ColorMap } from "./colors";
import { shareSegments, type Segment } from "./chart-data";

export const TOOL_LABELS: Record<ToolKind, string> = {
  commandRead: "Read files",
  commandList: "List files",
  commandSearch: "Search",
  commandOther: "Other commands",
  fileChange: "File changes",
  webSearch: "Web search",
  imageView: "Image view",
  mcpTool: "MCP tools",
  other: "Other",
};

const TOOL_COLORS: Record<ToolKind, string> = {
  commandRead: CATEGORICAL[1],
  commandList: CATEGORICAL[3],
  commandSearch: CATEGORICAL[4],
  commandOther: CATEGORICAL[5],
  fileChange: CATEGORICAL[0],
  webSearch: CATEGORICAL[2],
  imageView: CATEGORICAL[7],
  mcpTool: CATEGORICAL[6],
  other: OTHER_COLOR,
};

export function toolSegments(byTool: BreakdownsResult["byTool"]): Segment[] {
  const byKey = new Map(byTool.map((t) => [t.key, t]));
  return TOOL_KINDS.filter((k) => byKey.has(k)).map((k) => {
    const t = byKey.get(k)!;
    return { key: k, label: TOOL_LABELS[k], value: t.count, share: t.share, color: TOOL_COLORS[k] };
  });
}

export function modelSegments(byModel: BreakdownsResult["byModel"], colors: ColorMap): Segment[] {
  return shareSegments(
    byModel.map((m) => ({ key: m.key, value: m.tokens.total })),
    colors,
  );
}

/** Display names for `bySource` keys and session sources; unknown keys render verbatim. */
export const SOURCE_LABELS: Record<string, string> = {
  cli: "CLI",
  exec: "Exec",
  vscode: "VS Code",
  mcp: "MCP",
  subagent: "Sub-agent",
};

const SOURCE_COLORS = [CATEGORICAL[1], CATEGORICAL[0], CATEGORICAL[4], CATEGORICAL[3], CATEGORICAL[5]] as const;

export function sourceSegments(bySource: BreakdownsResult["bySource"]): Segment[] {
  return bySource.map((s, i) => ({
    key: s.key,
    label: SOURCE_LABELS[s.key] ?? s.key,
    value: s.tokens,
    share: s.share,
    color: SOURCE_COLORS[i % SOURCE_COLORS.length]!,
  }));
}

export type ModelTableRow = {
  model: string;
  tokens: number;
  share: number;
  responses: number;
  cacheHitRate: number | null;
  costUsd: number | null;
  usdPerMTok: number | null;
};

/** The one row shape behind every per-model table (Home → Models and the user Efficiency tab). */
export function modelTableRows(byModel: BreakdownsResult["byModel"]): ModelTableRow[] {
  return byModel.map((m) => ({
    model: m.key,
    tokens: m.tokens.total,
    share: m.share,
    responses: m.responses,
    cacheHitRate: cacheHitRate(m.tokens),
    costUsd: m.costUsd,
    usdPerMTok: m.costUsd === null ? null : ratio(m.costUsd * 1e6, m.tokens.total),
  }));
}
```

`web/src/hooks/use-breakdowns.ts` (the only `stats.breakdowns` call site in the app):
```ts
"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import type { ResolvedRange } from "@/lib/range";
import { useStableQuery } from "./use-stable-query";

export function useBreakdowns(
  range: ResolvedRange | null,
  userId?: Id<"users">,
): { data: BreakdownsResult | undefined; isStale: boolean } {
  return useStableQuery(
    api.stats.breakdowns,
    range === null ? "skip" : { from: range.from, to: range.to, userId },
  );
}
```

`web/src/components/primitives/query-section.tsx` (the one loading/stale scaffold for data sections):
```tsx
"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SectionCard } from "./section-card";

export function QuerySection<T>({
  title,
  info,
  description,
  actions,
  data,
  isStale,
  bodyClassName,
  skeletonClassName = "h-48",
  children,
}: {
  title: string;
  info?: string;
  /** A plain string, or one derived from the loaded data. */
  description?: string | ((data: T) => string);
  actions?: ReactNode;
  data: T | undefined;
  isStale: boolean;
  bodyClassName?: string;
  skeletonClassName?: string;
  children: (data: T) => ReactNode;
}) {
  const resolvedDescription =
    typeof description === "function" ? (data === undefined ? undefined : description(data)) : description;
  return (
    <SectionCard
      title={title}
      description={resolvedDescription}
      help={info}
      actions={actions}
      bodyClassName={cn(bodyClassName, isStale && "opacity-60 transition-opacity")}
    >
      {data === undefined ? <Skeleton className={skeletonClassName} /> : children(data)}
    </SectionCard>
  );
}
```

`web/src/components/home/model-columns.tsx` (used by Task 21 and Task 25 — never copied):
```tsx
import type { Column } from "@/components/primitives/data-table";
import { Badge } from "@/components/ui/badge";
import type { ModelTableRow } from "@/lib/breakdowns";
import { EM_DASH, formatCompact, formatInt, formatPercent, formatUsd } from "@/lib/format";

/** The single per-model table definition. `responses` and `usdPerMTok` are opt-in columns. */
export function modelTableColumns(
  options: { responses?: boolean; usdPerMTok?: boolean } = {},
): Column<ModelTableRow>[] {
  const columns: Column<ModelTableRow>[] = [
    { key: "model", header: "Model", render: (r) => r.model },
    { key: "tokens", header: "Tokens", align: "right", bar: (r) => r.tokens, render: (r) => formatCompact(r.tokens) },
    { key: "share", header: "Share", align: "right", render: (r) => formatPercent(r.share) },
  ];
  if (options.responses) {
    columns.push({ key: "responses", header: "Responses", align: "right", render: (r) => formatInt(r.responses) });
  }
  columns.push(
    { key: "cache", header: "Cache hit", align: "right", render: (r) => formatPercent(r.cacheHitRate) },
    {
      key: "cost",
      header: "Est. cost",
      align: "right",
      render: (r) =>
        r.costUsd === null ? (
          <Badge variant="outline" className="rounded-full text-[10px]">
            unpriced
          </Badge>
        ) : (
          formatUsd(r.costUsd)
        ),
    },
  );
  if (options.usdPerMTok) {
    columns.push({
      key: "rate",
      header: "$ / M tokens",
      align: "right",
      render: (r) => (r.usdPerMTok === null ? EM_DASH : formatUsd(r.usdPerMTok)),
    });
  }
  return columns;
}
```

- [ ] **Step 4: Implement the four sections**

`web/src/components/home/models-section.tsx`:
```tsx
"use client";

import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { StackedShareBar } from "@/components/charts/stacked-share-bar";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { useModelColors } from "@/hooks/use-entity-colors";
import { modelSegments, modelTableRows, sourceSegments } from "@/lib/breakdowns";
import { colorFor } from "@/lib/colors";
import { formatCompact, formatInt, formatNullable, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";
import { modelTableColumns } from "./model-columns";

const GRAINS = [
  { value: "model", label: "By model" },
  { value: "effort", label: "By effort" },
] as const;

type EffortRow = BreakdownsResult["byEffort"][number];

export function ModelsSection({ range, userId }: { range: ResolvedRange; userId?: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const [grain, setGrain] = useState<"model" | "effort">("model");
  const colors = useModelColors(data ? data.byModel.map((m) => m.key) : []);
  const modelColumns = modelTableColumns({ responses: true });
  const effortColumns: Column<EffortRow>[] = [
    { key: "effort", header: "Effort", render: (r) => r.key },
    { key: "tokens", header: "Tokens", align: "right", bar: (r) => r.tokens, render: (r) => formatCompact(r.tokens) },
    { key: "share", header: "Share", align: "right", render: (r) => formatPercent(r.share) },
    { key: "responses", header: "Responses", align: "right", render: (r) => formatInt(r.responses) },
  ];
  return (
    <QuerySection
      title="Models"
      info="Tokens per model (and per reasoning effort) for the range. Cost uses the price table on the Settings page."
      actions={<SegmentedControl ariaLabel="Model grain" options={GRAINS} value={grain} onChange={setGrain} />}
      data={data}
      isStale={isStale}
      bodyClassName="flex flex-col gap-4"
    >
      {(b) => (
        <>
          {b.byModel.length === 0 ? (
            <EmptyState title="No model usage in this range" />
          ) : grain === "model" ? (
            <>
              <StackedShareBar segments={modelSegments(b.byModel, colors)} format={formatCompact} showLegend={false} />
              <DataTable columns={modelColumns} rows={modelTableRows(b.byModel)} rowKey={(r) => r.model} barColor={(r) => colorFor(colors, r.model)} />
            </>
          ) : (
            <DataTable columns={effortColumns} rows={b.byEffort} rowKey={(r) => r.key} />
          )}
          {b.bySource.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">By source</p>
              <StackedShareBar segments={sourceSegments(b.bySource)} format={formatCompact} />
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{formatNullable(b.totalTokens, formatCompact)} tokens in total</p>
        </>
      )}
    </QuerySection>
  );
}
```

`web/src/components/home/tools-section.tsx`:
```tsx
"use client";

import type { Id } from "@convex/_generated/dataModel";
import { StackedShareBar } from "@/components/charts/stacked-share-bar";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { StatCard } from "@/components/primitives/stat-card";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { toolSegments } from "@/lib/breakdowns";
import { formatInt, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type McpRow = { key: string; count: number };

export function ToolsSection({ range, userId }: { range: ResolvedRange; userId?: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const mcpColumns: Column<McpRow>[] = [
    { key: "tool", header: "MCP tool (server/tool)", render: (r) => r.key },
    { key: "count", header: "Calls", align: "right", bar: (r) => r.count, render: (r) => formatInt(r.count) },
  ];
  return (
    <QuerySection
      title="Tools"
      description={(b) => `${formatInt(b.toolCalls)} tool calls`}
      info="Tool calls by kind: commands are classified by Codex (read, list, search, other); file changes, web search, image views and MCP tools are counted from completed items."
      data={data}
      isStale={isStale}
      bodyClassName="flex flex-col gap-4"
    >
      {(b) => {
        const segments = toolSegments(b.byTool);
        return b.toolCalls === 0 ? (
          <EmptyState title="No tool calls in this range" />
        ) : (
          <>
            <StackedShareBar segments={segments} format={formatInt} showLegend={false} />
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {segments.map((s) => (
                <StatCard key={s.key} label={s.label} value={s.value} kind="count" size="sm" footer={formatPercent(s.share)} />
              ))}
            </div>
            {b.byMcpTool.length > 0 ? <DataTable columns={mcpColumns} rows={b.byMcpTool} rowKey={(r) => r.key} /> : null}
          </>
        );
      }}
    </QuerySection>
  );
}
```

`web/src/components/home/projects-section.tsx`:
```tsx
"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { formatCompact, formatInt, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type ProjectRow = BreakdownsResult["byProject"][number];

export function ProjectsSection({ range, userId }: { range: ResolvedRange; userId?: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns: Column<ProjectRow>[] = [
    { key: "project", header: "Project", render: (r) => r.key },
    { key: "tokens", header: "Tokens", align: "right", bar: (r) => r.tokens, render: (r) => formatCompact(r.tokens) },
    { key: "share", header: "Share", align: "right", render: (r) => formatPercent(r.share) },
    { key: "sessions", header: "Sessions", align: "right", render: (r) => formatInt(r.sessions) },
    { key: "messages", header: "User messages", align: "right", render: (r) => formatInt(r.userMessages) },
    { key: "lines", header: "Lines +/−", align: "right", render: (r) => `+${formatInt(r.linesAdded)} / −${formatInt(r.linesRemoved)}` },
  ];
  return (
    <QuerySection
      title="Projects"
      info="Project = the last path segment of the session's working directory. Full paths are never uploaded."
      data={data}
      isStale={isStale}
    >
      {(b) => (b.byProject.length === 0 ? <EmptyState title="No projects in this range" /> : <DataTable columns={columns} rows={b.byProject} rowKey={(r) => r.key} />)}
    </QuerySection>
  );
}
```

`web/src/components/home/skills-section.tsx`:
```tsx
"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { formatInt } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type SkillRow = BreakdownsResult["bySkill"][number];

export function SkillsSection({ range, userId }: { range: ResolvedRange; userId?: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns: Column<SkillRow>[] = [
    { key: "skill", header: "Skill", render: (r) => r.key },
    { key: "count", header: "Invocations", align: "right", bar: (r) => r.count, render: (r) => formatInt(r.count) },
    { key: "sessions", header: "Sessions", align: "right", render: (r) => formatInt(r.sessions) },
  ];
  return (
    <QuerySection
      title="Skills"
      info="A skill is counted whenever a command reads a SKILL.md file; the skill name is its parent directory."
      data={data}
      isStale={isStale}
    >
      {(b) => (b.bySkill.length === 0 ? <EmptyState title="No skill use in this range" /> : <DataTable columns={columns} rows={b.bySkill} rowKey={(r) => r.key} />)}
    </QuerySection>
  );
}
```

- [ ] **Step 5: Run the test, typecheck and lint**

Run: `cd web && npx vitest run --project unit src/lib/breakdowns.test.ts && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS; typecheck and lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/use-breakdowns.ts web/src/components/primitives/query-section.tsx web/src/lib/breakdowns.ts web/src/lib/breakdowns.test.ts web/src/components/home/model-columns.tsx web/src/components/home/models-section.tsx web/src/components/home/tools-section.tsx web/src/components/home/projects-section.tsx web/src/components/home/skills-section.tsx
git commit -m "$(cat <<'MSG'
Add models, tools, projects and skills breakdown sections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 22: Home — trend charts, onboarding card and the page assembly

**Files:**
- Create: `web/src/hooks/use-origin.ts`, `web/src/components/home/trend-section.tsx`, `web/src/components/home/onboarding-card.tsx`
- Modify: `web/src/app/(app)/page.tsx` (replace the Task 2 placeholder)

**Interfaces:**
- Consumes: `api.stats.trends` (→ `TrendsResult`), `api.machines.list` (→ `MachineRow[]`); `bucketFor` from `@shared/days`; `trendByUser`, `trendByModel` (Task 8); `ChartCard`, `TrendChart`, `StackedBarChart` (Task 16); `installCommands` (Task 10); `useRange` (Task 11), `sectionParser`, `viewParser` (Task 5); every home section (Tasks 19–21); `SectionErrorBoundary`, `CopyBox`, `PageHeader`.
- Produces: `useOrigin(): string | null`; `<TrendSection range />`; `<OnboardingCard />` (renders nothing when the current user already has a machine); the Home route.

- [ ] **Step 1: Create `web/src/hooks/use-origin.ts`**

```ts
"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** `window.location.origin` on the client, `null` during server render. */
export function useOrigin(): string | null {
  return useSyncExternalStore(noop, () => window.location.origin, () => null);
}
```

- [ ] **Step 2: Create `web/src/components/home/trend-section.tsx`**

```tsx
"use client";

import { bucketFor } from "@shared/days";
import { api } from "@convex/_generated/api";
import { ChartCard } from "@/components/charts/chart-card";
import { StackedBarChart, TrendChart } from "@/components/charts/trend-chart";
import { SectionCard } from "@/components/primitives/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useModelColors, useUserColors } from "@/hooks/use-entity-colors";
import { useStableQuery } from "@/hooks/use-stable-query";
import { trendByModel, trendByUser } from "@/lib/chart-data";
import { formatCompact } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";
import { cn } from "@/lib/utils";

export function TrendSection({ range }: { range: ResolvedRange }) {
  const bucket = bucketFor(range.days);
  const { data, isStale } = useStableQuery(api.stats.trends, { from: range.from, to: range.to, bucket });
  const userColors = useUserColors();
  const modelColors = useModelColors(data ? data.models : []);
  if (!data) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Token usage trend">
          <Skeleton className="h-64" />
        </SectionCard>
        <SectionCard title="Tokens by model">
          <Skeleton className="h-64" />
        </SectionCard>
      </div>
    );
  }
  const byUser = trendByUser(data, userColors);
  const byModel = trendByModel(data, modelColors);
  const granularity = bucket === "day" ? "Daily" : bucket === "week" ? "Weekly" : "Monthly";
  return (
    <div className={cn("grid gap-4 xl:grid-cols-2", isStale && "opacity-60 transition-opacity")}>
      <ChartCard
        title="Token usage trend"
        description={`${granularity} tokens by user`}
        help="Stacked by user. The peak is the busiest bucket in the range."
        stacked={byUser}
        format={formatCompact}
        legendShape="line"
      >
        <TrendChart stacked={byUser} format={formatCompact} variant="area" />
      </ChartCard>
      <ChartCard
        title="Tokens by model"
        description={`${granularity} tokens, top 7 models + Other`}
        help="Stacked by model. Models beyond the top seven are folded into Other so colors stay readable."
        stacked={byModel}
        format={formatCompact}
        showPeak={false}
      >
        <StackedBarChart stacked={byModel} format={formatCompact} />
      </ChartCard>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/src/components/home/onboarding-card.tsx`**

```tsx
"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { useCurrentUserId } from "@/components/layout/current-user";
import { CopyBox } from "@/components/primitives/copy-box";
import { SectionCard } from "@/components/primitives/section-card";
import { Button } from "@/components/ui/button";
import { useOrigin } from "@/hooks/use-origin";
import { installCommands } from "@/lib/install";

/** Shown until the signed-in user has synced from at least one machine. */
export function OnboardingCard() {
  const userId = useCurrentUserId();
  const machines = useQuery(api.machines.list, { userId });
  const origin = useOrigin();
  if (machines === undefined || machines.length > 0) return null;
  const c = installCommands(origin ?? "https://<this dashboard>");
  return (
    <SectionCard
      title="Install the collector"
      description="No machine has synced for your account yet. Run these four commands on each machine where you use Codex."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings">Create a sync token</Link>
        </Button>
      }
      bodyClassName="grid gap-2 md:grid-cols-2"
    >
      <CopyBox label="1. Install" value={c.install} />
      <CopyBox label="2. Log in (paste your token)" value={c.login} />
      <CopyBox label="3. Schedule background sync" value={c.schedule} />
      <CopyBox label="4. Check" value={c.status} />
    </SectionCard>
  );
}
```

- [ ] **Step 4: Replace `web/src/app/(app)/page.tsx`**

```tsx
"use client";

import { useQueryState } from "nuqs";
import { PageHeader } from "@/components/layout/page-header";
import { ShellSkeleton } from "@/components/layout/app-gate";
import { ModelsSection } from "@/components/home/models-section";
import { OnboardingCard } from "@/components/home/onboarding-card";
import { OverviewCards } from "@/components/home/overview-cards";
import { ProjectsSection } from "@/components/home/projects-section";
import { SkillsSection } from "@/components/home/skills-section";
import { ToolsSection } from "@/components/home/tools-section";
import { TrendSection } from "@/components/home/trend-section";
import { UsersSection } from "@/components/home/users-section";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { useRange } from "@/hooks/use-range";
import { SECTIONS, VIEWS, sectionParser, viewParser, type Section } from "@/lib/search-params";

const SECTION_OPTIONS = SECTIONS.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }));
const VIEW_OPTIONS = VIEWS.map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));

function SectionBody({ section, range }: { section: Section; range: NonNullable<ReturnType<typeof useRange>["resolved"]> }) {
  switch (section) {
    case "users":
      return <UsersSection range={range} />;
    case "models":
      return <ModelsSection range={range} />;
    case "tools":
      return <ToolsSection range={range} />;
    case "projects":
      return <ProjectsSection range={range} />;
    case "skills":
      return <SkillsSection range={range} />;
  }
}

export default function HomePage() {
  const { resolved } = useRange();
  const [section, setSection] = useQueryState("section", sectionParser);
  const [view, setView] = useQueryState("view", viewParser);
  if (resolved === null) return <ShellSkeleton />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Insights"
        description={`${resolved.label} · ${resolved.days} day${resolved.days === 1 ? "" : "s"}`}
        actions={<SegmentedControl ariaLabel="View" options={VIEW_OPTIONS} value={view} onChange={(v) => void setView(v)} />}
      />
      <SectionErrorBoundary title="Overview could not load">
        <OnboardingCard />
        <OverviewCards range={resolved} view={view} />
      </SectionErrorBoundary>
      <SegmentedControl ariaLabel="Section" options={SECTION_OPTIONS} value={section} onChange={(s) => void setSection(s)} size="default" className="self-start" />
      <SectionErrorBoundary>
        <SectionBody section={section} range={resolved} />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Trends could not load">
        <TrendSection range={resolved} />
      </SectionErrorBoundary>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck, lint and check the page in the browser**

Run: `npm run typecheck -w web && npm run lint -w web`
Expected: both exit 0.
With `npm run dev -w web` and the dev deployment holding the synced sessions from Plan 2's end-to-end task, open `http://localhost:3000/?range=30D`:
- five cards (Total tokens, Estimated cost with the `API list price` badge, Generated lines, Sessions, Shared weekly quota gauge) with delta pills; switch `Efficiency`: Cache hit rate, Tokens per turn, Avg session, TTFT median, Compactions and the Cost structure bar.
- `Users` shows the podium (one user) and the table; `Tokens per line` re-sorts; `Log` changes bar widths.
- `Models`, `Tools`, `Projects`, `Skills` render tables; the URL carries `section=`.
- Both trend charts render with a hairline grid and a legend; hovering shows the tooltip with every series and a total; `Table` shows the same rows.
- Card totals equal the CLI's `sync --dry-run --json` totals for the same days.
- Sign in as a second (test) user with no machines: the onboarding card appears above the cards.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/use-origin.ts web/src/components/home/trend-section.tsx web/src/components/home/onboarding-card.tsx "web/src/app/(app)/page.tsx"
git commit -m "$(cat <<'MSG'
Assemble the home page with trend charts and the onboarding card

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 23: User page — header, tabs and the Overview tab (rank, 13 stat cards, activity heatmap, token trend, Data Sync)

**Files:**
- Create: `web/src/components/user/user-header.tsx`, `web/src/components/user/rank-card.tsx`, `web/src/components/user/overview-stats.tsx`, `web/src/components/user/activity-card.tsx`, `web/src/components/user/token-trend-card.tsx`, `web/src/components/user/data-sync-card.tsx`, `web/src/components/user/overview-tab.tsx`
- Create: `web/src/app/(app)/users/[userId]/page.tsx`
- Test: `web/src/components/user/rank-card.test.tsx`

**Interfaces:**
- Consumes: `api.users.list`, `api.stats.leaderboard`, `api.stats.summary`, `api.stats.activityHeatmap`, `api.stats.trends`, `api.machines.list`; `USER_OVERVIEW_KEYS` (Task 7); `buildActivityGrid` (Task 9); `trendSingle`, `TrendMetric` (Task 8); `ActivityHeatmap` (Task 18), `ChartCard`, `TrendChart`, `TrendVariant` (Task 16); `installCommands`, `isNewerThanTested`, `TESTED_CODEX_VERSION` (Task 10); `useOrigin` (Task 22); `tabParser`, `TABS` (Task 5); `addDays` from `@shared/days`, `bucketFor`, `Bucket`.
- Produces: `<UserHeader user isMe />`; `<RankCard range userId />` + pure `rankSummary(rows, userId): { rank: number; previousRank: number | null; total: number; share: number | null } | null`; `<OverviewStats range userId />`; `<ActivityCard userId today />`; `<TokenTrendCard range userId />`; `<DataSyncCard userId isMe />`; `<OverviewTab range userId isMe today />`; the `/users/[userId]` route with `tab` navigation.

- [ ] **Step 1: Write the failing test `web/src/components/user/rank-card.test.tsx`**

```tsx
import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { LeaderboardRow } from "@convex/lib/types";
import { rankSummary } from "./rank-card";

const row = (id: string, total: number, rank: number, previousRank: number | null): LeaderboardRow => ({
  userId: id as Id<"users">,
  name: id,
  imageUrl: null,
  tokens: { input: total, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total },
  costUsd: 0,
  unpriced: false,
  sessions: 0,
  turns: 0,
  messages: 0,
  userMessages: 0,
  linesAdded: 0,
  linesRemoved: 0,
  tokensPerLine: null,
  cacheHitRate: null,
  activeMs: 0,
  rank,
  previousRank,
  previousTokens: null,
  change: null,
});

describe("rankSummary", () => {
  it("finds the user's rank, movement, team size and token share", () => {
    const rows = [row("a", 600, 1, 2), row("b", 300, 2, 1), row("c", 100, 3, null)];
    expect(rankSummary(rows, "b" as Id<"users">)).toEqual({ rank: 2, previousRank: 1, total: 3, share: 0.3 });
  });
  it("returns null when the user has no data in the range", () => {
    expect(rankSummary([row("a", 1, 1, null)], "zzz" as Id<"users">)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project dom src/components/user/rank-card.test.tsx`
Expected: FAIL with `Failed to resolve import "./rank-card"`.

- [ ] **Step 3: Implement the Overview components**

`web/src/components/user/user-header.tsx`:
```tsx
import type { UserRef } from "@convex/lib/types";
import { AvatarName } from "@/components/primitives/avatar-name";
import { Badge } from "@/components/ui/badge";

export function UserHeader({ user, isMe, color }: { user: UserRef; isMe: boolean; color: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <AvatarName name={user.name} imageUrl={user.imageUrl} color={color} size="lg" hideName />
      <div>
        <h1 className="text-xl font-semibold">{isMe ? "My Page" : user.name}</h1>
        <p className="text-sm text-muted-foreground">{isMe ? user.name : "Team member"}</p>
      </div>
      {isMe ? (
        <Badge variant="outline" className="ml-auto rounded-full">
          You
        </Badge>
      ) : null}
    </div>
  );
}
```

`web/src/components/user/rank-card.tsx`:
```tsx
"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { LeaderboardRow } from "@convex/lib/types";
import { RankMovement } from "@/components/primitives/rank-movement";
import { StatCard } from "@/components/primitives/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStableQuery } from "@/hooks/use-stable-query";
import { formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

export function rankSummary(
  rows: LeaderboardRow[],
  userId: Id<"users">,
): { rank: number; previousRank: number | null; total: number; share: number | null } | null {
  const row = rows.find((r) => r.userId === userId);
  if (!row) return null;
  const teamTokens = rows.reduce((acc, r) => acc + r.tokens.total, 0);
  return {
    rank: row.rank,
    previousRank: row.previousRank,
    total: rows.length,
    share: teamTokens > 0 ? row.tokens.total / teamTokens : null,
  };
}

export function RankCard({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data } = useStableQuery(api.stats.leaderboard, { from: range.from, to: range.to, previous: range.previous });
  if (!data) return <Skeleton className="h-28 rounded-xl" />;
  const summary = rankSummary(data.rows, userId);
  if (!summary) {
    return <StatCard label="Team rank" value="—" footer="No usage in this range" />;
  }
  return (
    <StatCard
      label="Team rank"
      help="Rank by total tokens in the current range; the arrow compares with the previous period."
      value={
        <span className="inline-flex items-baseline gap-2">
          #{summary.rank}
          <span className="text-base font-normal text-muted-foreground">/ {summary.total}</span>
          {range.previous ? <RankMovement rank={summary.rank} previousRank={summary.previousRank} /> : null}
        </span>
      }
      footer={summary.share === null ? undefined : `${formatPercent(summary.share)} of team tokens`}
    />
  );
}
```

`web/src/components/user/overview-stats.tsx`:
```tsx
"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CardsSkeleton } from "@/components/home/cards-skeleton";
import { MetricStatCard } from "@/components/home/metric-stat-card";
import { useStableQuery } from "@/hooks/use-stable-query";
import { USER_OVERVIEW_KEYS } from "@/lib/metrics";
import type { ResolvedRange } from "@/lib/range";
import { cn } from "@/lib/utils";
import { RankCard } from "./rank-card";

const GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7";

export function OverviewStats({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data: summary, isStale } = useStableQuery(api.stats.summary, {
    from: range.from,
    to: range.to,
    userId,
    previous: range.previous,
  });
  if (!summary) return <CardsSkeleton count={14} className={GRID} />;
  return (
    <div className={cn(GRID, isStale && "opacity-60 transition-opacity")}>
      <RankCard range={range} userId={userId} />
      {USER_OVERVIEW_KEYS.map((key) => (
        <MetricStatCard
          key={key}
          metricKey={key}
          metric={summary.metrics[key]}
          size="sm"
          badge={key === "costUsd" ? "API list price" : undefined}
        />
      ))}
    </div>
  );
}
```

`web/src/components/user/activity-card.tsx`:
```tsx
"use client";

import { addDays } from "@shared/days";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { SectionCard } from "@/components/primitives/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStableQuery } from "@/hooks/use-stable-query";
import { formatCompact, formatInt } from "@/lib/format";
import { buildActivityGrid } from "@/lib/heatmap";

const DAYS_BACK = 370; // 53 weeks, aligned to Monday by the grid builder

export function ActivityCard({ userId, today }: { userId: Id<"users">; today: string }) {
  const from = addDays(today, -DAYS_BACK);
  const { data } = useStableQuery(api.stats.activityHeatmap, { userId, from, to: today });
  return (
    <SectionCard
      title="Activity"
      description={data ? `${formatInt(data.activeDays)} active days · busiest day ${formatCompact(data.maxTokens)} tokens` : "Last 12 months"}
      help="One cell per day over the last 12 months, in the day the work happened (machine time zone). Bins are fixed: under 10M, under 100M, under 1B, 1B+ tokens."
    >
      {data ? <ActivityHeatmap grid={buildActivityGrid(from, today, data.days)} /> : <Skeleton className="h-28" />}
    </SectionCard>
  );
}
```

`web/src/components/user/token-trend-card.tsx`:
```tsx
"use client";

import { useState } from "react";
import { bucketFor, type Bucket } from "@shared/days";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChartCard } from "@/components/charts/chart-card";
import { TrendChart, type TrendVariant } from "@/components/charts/trend-chart";
import { SectionCard } from "@/components/primitives/section-card";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useStableQuery } from "@/hooks/use-stable-query";
import { trendSingle, type TrendMetric } from "@/lib/chart-data";
import { CATEGORICAL } from "@/lib/colors";
import { formatCompact, formatUsd } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

const METRICS = [
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
  { value: "hours", label: "Hours" },
] as const;
const VARIANTS = [
  { value: "area", label: "Line" },
  { value: "bars", label: "Bars" },
  { value: "both", label: "Both" },
] as const;
const BUCKETS = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
] as const;

const formatHoursValue = (v: number) => `${v.toFixed(1)}h`;

export function TokenTrendCard({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const [metric, setMetric] = useState<TrendMetric>("tokens");
  const [variant, setVariant] = useState<TrendVariant>("area");
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const effectiveBucket = bucket ?? bucketFor(range.days);
  const { data } = useStableQuery(api.stats.trends, { from: range.from, to: range.to, bucket: effectiveBucket, userId });
  const format = metric === "cost" ? formatUsd : metric === "hours" ? formatHoursValue : formatCompact;
  const actions = (
    <>
      <SegmentedControl ariaLabel="Trend metric" options={METRICS} value={metric} onChange={setMetric} />
      <SegmentedControl ariaLabel="Chart style" options={VARIANTS} value={variant} onChange={setVariant} />
      <SegmentedControl ariaLabel="Granularity" options={BUCKETS} value={effectiveBucket} onChange={setBucket} />
    </>
  );
  if (!data) {
    return (
      <SectionCard title="Token trend" actions={actions}>
        <Skeleton className="h-64" />
      </SectionCard>
    );
  }
  const stacked = trendSingle(data, metric, CATEGORICAL[0]);
  return (
    <ChartCard title="Token trend" stacked={stacked} format={format} actions={actions} legendShape="line">
      <TrendChart stacked={stacked} format={format} variant={variant} />
    </ChartCard>
  );
}
```

`web/src/components/user/data-sync-card.tsx`:
```tsx
"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MachineRow } from "@convex/lib/types";
import { CopyBox } from "@/components/primitives/copy-box";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { SectionCard } from "@/components/primitives/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { useOrigin } from "@/hooks/use-origin";
import { formatRelative } from "@/lib/format";
import { installCommands, isNewerThanTested, TESTED_CODEX_VERSION } from "@/lib/install";

export function DataSyncCard({ userId, isMe }: { userId: Id<"users">; isMe: boolean }) {
  const machines = useQuery(api.machines.list, { userId });
  const origin = useOrigin();
  const now = useNow();
  const c = installCommands(origin ?? "https://<this dashboard>");
  const columns: Column<MachineRow>[] = [
    { key: "label", header: "Machine", render: (m) => m.label },
    { key: "platform", header: "Platform", render: (m) => `${m.platform}${m.arch ? ` · ${m.arch}` : ""}` },
    {
      key: "codex",
      header: "Codex",
      render: (m) => (
        <span className="inline-flex items-center gap-1.5">
          {m.codexVersion ?? "—"}
          {isNewerThanTested(m.codexVersion) ? (
            <Badge variant="outline" className="rounded-full text-[10px]" title={`Newer than the parser was tested with (${TESTED_CODEX_VERSION})`}>
              untested version
            </Badge>
          ) : null}
        </span>
      ),
    },
    { key: "cli", header: "Collector", render: (m) => m.cliVersion },
    { key: "sync", header: "Last sync", align: "right", render: (m) => (now === null ? "—" : formatRelative(m.lastSyncAt, now)) },
  ];
  return (
    <SectionCard
      title="Data Sync"
      description={isMe ? "Machines syncing for your account, and how to add one." : "Machines syncing for this account."}
      actions={
        isMe ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/settings">Manage tokens</Link>
          </Button>
        ) : undefined
      }
      bodyClassName="flex flex-col gap-4"
    >
      {machines === undefined ? (
        <Skeleton className="h-24" />
      ) : machines.length === 0 ? (
        <EmptyState title="No machines yet" description={isMe ? "Run the commands below on a machine where you use Codex." : "This user has not synced yet."} />
      ) : (
        <DataTable columns={columns} rows={machines} rowKey={(m) => m.machineId} />
      )}
      {isMe ? (
        <div className="grid gap-2 md:grid-cols-2">
          <CopyBox label="Install" value={c.install} />
          <CopyBox label="Log in" value={c.login} />
          <CopyBox label="Schedule" value={c.schedule} />
          <CopyBox label="Status" value={c.status} />
        </div>
      ) : null}
    </SectionCard>
  );
}
```

`web/src/components/user/overview-tab.tsx`:
```tsx
"use client";

import type { Id } from "@convex/_generated/dataModel";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import type { ResolvedRange } from "@/lib/range";
import { ActivityCard } from "./activity-card";
import { DataSyncCard } from "./data-sync-card";
import { OverviewStats } from "./overview-stats";
import { TokenTrendCard } from "./token-trend-card";

export function OverviewTab({ range, userId, isMe, today }: { range: ResolvedRange; userId: Id<"users">; isMe: boolean; today: string }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionErrorBoundary title="Stats could not load">
        <OverviewStats range={range} userId={userId} />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Activity could not load">
        <ActivityCard userId={userId} today={today} />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Trend could not load">
        <TokenTrendCard range={range} userId={userId} />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Data Sync could not load">
        <DataSyncCard userId={userId} isMe={isMe} />
      </SectionErrorBoundary>
    </div>
  );
}
```

- [ ] **Step 4: Create the route `web/src/app/(app)/users/[userId]/page.tsx`**

```tsx
"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { useQueryState } from "nuqs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ShellSkeleton } from "@/components/layout/app-gate";
import { useCurrentUserId } from "@/components/layout/current-user";
import { EmptyState } from "@/components/primitives/empty-state";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { OverviewTab } from "@/components/user/overview-tab";
import { UserHeader } from "@/components/user/user-header";
import { useUserColors } from "@/hooks/use-entity-colors";
import { useRange } from "@/hooks/use-range";
import { colorFor } from "@/lib/colors";
import type { ResolvedRange } from "@/lib/range";
import { TABS, tabParser, type Tab } from "@/lib/search-params";

const TAB_OPTIONS = TABS.map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) }));

function TabBody({ tab, range, userId, isMe, today }: { tab: Tab; range: ResolvedRange; userId: Id<"users">; isMe: boolean; today: string }) {
  switch (tab) {
    case "overview":
      return <OverviewTab range={range} userId={userId} isMe={isMe} today={today} />;
    default:
      return <EmptyState title="Coming up" description="This tab is added in the next tasks." />;
  }
}

export default function UserPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId as Id<"users">;
  const me = useCurrentUserId();
  const users = useQuery(api.users.list, {});
  const colors = useUserColors();
  const { resolved, today } = useRange();
  const [tab, setTab] = useQueryState("tab", tabParser);
  if (users === undefined || resolved === null || today === null) return <ShellSkeleton />;
  const user = users.find((u) => u.userId === userId);
  if (!user) return <EmptyState title="User not found" description="This user has not signed in to the dashboard." />;
  const isMe = userId === me;
  return (
    <div className="flex flex-col gap-4">
      <UserHeader user={user} isMe={isMe} color={colorFor(colors, userId)} />
      <SegmentedControl ariaLabel="Tab" options={TAB_OPTIONS} value={tab} onChange={(t) => void setTab(t)} size="default" className="self-start" />
      <TabBody tab={tab} range={resolved} userId={userId} isMe={isMe} today={today} />
    </div>
  );
}
```

- [ ] **Step 5: Run the test, typecheck, lint and check in the browser**

Run: `cd web && npx vitest run --project dom src/components/user/rank-card.test.tsx && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS; typecheck and lint exit 0.
In the browser (`npm run dev -w web`), click `My Page`: the header shows your avatar and `You`; the Overview tab shows the rank card `#1 / 1`, thirteen small stat cards (Estimated cost … User messages), the 12-month activity heatmap with month labels and a legend, the token trend card whose `Cost`, `Bars`, `Both` and `Weekly` toggles all re-render, and the Data Sync card listing your machine with its Codex version and last sync time plus the four commands. Open `/users/<a bogus id>`: `User not found`.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/user "web/src/app/(app)/users"
git commit -m "$(cat <<'MSG'
Add the user page with the Overview tab, activity heatmap and Data Sync card

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 24: User page — Breakdown tab (tables, time analysis, weekday × hour heatmap)

**Files:**
- Create: `web/src/lib/time-analysis.ts`, `web/src/components/user/machines-table.tsx`, `web/src/components/user/sources-table.tsx`, `web/src/components/user/time-analysis-card.tsx`, `web/src/components/user/breakdown-tab.tsx`
- Modify: `web/src/app/(app)/users/[userId]/page.tsx` (add the `breakdown` case)
- Test: `web/src/lib/time-analysis.test.ts`

**Interfaces:**
- Consumes: `api.stats.summary`, `api.stats.dayHourHeatmap`, `useBreakdowns` + `<QuerySection>` (Task 21 — never `api.stats.breakdowns` directly); `SOURCE_LABELS` (Task 21); `ratio` from `@shared/metrics` (contracts §5); `ModelsSection`, `ToolsSection`, `ProjectsSection`, `SkillsSection` with `userId` (Task 21); `DayHourHeatmap` (Task 18); `WEEKDAY_LABELS`, `hourLabel` (Task 9).
- Produces: `peakHour(byHour: number[]): number | null`; `timeAnalysisRows(summary, byHour, heatmap): { label: string; value: string; help: string }[]`; `<MachinesTable range userId />`; `<SourcesTable range userId />` (renders `BreakdownsResult.bySource`); `<TimeAnalysisCard range userId />`; `<BreakdownTab range userId />`.

- [ ] **Step 1: Write the failing test `web/src/lib/time-analysis.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { peakHour, timeAnalysisRows } from "./time-analysis";
import type { Metric, MetricKey, SummaryResult } from "@convex/lib/types";

function summaryWith(values: Partial<Record<MetricKey, number>>): SummaryResult {
  const metrics = {} as Record<MetricKey, Metric>;
  for (const [k, v] of Object.entries(values)) metrics[k as MetricKey] = { current: v, previous: null, change: null };
  return {
    range: { from: "2026-08-03", to: "2026-09-01" },
    previousRange: null,
    tokens: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 },
    previousTokens: null,
    metrics,
    costByKind: { input: 0, cached: 0, output: 0, reasoning: 0 },
    cacheSavingsUsd: 0,
    unpricedModels: [],
  };
}

describe("time analysis", () => {
  it("finds the peak hour, ignoring all-zero days", () => {
    const byHour = Array.from({ length: 24 }, () => 0);
    expect(peakHour(byHour)).toBeNull();
    byHour[14] = 5;
    byHour[9] = 7;
    expect(peakHour(byHour)).toBe(9);
  });
  it("produces the seven rows with formatted values", () => {
    const summary = summaryWith({
      wallMs: 36_000_000,
      activeMs: 18_000_000,
      activeRate: 0.5,
      avgSessionActiveMs: 3_600_000,
      messages: 40,
      sessions: 5,
    });
    const byHour = Array.from({ length: 24 }, (_, h) => (h === 21 ? 100 : 0));
    const rows = timeAnalysisRows(summary, byHour, { grid: [], max: 0, peakHour: 21, peakWeekday: 2 });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Total hours", "10h"],
      ["Active hours", "5h"],
      ["Active rate", "50.0%"],
      ["Avg session", "1h 0m"],
      ["Messages / session", "8.0"],
      ["Peak hour", "21:00"],
      ["Most active day", "Wed"],
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/time-analysis.test.ts`
Expected: FAIL with `Failed to resolve import "./time-analysis"`.

- [ ] **Step 3: Implement `web/src/lib/time-analysis.ts` and the components**

`web/src/lib/time-analysis.ts`:
```ts
import { ratio } from "@shared/metrics";
import type { DayHourHeatmapResult, SummaryResult } from "@convex/lib/types";
import { formatDurationMs, formatHours, formatPercent } from "./format";
import { WEEKDAY_LABELS, hourLabel } from "./heatmap";

export function peakHour(byHour: number[]): number | null {
  let best: number | null = null;
  let bestValue = 0;
  for (let h = 0; h < byHour.length; h++) {
    const v = byHour[h] ?? 0;
    if (v > bestValue) {
      bestValue = v;
      best = h;
    }
  }
  return best;
}

export type TimeRow = { label: string; value: string; help: string };

export function timeAnalysisRows(summary: SummaryResult, byHour: number[], heatmap: DayHourHeatmapResult): TimeRow[] {
  const m = summary.metrics;
  const perSession = ratio(m.messages.current, m.sessions.current);
  const hour = heatmap.peakHour ?? peakHour(byHour);
  return [
    { label: "Total hours", value: formatHours(m.wallMs.current), help: "Sum of session spans (first to last event)." },
    { label: "Active hours", value: formatHours(m.activeMs.current), help: "Sum of turn durations while the model was working." },
    { label: "Active rate", value: formatPercent(m.activeRate.current), help: "Active hours divided by total hours." },
    { label: "Avg session", value: formatDurationMs(m.avgSessionActiveMs.current), help: "Active time per session." },
    { label: "Messages / session", value: perSession === null ? "—" : perSession.toFixed(1), help: "User plus agent messages per session." },
    { label: "Peak hour", value: hour === null ? "—" : `${hourLabel(hour)}:00`, help: "Hour of day with the most tokens (machine time zone)." },
    { label: "Most active day", value: heatmap.peakWeekday === null ? "—" : WEEKDAY_LABELS[heatmap.peakWeekday]!, help: "Weekday with the most tokens." },
  ];
}
```

`web/src/components/user/machines-table.tsx`:
```tsx
"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { formatCompact, formatInt, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type MachineRow = BreakdownsResult["byMachine"][number];

export function MachinesTable({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns: Column<MachineRow>[] = [
    { key: "machine", header: "Machine", render: (r) => r.label },
    { key: "tokens", header: "Tokens", align: "right", bar: (r) => r.tokens, render: (r) => formatCompact(r.tokens) },
    { key: "share", header: "Share", align: "right", render: (r) => formatPercent(r.share) },
    { key: "sessions", header: "Sessions", align: "right", render: (r) => formatInt(r.sessions) },
  ];
  return (
    <QuerySection
      title="Machines"
      info="Tokens per synced machine in the range. Rename machines on the Settings page."
      data={data}
      isStale={isStale}
      skeletonClassName="h-32"
    >
      {(b) => (b.byMachine.length === 0 ? <EmptyState title="No machine data in this range" /> : <DataTable columns={columns} rows={b.byMachine} rowKey={(r) => r.key} />)}
    </QuerySection>
  );
}
```

`web/src/components/user/sources-table.tsx`:
```tsx
"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { SOURCE_LABELS } from "@/lib/breakdowns";
import { formatCompact, formatInt, formatPercent } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";

type SourceRow = BreakdownsResult["bySource"][number];

export function SourcesTable({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns: Column<SourceRow>[] = [
    { key: "source", header: "Source", render: (r) => SOURCE_LABELS[r.key] ?? r.key },
    { key: "tokens", header: "Tokens", align: "right", bar: (r) => r.tokens, render: (r) => formatCompact(r.tokens) },
    { key: "sessions", header: "Sessions", align: "right", render: (r) => formatInt(r.sessions) },
    { key: "share", header: "Share", align: "right", render: (r) => formatPercent(r.share) },
  ];
  return (
    <QuerySection
      title="Sources"
      info="Where the work ran: the interactive CLI, `codex exec`, an editor extension, MCP, or a sub-agent thread."
      data={data}
      isStale={isStale}
      skeletonClassName="h-32"
    >
      {(b) => (b.bySource.length === 0 ? <EmptyState title="No sessions in this range" /> : <DataTable columns={columns} rows={b.bySource} rowKey={(r) => r.key} />)}
    </QuerySection>
  );
}
```

`web/src/components/user/time-analysis-card.tsx`:
```tsx
"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DayHourHeatmap } from "@/components/charts/day-hour-heatmap";
import { InfoTooltip } from "@/components/primitives/info-tooltip";
import { SectionCard } from "@/components/primitives/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { useStableQuery } from "@/hooks/use-stable-query";
import { formatCompact } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";
import { timeAnalysisRows } from "@/lib/time-analysis";

export function TimeAnalysisCard({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const args = { from: range.from, to: range.to, userId };
  const { data: summary } = useStableQuery(api.stats.summary, { ...args, previous: false });
  const { data: breakdowns } = useBreakdowns(range, userId);
  const { data: heatmap } = useStableQuery(api.stats.dayHourHeatmap, args);
  return (
    <SectionCard title="Time analysis" help="When and how long this user works with Codex, in the machines' local time." bodyClassName="flex flex-col gap-4">
      {!summary || !breakdowns || !heatmap ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
            {timeAnalysisRows(summary, breakdowns.byHour, heatmap).map((row) => (
              <div key={row.label} className="rounded-lg border border-border p-3">
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  {row.label}
                  <InfoTooltip text={row.help} />
                </dt>
                <dd className="text-lg font-semibold">{row.value}</dd>
              </div>
            ))}
          </dl>
          <DayHourHeatmap grid={heatmap.grid} format={formatCompact} />
        </>
      )}
    </SectionCard>
  );
}
```

`web/src/components/user/breakdown-tab.tsx`:
```tsx
"use client";

import type { Id } from "@convex/_generated/dataModel";
import { ModelsSection } from "@/components/home/models-section";
import { ProjectsSection } from "@/components/home/projects-section";
import { SkillsSection } from "@/components/home/skills-section";
import { ToolsSection } from "@/components/home/tools-section";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import type { ResolvedRange } from "@/lib/range";
import { MachinesTable } from "./machines-table";
import { SourcesTable } from "./sources-table";
import { TimeAnalysisCard } from "./time-analysis-card";

export function BreakdownTab({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionErrorBoundary>
        <TimeAnalysisCard range={range} userId={userId} />
      </SectionErrorBoundary>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionErrorBoundary>
          <ModelsSection range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <ToolsSection range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <ProjectsSection range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <SkillsSection range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <MachinesTable range={range} userId={userId} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <SourcesTable range={range} userId={userId} />
        </SectionErrorBoundary>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the tab into the page**

In `web/src/app/(app)/users/[userId]/page.tsx` add the import `import { BreakdownTab } from "@/components/user/breakdown-tab";` and this case to `TabBody` before `default:`:
```tsx
    case "breakdown":
      return <BreakdownTab range={range} userId={userId} />;
```

- [ ] **Step 5: Run the test, typecheck, lint and check in the browser**

Run: `cd web && npx vitest run --project unit src/lib/time-analysis.test.ts && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS; typecheck and lint exit 0. In the browser, `My Page → Breakdown` (`?tab=breakdown`) shows the seven time-analysis tiles, the weekday × hour heatmap with a tooltip on hover, and the Models, Tools, Projects, Skills, Machines and Sources cards scoped to the user (Sources lists CLI / Exec / Sub-agent with tokens, sessions and share).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/time-analysis.ts web/src/lib/time-analysis.test.ts web/src/components/user/machines-table.tsx web/src/components/user/sources-table.tsx web/src/components/user/time-analysis-card.tsx web/src/components/user/breakdown-tab.tsx "web/src/app/(app)/users/[userId]/page.tsx"
git commit -m "$(cat <<'MSG'
Add the user Breakdown tab with time analysis and weekday-hour heatmap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 25: User page — Efficiency tab (cost structure, cache savings, cost per line, per-model table)

**Files:**
- Create: `web/src/lib/efficiency.ts`, `web/src/components/user/efficiency-tab.tsx`
- Modify: `web/src/app/(app)/users/[userId]/page.tsx` (add the `efficiency` case)
- Test: `web/src/lib/efficiency.test.ts`

**Interfaces:**
- Consumes: `api.stats.summary`; `useBreakdowns`, `<QuerySection>`, `modelTableRows`, `modelTableColumns` (Task 21 — the per-model table is defined once there and reused here); `CostStructureCard`, `MetricStatCard`, `CardsSkeleton` (Task 19); `StatCard`, `DataTable`, `EmptyState` (Tasks 12–13); `ratio` from `@shared/metrics` (contracts §5).
- Produces: `costPerLine(costUsd, linesAdded): number | null`; `costWithoutCaching(costUsd, cacheSavingsUsd): number`; `<EfficiencyTab range userId />`.

- [ ] **Step 1: Write the failing test `web/src/lib/efficiency.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { costPerLine, costWithoutCaching } from "./efficiency";

describe("efficiency helpers", () => {
  it("guards cost per line and adds savings back", () => {
    expect(costPerLine(10, 0)).toBeNull();
    expect(costPerLine(10, 4)).toBe(2.5);
    expect(costWithoutCaching(10, 2.5)).toBe(12.5);
  });
});
```
(The per-model rows are `modelTableRows` from Task 21 and are tested in `src/lib/breakdowns.test.ts`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/efficiency.test.ts`
Expected: FAIL with `Failed to resolve import "./efficiency"`.

- [ ] **Step 3: Implement `web/src/lib/efficiency.ts` and the tab**

`web/src/lib/efficiency.ts`:
```ts
import { ratio } from "@shared/metrics";

export function costPerLine(costUsd: number, linesAdded: number): number | null {
  return ratio(costUsd, linesAdded);
}

export function costWithoutCaching(costUsd: number, cacheSavingsUsd: number): number {
  return costUsd + cacheSavingsUsd;
}
```

`web/src/components/user/efficiency-tab.tsx`:
```tsx
"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CardsSkeleton } from "@/components/home/cards-skeleton";
import { CostStructureCard } from "@/components/home/cost-structure-card";
import { MetricStatCard } from "@/components/home/metric-stat-card";
import { modelTableColumns } from "@/components/home/model-columns";
import { DataTable } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { QuerySection } from "@/components/primitives/query-section";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import { StatCard } from "@/components/primitives/stat-card";
import { useBreakdowns } from "@/hooks/use-breakdowns";
import { useStableQuery } from "@/hooks/use-stable-query";
import { modelTableRows } from "@/lib/breakdowns";
import { costPerLine, costWithoutCaching } from "@/lib/efficiency";
import { formatUsd } from "@/lib/format";
import type { ResolvedRange } from "@/lib/range";
import { cn } from "@/lib/utils";

function ModelEfficiencyTable({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data, isStale } = useBreakdowns(range, userId);
  const columns = modelTableColumns({ usdPerMTok: true });
  return (
    <QuerySection
      title="Cost by model"
      info="Effective price per million tokens after caching. Unpriced models need a price on the Settings page."
      data={data}
      isStale={isStale}
      skeletonClassName="h-40"
    >
      {(b) =>
        b.byModel.length === 0 ? (
          <EmptyState title="No model usage in this range" />
        ) : (
          <DataTable columns={columns} rows={modelTableRows(b.byModel)} rowKey={(r) => r.model} />
        )
      }
    </QuerySection>
  );
}

export function EfficiencyTab({ range, userId }: { range: ResolvedRange; userId: Id<"users"> }) {
  const { data: summary, isStale } = useStableQuery(api.stats.summary, {
    from: range.from,
    to: range.to,
    userId,
    previous: range.previous,
  });
  if (!summary) return <CardsSkeleton count={9} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" />;
  const cost = summary.metrics.costUsd.current;
  const perLine = costPerLine(cost, summary.metrics.linesAdded.current);
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-3", isStale && "opacity-60 transition-opacity")}>
        <CostStructureCard costByKind={summary.costByKind} costUsd={cost} cacheSavingsUsd={summary.cacheSavingsUsd} />
        <StatCard
          label="Cache savings"
          value={summary.cacheSavingsUsd}
          kind="usd"
          help="What the cached input tokens would have cost at the full input price, minus what they cost at the cached price."
          footer={`Without caching: ${formatUsd(costWithoutCaching(cost, summary.cacheSavingsUsd))}`}
        />
        <StatCard label="Cost per line" value={perLine} kind="usd" help="Estimated cost divided by generated lines." footer={perLine === null ? "No generated lines in this range" : undefined} />
        <MetricStatCard metricKey="cacheHitRate" metric={summary.metrics.cacheHitRate} />
        <MetricStatCard metricKey="tokensPerLine" metric={summary.metrics.tokensPerLine} />
        <MetricStatCard metricKey="tokensPerTurn" metric={summary.metrics.tokensPerTurn} />
        <MetricStatCard metricKey="ttftP50Ms" metric={summary.metrics.ttftP50Ms} />
        <MetricStatCard metricKey="compactions" metric={summary.metrics.compactions} />
        <MetricStatCard metricKey="reasoningTokens" metric={summary.metrics.reasoningTokens} />
      </div>
      <SectionErrorBoundary>
        <ModelEfficiencyTable range={range} userId={userId} />
      </SectionErrorBoundary>
    </div>
  );
}
```

- [ ] **Step 4: Wire the tab into the page**

In `web/src/app/(app)/users/[userId]/page.tsx` add `import { EfficiencyTab } from "@/components/user/efficiency-tab";` and this case to `TabBody` before `default:`:
```tsx
    case "efficiency":
      return <EfficiencyTab range={range} userId={userId} />;
```

- [ ] **Step 5: Run the test, typecheck, lint and check in the browser**

Run: `cd web && npx vitest run --project unit src/lib/efficiency.test.ts && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS; typecheck and lint exit 0. In the browser, `My Page → Efficiency` shows nine cards — the cost structure bar, cache savings with the "Without caching" footer, cost per line and six efficiency metric cards with delta pills (the skeleton shows the same nine, so nothing jumps) — plus the per-model table (unpriced models carry the badge). Edit a price on the Settings page later (Task 28) and confirm the cost cells change without a reload.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/efficiency.ts web/src/lib/efficiency.test.ts web/src/components/user/efficiency-tab.tsx "web/src/app/(app)/users/[userId]/page.tsx"
git commit -m "$(cat <<'MSG'
Add the user Efficiency tab with cost structure and per-model pricing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 26: User page — Sessions tab (paginated) and the finished tab switch

**Files:**
- Create: `web/src/lib/sessions.ts`, `web/src/components/user/sessions-tab.tsx`
- Modify: `web/src/app/(app)/users/[userId]/page.tsx` (add `sessions`, remove the `default` branch)
- Test: `web/src/lib/sessions.test.ts`

**Interfaces:**
- Consumes: `api.sessions.listRecent` via `usePaginatedQuery` (rows of `SessionRow`); `DataTable`, `SectionCard`, `EmptyState` (Tasks 12–13); `SOURCE_LABELS` (Task 21 — the source display names live there); `formatDateTime`, `formatCompact`, `formatPercent`, `formatUsd`, `formatDurationMs` (Task 3).
- Produces: `sourceLabel(source: string, isSubagent: boolean): string`; `<SessionsTab userId />`.

- [ ] **Step 1: Write the failing test `web/src/lib/sessions.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { sourceLabel } from "./sessions";

describe("sourceLabel", () => {
  it.each([
    ["cli", false, "CLI"],
    ["exec", false, "Exec"],
    ["vscode", false, "VS Code"],
    ["mcp", false, "MCP"],
    ["subagent:review", true, "Sub-agent · review"],
    ["custom", true, "Sub-agent"],
    ["something_new", false, "something_new"],
  ])("%s / subagent=%s → %s", (source, isSubagent, expected) => {
    expect(sourceLabel(source, isSubagent)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/sessions.test.ts`
Expected: FAIL with `Failed to resolve import "./sessions"`.

- [ ] **Step 3: Implement `web/src/lib/sessions.ts` and the tab**

`web/src/lib/sessions.ts`:
```ts
import { SOURCE_LABELS } from "./breakdowns";

export function sourceLabel(source: string, isSubagent: boolean): string {
  if (source.startsWith("subagent:")) {
    const kind = source.slice("subagent:".length);
    return kind ? `Sub-agent · ${kind}` : "Sub-agent";
  }
  if (isSubagent) return "Sub-agent";
  return SOURCE_LABELS[source] ?? source;
}
```

`web/src/components/user/sessions-tab.tsx`:
```tsx
"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SessionRow } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { SectionCard } from "@/components/primitives/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompact, formatDateTime, formatDurationMs, formatInt, formatPercent, formatUsd } from "@/lib/format";
import { sourceLabel } from "@/lib/sessions";

const PAGE_SIZE = 20;

export function SessionsTab({ userId }: { userId: Id<"users"> }) {
  const { results, status, loadMore } = usePaginatedQuery(api.sessions.listRecent, { userId }, { initialNumItems: PAGE_SIZE });
  const columns: Column<SessionRow>[] = [
    {
      key: "started",
      header: "Started",
      render: (s) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {s.inProgress ? <span className="inline-block size-1.5 rounded-full bg-status-good" title="In progress" aria-label="In progress" /> : null}
          {formatDateTime(s.startedAt)}
        </span>
      ),
    },
    { key: "project", header: "Project", render: (s) => s.project },
    { key: "branch", header: "Branch", render: (s) => s.gitBranch ?? "—" },
    { key: "model", header: "Model", render: (s) => s.model },
    { key: "effort", header: "Effort", render: (s) => s.effort ?? "—" },
    { key: "turns", header: "Turns", align: "right", render: (s) => formatInt(s.turns) },
    { key: "tokens", header: "Tokens", align: "right", render: (s) => formatCompact(s.tokens.total) },
    { key: "cache", header: "Cache hit", align: "right", render: (s) => formatPercent(s.cacheHitRate) },
    { key: "cost", header: "Cost", align: "right", render: (s) => (s.costUsd === null ? "unpriced" : formatUsd(s.costUsd)) },
    { key: "active", header: "Active", align: "right", render: (s) => formatDurationMs(s.activeMs) },
    {
      key: "source",
      header: "Source",
      render: (s) => (
        <Badge variant="outline" className="rounded-full text-[10px]">
          {sourceLabel(s.source, s.isSubagent)}
        </Badge>
      ),
    },
  ];
  return (
    <SectionCard title="Sessions" description="Newest first, independent of the selected range." help="One row per Codex thread. Cost is estimated with the session's primary model." bodyClassName="flex flex-col gap-3">
      {status === "LoadingFirstPage" ? (
        <Skeleton className="h-48" />
      ) : results.length === 0 ? (
        <EmptyState title="No sessions yet" />
      ) : (
        <>
          <DataTable columns={columns} rows={results} rowKey={(s) => s.sessionId} />
          {status === "CanLoadMore" || status === "LoadingMore" ? (
            <Button variant="outline" size="sm" className="self-center" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE_SIZE)}>
              {status === "LoadingMore" ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 4: Finish the tab switch in `web/src/app/(app)/users/[userId]/page.tsx`**

Add `import { SessionsTab } from "@/components/user/sessions-tab";`, replace the whole `TabBody` function with the exhaustive version below, and remove the now-unused `EmptyState` import only if it is no longer referenced (it is still used for `User not found`, so keep it):
```tsx
function TabBody({ tab, range, userId, isMe, today }: { tab: Tab; range: ResolvedRange; userId: Id<"users">; isMe: boolean; today: string }) {
  switch (tab) {
    case "overview":
      return <OverviewTab range={range} userId={userId} isMe={isMe} today={today} />;
    case "breakdown":
      return <BreakdownTab range={range} userId={userId} />;
    case "efficiency":
      return <EfficiencyTab range={range} userId={userId} />;
    case "sessions":
      return <SessionsTab userId={userId} />;
  }
}
```

- [ ] **Step 5: Run the test, typecheck, lint and check in the browser**

Run: `cd web && npx vitest run --project unit src/lib/sessions.test.ts && cd .. && npm run typecheck -w web && npm run lint -w web && npm run test -w web`
Expected: PASS; typecheck and lint exit 0; the full web suite (unit + dom + convex projects) passes. In the browser, `My Page → Sessions` lists the synced sessions newest first with the source badge (`CLI`, `Sub-agent · …`), `Load more` appears once more than 20 sessions exist, and every tab switch updates `?tab=`.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/sessions.ts web/src/lib/sessions.test.ts web/src/components/user/sessions-tab.tsx "web/src/app/(app)/users/[userId]/page.tsx"
git commit -m "$(cat <<'MSG'
Add the paginated Sessions tab and finish the user page tabs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 27: Settings — sync tokens (list, create-once dialog, revoke with confirm)

**Files:**
- Create: `web/src/components/settings/sync-tokens-card.tsx`
- Test: `web/src/components/settings/sync-tokens-card.test.tsx`

**Interfaces:**
- Consumes: `api.syncTokens.list` (→ `SyncTokenRow[]`), `api.syncTokens.create` (action → `{ id, token, prefix }`), `api.syncTokens.revoke`; `CopyBox`, `DataTable`, `SectionCard`, `EmptyState`, `InlineError` (Tasks 12–13); `useAsyncAction` (Task 11); `installCommands` (Task 10); `useOrigin` (Task 22); `useNow` (Task 11); shadcn `Dialog`, `AlertDialog`, `Input`, `Label`, `Button`, `Badge`.
- Produces: `<SyncTokensCard />`.

- [ ] **Step 1: Write the failing test `web/src/components/settings/sync-tokens-card.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const create = vi.fn(async () => ({ id: "t1", token: "ck_rawsecret", prefix: "ck_raws" }));
const revoke = vi.fn(async () => null);
vi.mock("convex/react", () => ({
  useQuery: () => [
    { _id: "t0", name: "Laptop", prefix: "ck_abc123", createdAt: 1_756_700_000_000, lastUsedAt: null, revokedAt: null },
  ],
  useAction: () => create,
  useMutation: () => revoke,
}));
vi.mock("@/hooks/use-origin", () => ({ useOrigin: () => "https://kaboo.test" }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => 1_756_800_000_000 }));

import { SyncTokensCard } from "./sync-tokens-card";

describe("SyncTokensCard", () => {
  it("lists tokens by name and prefix", () => {
    render(<SyncTokensCard />);
    expect(screen.getByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("ck_abc123…")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
  it("creates a token and shows the raw value once with a prefilled login line", async () => {
    render(<SyncTokensCard />);
    await userEvent.click(screen.getByRole("button", { name: "New token" }));
    await userEvent.clear(screen.getByLabelText("Token name"));
    await userEvent.type(screen.getByLabelText("Token name"), "Desk PC");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(create).toHaveBeenCalledWith({ name: "Desk PC" });
    expect(await screen.findByText("ck_rawsecret")).toBeInTheDocument();
    expect(screen.getByText("codex-kaboo login --token ck_rawsecret")).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project dom src/components/settings/sync-tokens-card.test.tsx`
Expected: FAIL with `Failed to resolve import "./sync-tokens-card"`.

- [ ] **Step 3: Implement `web/src/components/settings/sync-tokens-card.tsx`**

```tsx
"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SyncTokenRow } from "@convex/lib/types";
import { CopyBox } from "@/components/primitives/copy-box";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { InlineError } from "@/components/primitives/inline-error";
import { SectionCard } from "@/components/primitives/section-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsyncAction } from "@/hooks/use-async-action";
import { useNow } from "@/hooks/use-now";
import { useOrigin } from "@/hooks/use-origin";
import { formatDateTime, formatRelative } from "@/lib/format";
import { installCommands } from "@/lib/install";

type Created = { token: string; prefix: string; name: string };

function NewTokenDialog() {
  const create = useAction(api.syncTokens.create);
  const origin = useOrigin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("My machine");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const reset = () => {
    setName("My machine");
    setBusy(false);
    setError(null);
    setCreated(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await create({ name: name.trim() || "My machine" });
      setCreated({ token: result.token, prefix: result.prefix, name: name.trim() || "My machine" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the token");
    } finally {
      setBusy(false);
    }
  };

  const commands = installCommands(origin ?? "https://<this dashboard>", created?.token);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">New token</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? `Token "${created.name}" created` : "New sync token"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Copy it now — it is shown only once. Anyone with this token can upload usage to your account."
              : "One token per machine keeps revocation simple. The name is only a label."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="flex flex-col gap-3">
            <CopyBox label="Token" value={created.token} />
            <CopyBox label="Run on the machine after installing the collector" value={commands.login} />
            <CopyBox label="Install (if not installed yet)" value={commands.install} />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="token-name">Token name</Label>
            <Input id="token-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
            <InlineError message={error} />
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "Creating…" : "Create token"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeButton({ token }: { token: SyncTokenRow }) {
  const revokeToken = useMutation(api.syncTokens.revoke);
  const revoke = useAsyncAction(revokeToken);
  if (token.revokedAt !== null) return null;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-destructive">
            Revoke
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{token.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Machines using this token stop syncing immediately (their next sync gets 401). Already uploaded data is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.pending}
              onClick={() => void revoke.run({ tokenId: token._id as Id<"syncTokens"> })}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* The dialog closes on Revoke, so the failure is rendered next to the row instead. */}
      <InlineError message={revoke.error} />
    </span>
  );
}

export function SyncTokensCard() {
  const tokens = useQuery(api.syncTokens.list, {});
  const now = useNow();
  const columns: Column<SyncTokenRow>[] = [
    { key: "name", header: "Name", render: (t) => t.name },
    { key: "prefix", header: "Token", render: (t) => <code className="font-mono text-xs">{t.prefix}…</code> },
    { key: "created", header: "Created", render: (t) => formatDateTime(t.createdAt) },
    { key: "used", header: "Last used", render: (t) => (t.lastUsedAt === null || now === null ? "never" : formatRelative(t.lastUsedAt, now)) },
    {
      key: "status",
      header: "Status",
      render: (t) =>
        t.revokedAt === null ? (
          <Badge className="rounded-full bg-delta-up-bg text-delta-up-fg">Active</Badge>
        ) : (
          <Badge variant="outline" className="rounded-full">
            Revoked
          </Badge>
        ),
    },
    { key: "actions", header: "", align: "right", render: (t) => <RevokeButton token={t} /> },
  ];
  return (
    <SectionCard
      title="Sync tokens"
      description="The collector authenticates with a token. Only the hash is stored; the raw value is shown once at creation."
      actions={<NewTokenDialog />}
    >
      {tokens === undefined ? (
        <Skeleton className="h-24" />
      ) : tokens.length === 0 ? (
        <EmptyState title="No tokens yet" description="Create one, then run the install commands on your machine." />
      ) : (
        <DataTable columns={columns} rows={tokens} rowKey={(t) => t._id} />
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 4: Run the test, typecheck and lint**

Run: `cd web && npx vitest run --project dom src/components/settings/sync-tokens-card.test.tsx && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS (2 tests); typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/settings
git commit -m "$(cat <<'MSG'
Add the sync tokens card with a show-once create dialog and revoke confirm

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 28: Settings — install instructions, machines (rename), model prices (edit, add, remove, unpriced quick-add) and the page

**Files:**
- Create: `web/src/lib/prices.ts`, `web/src/components/settings/install-card.tsx`, `web/src/components/settings/machines-card.tsx`, `web/src/components/settings/prices-card.tsx`
- Modify: `web/src/app/(app)/settings/page.tsx` (replace the Task 15 placeholder)
- Test: `web/src/lib/prices.test.ts`

**Interfaces:**
- Consumes: `api.machines.list`, `api.machines.rename`, `api.users.list`, `api.prices.list`, `api.prices.upsert`, `api.prices.remove`, `api.stats.summary` (for `SummaryResult.unpricedModels`, contracts §9 — never the much heavier `stats.breakdowns`); `installSteps`, `INSTALL_OS`, `installCommands`, `isNewerThanTested` (Task 10); `useOrigin`, `useToday`, `useNow`, `useCurrentUserId`, `useStableQuery`, `useAsyncAction` (Task 11); `InlineError` (Task 12); `addDays` from `@shared/days`, `MAX_QUERY_RANGE_DAYS` from `@shared/constants`; shadcn `Tabs`, `Input`, `Button`, `Badge`.
- Produces: `parsePrice(text: string): number | null` (finite, ≥ 0, up to 6 decimals); `<InstallCard />`, `<MachinesCard />`, `<PricesCard />`; the Settings route.

- [ ] **Step 1: Write the failing test `web/src/lib/prices.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parsePrice } from "./prices";

describe("parsePrice", () => {
  it.each([
    ["2", 2],
    ["0.125", 0.125],
    [" 10.5 ", 10.5],
    ["0", 0],
    ["-1", null],
    ["abc", null],
    ["", null],
    ["1e400", null],
  ])("%s → %s", (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });
});
```
(The "unpriced models seen" chips come straight from `SummaryResult.unpricedModels`, so there is no
client-side derivation left to test.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run --project unit src/lib/prices.test.ts`
Expected: FAIL with `Failed to resolve import "./prices"`.

- [ ] **Step 3: Implement `web/src/lib/prices.ts`**

```ts
export function parsePrice(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
```

- [ ] **Step 4: Implement the three cards**

`web/src/components/settings/install-card.tsx`:
```tsx
"use client";

import { CopyBox } from "@/components/primitives/copy-box";
import { SectionCard } from "@/components/primitives/section-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrigin } from "@/hooks/use-origin";
import { INSTALL_OS, installCommands, installSteps } from "@/lib/install";

export function InstallCard() {
  const origin = useOrigin() ?? "https://<this dashboard>";
  return (
    <SectionCard
      title="Install the collector"
      description="Runs every 15 minutes and uploads metadata only: token counts, model names, tool kinds, skill names, project folder names, branches and timings. Never prompts, commands, file paths or diffs."
    >
      <Tabs defaultValue="macos">
        <TabsList>
          {INSTALL_OS.map((os) => (
            <TabsTrigger key={os.id} value={os.id}>
              {os.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {INSTALL_OS.map((os) => (
          <TabsContent key={os.id} value={os.id} className="flex flex-col gap-3 pt-3">
            {installSteps(os.id, origin).map((step, i) => (
              <div key={step.title} className="flex flex-col gap-1">
                <CopyBox label={`${i + 1}. ${step.title}`} value={step.command} />
                {step.note ? <p className="text-xs text-muted-foreground">{step.note}</p> : null}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              npm 12 or newer refuses remote tarballs by default; use <code className="font-mono">{installCommands(origin).installNpm12}</code>. Re-running the
              install command upgrades the collector in place.
            </p>
          </TabsContent>
        ))}
      </Tabs>
    </SectionCard>
  );
}
```

`web/src/components/settings/machines-card.tsx`:
```tsx
"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { MachineRow } from "@convex/lib/types";
import { useCurrentUserId } from "@/components/layout/current-user";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { InlineError } from "@/components/primitives/inline-error";
import { SectionCard } from "@/components/primitives/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsyncAction } from "@/hooks/use-async-action";
import { useNow } from "@/hooks/use-now";
import { formatRelative } from "@/lib/format";
import { isNewerThanTested, TESTED_CODEX_VERSION } from "@/lib/install";

function RenameCell({ machine }: { machine: MachineRow }) {
  const renameMachine = useMutation(api.machines.rename);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(machine.label);
  const rename = useAsyncAction(async (next: string) => {
    await renameMachine({ machineId: machine.machineId, label: next });
    setEditing(false);
  });
  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {machine.label}
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Rename
        </Button>
      </span>
    );
  }
  return (
    <form
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const next = label.trim();
        if (next.length === 0 || next.length > 64) return;
        void rename.run(next);
      }}
    >
      <span className="inline-flex items-center gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={64} className="h-8 w-40" aria-label="Machine label" />
        <Button type="submit" size="sm" disabled={rename.pending}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            rename.reset();
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </span>
      <InlineError message={rename.error} />
    </form>
  );
}

export function MachinesCard() {
  const me = useCurrentUserId();
  const machines = useQuery(api.machines.list, {});
  const users = useQuery(api.users.list, {});
  const now = useNow();
  const names = new Map((users ?? []).map((u) => [u.userId as string, u.name]));
  const columns: Column<MachineRow>[] = [
    { key: "label", header: "Machine", render: (m) => (m.userId === me ? <RenameCell machine={m} /> : m.label) },
    { key: "owner", header: "Owner", render: (m) => names.get(m.userId as string) ?? "—" },
    { key: "platform", header: "Platform", render: (m) => `${m.platform}${m.arch ? ` · ${m.arch}` : ""}` },
    {
      key: "codex",
      header: "Codex",
      render: (m) => (
        <span className="inline-flex items-center gap-1.5">
          {m.codexVersion ?? "—"}
          {m.codexLatestVersion && m.codexVersion && m.codexLatestVersion !== m.codexVersion ? (
            <span className="text-xs text-muted-foreground">(latest {m.codexLatestVersion})</span>
          ) : null}
          {isNewerThanTested(m.codexVersion) ? (
            <Badge variant="outline" className="rounded-full text-[10px]" title={`Parser tested with Codex ${TESTED_CODEX_VERSION}`}>
              untested version
            </Badge>
          ) : null}
        </span>
      ),
    },
    { key: "cli", header: "Collector", render: (m) => m.cliVersion },
    { key: "host", header: "Hostname", render: (m) => m.hostname ?? "hidden" },
    { key: "sync", header: "Last sync", align: "right", render: (m) => (now === null ? "—" : formatRelative(m.lastSyncAt, now)) },
  ];
  return (
    <SectionCard title="Machines" description="Every machine that has synced. You can rename your own; hostnames appear only when the collector was logged in with --hostname.">
      {machines === undefined ? (
        <Skeleton className="h-24" />
      ) : machines.length === 0 ? (
        <EmptyState title="No machines have synced yet" />
      ) : (
        <DataTable columns={columns} rows={machines} rowKey={(m) => m.machineId} />
      )}
    </SectionCard>
  );
}
```

`web/src/components/settings/prices-card.tsx`:
```tsx
"use client";

import { MAX_QUERY_RANGE_DAYS } from "@shared/constants";
import { addDays } from "@shared/days";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { PriceRow } from "@convex/lib/types";
import { EmptyState } from "@/components/primitives/empty-state";
import { InlineError } from "@/components/primitives/inline-error";
import { SectionCard } from "@/components/primitives/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAsyncAction } from "@/hooks/use-async-action";
import { useStableQuery } from "@/hooks/use-stable-query";
import { useToday } from "@/hooks/use-today";
import { parsePrice } from "@/lib/prices";

type Draft = { model: string; input: string; cached: string; output: string };

function PriceEditor({
  draft,
  onChange,
  onSave,
  onRemove,
  modelEditable,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  onSave: () => void;
  onRemove?: () => void;
  modelEditable: boolean;
}) {
  const input = parsePrice(draft.input);
  const cached = parsePrice(draft.cached);
  const output = parsePrice(draft.output);
  const valid = draft.model.trim().length > 0 && input !== null && cached !== null && output !== null;
  const field = (key: "input" | "cached" | "output", label: string) => (
    <TableCell className="text-right">
      <Input
        inputMode="decimal"
        aria-label={`${label} price for ${draft.model || "new model"}`}
        value={draft[key]}
        onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
        className="h-8 w-24 text-right font-mono tabular"
        aria-invalid={parsePrice(draft[key]) === null}
      />
    </TableCell>
  );
  return (
    <TableRow>
      <TableCell>
        {modelEditable ? (
          <Input aria-label="Model name" placeholder="model name" value={draft.model} onChange={(e) => onChange({ ...draft, model: e.target.value })} className="h-8 w-48 font-mono" />
        ) : (
          <code className="font-mono text-xs">{draft.model}</code>
        )}
      </TableCell>
      {field("input", "Input")}
      {field("cached", "Cached input")}
      {field("output", "Output")}
      <TableCell className="text-right whitespace-nowrap">
        <Button size="sm" disabled={!valid} onClick={onSave}>
          Save
        </Button>
        {onRemove ? (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function toDraft(p: PriceRow): Draft {
  return { model: p.model, input: String(p.inputUsdPerMTok), cached: String(p.cachedInputUsdPerMTok), output: String(p.outputUsdPerMTok) };
}

export function PricesCard() {
  const prices = useQuery(api.prices.list, {});
  const upsert = useMutation(api.prices.upsert);
  const removePrice = useMutation(api.prices.remove);
  const today = useToday();
  // The server already reports which models had tokens but no price row (contracts §9), so this
  // is a summary over the widest legal window, not the far heavier `stats.breakdowns`.
  const { data: seen } = useStableQuery(
    api.stats.summary,
    today ? { from: addDays(today, -(MAX_QUERY_RANGE_DAYS - 1)), to: today, previous: false } : "skip",
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [added, setAdded] = useState<Draft | null>(null);

  const save = useAsyncAction(async (draft: Draft) => {
    await upsert({
      model: draft.model.trim(),
      inputUsdPerMTok: parsePrice(draft.input)!,
      cachedInputUsdPerMTok: parsePrice(draft.cached)!,
      outputUsdPerMTok: parsePrice(draft.output)!,
    });
    setDrafts((d) => {
      const next = { ...d };
      delete next[draft.model];
      return next;
    });
    setAdded(null);
  });
  const remove = useAsyncAction(removePrice);

  const unpriced = seen ? [...seen.unpricedModels].sort() : [];

  return (
    <SectionCard
      title="Model prices"
      description="USD per million tokens (input, cached input, output). Reasoning tokens are billed as output. Edits re-price every visible period instantly."
      actions={
        <Button size="sm" variant="outline" onClick={() => setAdded({ model: "", input: "", cached: "", output: "" })} disabled={added !== null}>
          Add model
        </Button>
      }
      bodyClassName="flex flex-col gap-3"
    >
      <InlineError message={save.error ?? remove.error} />
      {unpriced.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Unpriced models seen:
          {unpriced.map((m) => (
            <Button key={m} size="sm" variant="outline" className="h-7 rounded-full" onClick={() => setAdded({ model: m, input: "", cached: "", output: "" })}>
              <Badge variant="secondary" className="rounded-full font-mono text-[10px]">
                {m}
              </Badge>
              add price
            </Button>
          ))}
        </div>
      ) : null}
      {prices === undefined ? (
        <Skeleton className="h-40" />
      ) : prices.length === 0 && added === null ? (
        <EmptyState title="No prices yet" description="Run `npx convex run prices:seed` or add models here." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Cached input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {added ? <PriceEditor draft={added} onChange={setAdded} onSave={() => void save.run(added)} modelEditable /> : null}
              {prices.map((p) => {
                const draft = drafts[p.model] ?? toDraft(p);
                return (
                  <PriceEditor
                    key={p._id}
                    draft={draft}
                    modelEditable={false}
                    onChange={(next) => setDrafts((d) => ({ ...d, [p.model]: next }))}
                    onSave={() => void save.run(draft)}
                    onRemove={() => void remove.run({ model: p.model })}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 5: Replace `web/src/app/(app)/settings/page.tsx`**

```tsx
"use client";

import { PageHeader } from "@/components/layout/page-header";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import { InstallCard } from "@/components/settings/install-card";
import { MachinesCard } from "@/components/settings/machines-card";
import { PricesCard } from "@/components/settings/prices-card";
import { SyncTokensCard } from "@/components/settings/sync-tokens-card";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" description="Sync tokens, collector install, machines and model prices." />
      <SectionErrorBoundary title="Tokens could not load">
        <SyncTokensCard />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Install instructions could not load">
        <InstallCard />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Machines could not load">
        <MachinesCard />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Prices could not load">
        <PricesCard />
      </SectionErrorBoundary>
    </div>
  );
}
```

- [ ] **Step 6: Run the test, typecheck, lint and check in the browser**

Run: `cd web && npx vitest run --project unit src/lib/prices.test.ts && cd .. && npm run typecheck -w web && npm run lint -w web`
Expected: PASS; typecheck and lint exit 0. In the browser at `/settings`:
- create a token, copy the login line, close the dialog: the table shows the new token as `Active`; revoke it: `Revoked`; a CLI logged in with it gets 401 on the next `codex-kaboo sync` (verified in Task 32).
- the install tabs show four numbered commands per OS with the OS note.
- rename your machine: the label updates in the table and in the Data Sync card.
- edit `gpt-5.6-sol` output price and save: the Home `Estimated cost` card changes without a reload; `Add model` + `Save` inserts a row; `Remove` deletes it; a model seen without a price shows the `add price` chip.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/prices.ts web/src/lib/prices.test.ts web/src/components/settings "web/src/app/(app)/settings/page.tsx"
git commit -m "$(cat <<'MSG'
Add settings page with install steps, machine renaming and editable prices

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 29: CLI packaging — `web/scripts/pack-cli.mjs`, the `prebuild` hook and the `/cli/*` download

**Files:**
- Create: `web/scripts/pack-cli.mjs`
- Modify: `web/package.json` (`prebuild` script)
- Verify: `.gitignore` already ignores `web/public/cli/`

**Interfaces:**
- Consumes: Plan 1's `cli/` package (`npm run build -w cli` produces `cli/dist/codex-kaboo.js`; tsup bakes the `version` field of `cli/package.json` into `codex-kaboo --version`, and the build-time env `CODEX_KABOO_SERVER` / `CODEX_KABOO_WEB_ORIGIN`).
- Produces: `web/public/cli/codex-kaboo-cli.tgz`, `web/public/cli/codex-kaboo-cli-<version>.tgz`, `web/public/cli/version.json` (`{ version, builtAt, commit }`); Convex env `LATEST_CLI_VERSION` set when `CONVEX_DEPLOY_KEY` is present; the stamped CLI version `<base>-build.<yyyymmddHHmm>.<sha7>`.

- [ ] **Step 1: Create `web/scripts/pack-cli.mjs`**

```js
#!/usr/bin/env node
// Builds the collector CLI, packs it into web/public/cli/, writes version.json and, during a
// Vercel production build (CONVEX_DEPLOY_KEY present), advertises the version to Convex.
// The version is stamped by temporarily rewriting cli/package.json; the file is always restored.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function commitSha() {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return capture("git", ["rev-parse", "--short=7", "HEAD"]).trim();
  } catch {
    return "local";
  }
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}`;
}

const original = readFileSync(cliPkgPath, "utf8");
const pkg = JSON.parse(original);
const base = String(pkg.version).split("-")[0];
const sha = commitSha();
const now = new Date();
const version = `${base}-build.${stamp(now)}.${sha}`;

if (!process.env.CODEX_KABOO_SERVER) {
  console.warn("[pack-cli] CODEX_KABOO_SERVER is not set; the packed CLI will need `--server` at login.");
}

try {
  writeFileSync(cliPkgPath, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
  passthrough(npm, ["run", "build", "-w", "cli"]);
  const tmp = mkdtempSync(path.join(tmpdir(), "codex-kaboo-pack-"));
  const packed = JSON.parse(capture(npm, ["pack", "-w", "cli", "--json", "--pack-destination", tmp]));
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
```

- [ ] **Step 2: Add the `prebuild` script to `web/package.json`**

Edit the `scripts` object so it contains `"prebuild": "node scripts/pack-cli.mjs"` next to the existing `"build": "next build"`.
Run: `node -e "console.log(require('./web/package.json').scripts.prebuild)"`
Expected: `node scripts/pack-cli.mjs`

- [ ] **Step 3: Run the packer locally and verify the artifacts**

Run:
```bash
grep -n "web/public/cli/" .gitignore && CODEX_KABOO_SERVER="$(grep NEXT_PUBLIC_CONVEX_URL web/.env.local | cut -d= -f2 | sed 's/convex.cloud/convex.site/')" node web/scripts/pack-cli.mjs && ls web/public/cli && cat web/public/cli/version.json && tar -tzf web/public/cli/codex-kaboo-cli.tgz | grep -c "package/dist/codex-kaboo.js" && git status --short cli/package.json
```
Expected: the gitignore line prints; the packer logs `packed codex-kaboo-cli-<v>.tgz as <base>-build.<stamp>.<sha7>`; `ls` shows `codex-kaboo-cli.tgz`, `codex-kaboo-cli-<version>.tgz` and `version.json`; the tar contains `package/dist/codex-kaboo.js` (count `1`); `git status` prints nothing for `cli/package.json` (restored).

- [ ] **Step 4: Verify the download route and the installed version**

Run (with `npm run dev -w web` running):
```bash
curl -sI http://localhost:3000/cli/codex-kaboo-cli.tgz | head -1 && npm install -g ./web/public/cli/codex-kaboo-cli.tgz && codex-kaboo --version
```
Expected: `HTTP/1.1 200 OK` (no redirect to sign-in); the global install succeeds; `codex-kaboo --version` prints the stamped version from `version.json`.

- [ ] **Step 5: Run a production build once to prove `prebuild` chains**

Run: `npm run build -w web 2>&1 | tail -20`
Expected: the log starts with `[pack-cli] packed …`, then `next build` completes with the routes `/`, `/users/[userId]`, `/settings`, `/sign-in/[[...sign-in]]`, `/sign-up/[[...sign-up]]` and no `useSearchParams` Suspense error.

- [ ] **Step 6: Commit**

```bash
git add web/scripts/pack-cli.mjs web/package.json
git commit -m "$(cat <<'MSG'
Pack the collector CLI into public/cli during the web build

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 30: README — setup, per-OS install, privacy and troubleshooting

**Files:**
- Modify: `README.md` (replace)

**Interfaces:**
- Consumes: the commands from contracts §10, the env names from §11, the CLI commands from Plan 1 (`login`, `sync`, `install`, `uninstall`, `status`, `doctor`, `logout`).
- Produces: the repository README used as the hand-off document.

- [ ] **Step 1: Replace `README.md`**

````markdown
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

Uploaded: token counts per model response, model names and reasoning efforts, tool kinds, skill
names, the **basename** of the project folder, git branch names, timestamps and durations,
counts of added/removed lines, Codex and collector versions, platform/arch and the machine label
you choose. Never uploaded: prompts, responses, command strings, file paths, diff contents,
repository URLs, hostnames (unless you opt in with `--hostname`). `codex-kaboo sync --dry-run --json`
prints the exact payload so you can audit it.

## Install the collector

Create a sync token on the dashboard (**Settings → Sync tokens → New token**), then on each
machine where you use Codex:

```bash
npm install -g https://<your-dashboard>/cli/codex-kaboo-cli.tgz   # npm 12+: add --allow-remote=all
codex-kaboo login --token <token>
codex-kaboo install
codex-kaboo status
```

Requires Node 18 or newer (22.15+ recommended: it reads Codex's `.jsonl.zst` archives too).
Re-running the install command upgrades the collector in place.

### macOS
`codex-kaboo install` registers a launchd agent (`com.codex-kaboo.sync`) that runs every 15
minutes and runs one sync immediately. Check it with `launchctl list | grep codex-kaboo`.
If you upgrade Node with nvm/fnm, run `codex-kaboo install` again (the agent pins the Node path;
`codex-kaboo status` reports "schedule broken" when it moved).

### Linux
`codex-kaboo install` adds a crontab block (`# BEGIN codex-kaboo` … `# END codex-kaboo`);
`codex-kaboo install --systemd` uses a user timer instead. If `npm install -g` fails with
`EACCES`, use nvm/fnm or `npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to
`PATH`. Please run `codex-kaboo doctor` after installing and report anything red — Linux is
covered by unit tests only.

### Windows
`codex-kaboo install` creates the scheduled task `codex-kaboo-sync` (every 15 minutes, hidden
window, no password prompt). Make sure `%AppData%\npm` is on `PATH`, and in PowerShell allow npm
scripts with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Please run `codex-kaboo doctor`
and report anything red — Windows is covered by unit tests only.

### Commands
| Command | What it does |
|---|---|
| `codex-kaboo login [--token T] [--server URL] [--machine-name NAME] [--hostname]` | Stores the token in `~/.codex-kaboo/config.json` (mode 0600) after checking it with `/api/v1/whoami` |
| `codex-kaboo sync [--full] [--dry-run] [--scheduled] [--codex-home PATH]` | Parses changed rollout files and uploads new data; `--dry-run --json` prints the payload without network |
| `codex-kaboo install [--systemd]` / `uninstall` | Registers / removes the 15-minute schedule |
| `codex-kaboo status` / `doctor` | Config, Codex homes, last sync, scheduler health / environment checks |
| `codex-kaboo logout` | Removes the token |

State lives in `~/.codex-kaboo/` (`CODEX_KABOO_HOME` overrides it); the Codex home is
`CODEX_HOME` or `~/.codex`.

## Dashboard

- **Insights** (`/`): range pill (Today / 7 / 30 / 90 days / All time / custom), Volume and
  Efficiency cards with change vs. the previous period, the shared weekly quota gauge, Users
  (podium + ranked table), Models, Tools, Projects and Skills, token trend by user and by model.
- **My Page** (`/users/<id>`): rank, 13 stat cards, 12-month activity heatmap, token trend
  (tokens / cost / hours), Data Sync (your machines and the install commands), Breakdown
  (time analysis + weekday × hour heatmap + tables), Efficiency (cost structure, cache savings,
  cost per line, per-model pricing), Sessions (newest first).
- **Settings**: sync tokens, install instructions, machines (rename), model prices (USD per
  million tokens; edits re-price everything instantly).

Cost is an **estimate at API list prices** (the account is billed by subscription); models
without a price row show as "unpriced" and contribute $0.

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
(= the dashboard URL). The build packs the collector into `/cli/codex-kaboo-cli.tgz` and sets
`LATEST_CLI_VERSION` on the Convex deployment so the CLI can hint about upgrades. The Convex
production deployment needs `CLERK_FRONTEND_API_URL` and a one-time `npx convex run prices:seed --prod`.

Anyone who can sign in sees everything. Once the three accounts exist, switch the Clerk
instance to restricted sign-ups (Clerk → User & Authentication → Restrictions).

## Layout

- `shared/` — sync payload schema (zod), day math and metric helpers used by the CLI, backend and UI.
- `cli/` — the collector (`codex-kaboo`), bundled into one file by tsup.
- `web/` — Next.js dashboard; `web/convex/` — Convex schema, HTTP sync endpoint and queries.
- `docs/superpowers/specs/` — the design spec; `docs/superpowers/plans/` — implementation plans.
````

- [ ] **Step 2: Check the README renders and mentions every command**

Run: `grep -c "codex-kaboo" README.md && grep -n "allow-remote=all\|%AppData%\|EACCES\|doctor" README.md | head`
Expected: a count above 20 and one hit for each of the four grep terms.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'MSG'
Document setup, per-OS collector install, privacy and deployment in the README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
```

---

### Task 31: Deploy — Convex production, Vercel project (Root Directory `web`), env vars, first production build

**Files:**
- Create: `web/vercel.json`
- Uses: `.vercel/project.json` (created by `vercel link`, git-ignored), `web/.env.local` (git-ignored)

**Interfaces:**
- Consumes: Plan 2's Convex functions (`prices:seed`, `/api/v1/health`), the Clerk keys and Frontend API URL supplied by the user, the Vercel CLI (authenticated as `yining044-2988`) and the Convex CLI (authenticated).
- Produces: a production Convex deployment with `CLERK_FRONTEND_API_URL` and seeded prices; a Vercel project `codex-kaboo` with Root Directory `web`, the six environment variables and a successful production deployment at `https://<project>.vercel.app`.

Steps marked **(user)** need the user's Clerk dashboard access or keys and cannot be automated.

- [ ] **Step 1 (user): Clerk instance for production**

Clerk production instances require a verified custom domain, and the dashboard runs on `*.vercel.app`, so v1 runs the **Clerk development instance** in production (Clerk shows a small "Development mode" badge on the sign-in card; limits are far above three users). The user provides: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_…`), `CLERK_SECRET_KEY` (`sk_test_…`) and the Frontend API URL (`https://<slug>.clerk.accounts.dev`, shown under Clerk → Configure → Developers → API keys), with the **Convex integration activated** (Clerk → Configure → Integrations → Convex; fallback: a JWT template named `convex`). Moving to a Clerk production instance later only means new keys plus a custom domain; no code changes.

- [ ] **Step 2: Create the Convex production deployment and configure it**

Run (from `web/`):
```bash
cd web && npx convex deploy -y 2>&1 | tail -5
```
Expected: `✔ Deployed Convex functions to https://<prod-name>.convex.cloud`. Record `<prod-name>`; the HTTP origin used by the CLI is `https://<prod-name>.convex.site`.

Then:
```bash
npx convex env set CLERK_FRONTEND_API_URL "https://<slug>.clerk.accounts.dev" --prod && npx convex run prices:seed --prod && curl -sS https://<prod-name>.convex.site/api/v1/health
```
Expected: env set confirmation; `{ inserted: 14 }` (or `{ inserted: 0 }` on a re-run); `{"ok":true,"serverTime":…}`.

- [ ] **Step 3 (user): Production deploy key**

In the Convex dashboard → project → **Production** deployment → Settings → Deploy keys → "Generate production deploy key". Paste it when Step 6 asks for `CONVEX_DEPLOY_KEY`. Never commit it.

- [ ] **Step 4: Create `web/vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "npx convex deploy --cmd \"npm run build\""
}
```
`npx convex deploy` (authenticated by `CONVEX_DEPLOY_KEY`) first runs `npm run build` with `NEXT_PUBLIC_CONVEX_URL` injected — `prebuild` packs the CLI and sets `LATEST_CLI_VERSION` — then pushes the Convex functions.

- [ ] **Step 5: Link the Vercel project and set Root Directory to `web`**

Run (from the repo root):
```bash
vercel link --yes --project codex-kaboo && cat .vercel/project.json
```
Expected: `Linked to yining044-2988/codex-kaboo`; the JSON shows `projectId` and `orgId`.

Set the Root Directory through the REST API (the CLI cannot set it), without printing the token:
```bash
PROJECT_ID=$(node -p "require('./.vercel/project.json').projectId") && ORG_ID=$(node -p "require('./.vercel/project.json').orgId") && node -e '
const fs = require("fs");
const auth = JSON.parse(fs.readFileSync(process.env.HOME + "/Library/Application Support/com.vercel.cli/auth.json", "utf8"));
const token = auth.token;
if (!token) { console.error("no token in auth.json; set Root Directory in the dashboard instead"); process.exit(2); }
fetch(`https://api.vercel.com/v9/projects/${process.argv[1]}?teamId=${process.argv[2]}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ rootDirectory: "web" }),
}).then(async (r) => { const j = await r.json(); console.log(r.status, "rootDirectory =", j.rootDirectory); process.exit(r.ok ? 0 : 1); });
' "$PROJECT_ID" "$ORG_ID"
```
Expected: `200 rootDirectory = web`. If it prints `no token in auth.json` or a 403, the user sets it in the Vercel dashboard (Project → Settings → General → Root Directory → `web` → Save; leave "Include source files outside of the Root Directory" enabled — it is required to build `../cli` and `../shared`).

- [ ] **Step 6: Add the production environment variables**

Run each line, pasting the value when prompted (the values come from Steps 1–3; `vercel env add` reads the value from stdin):
```bash
printf '%s' "<deploy key from Step 3>" | vercel env add CONVEX_DEPLOY_KEY production
printf '%s' "pk_test_…" | vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
printf '%s' "sk_test_…" | vercel env add CLERK_SECRET_KEY production
printf '%s' "/sign-in" | vercel env add NEXT_PUBLIC_CLERK_SIGN_IN_URL production
printf '%s' "https://<prod-name>.convex.site" | vercel env add CODEX_KABOO_SERVER production
printf '%s' "https://codex-kaboo.vercel.app" | vercel env add CODEX_KABOO_WEB_ORIGIN production
vercel env ls production
```
Expected: the listing shows the six names for `Production` (the six from contracts §11; the sign-up URL is set by `<ClerkProvider signUpUrl="/sign-up">` in code, not by an env var). (The exact `*.vercel.app` hostname is printed by `vercel link`/the first deploy; if it differs from `codex-kaboo.vercel.app`, rerun the last `env add` with `vercel env rm CODEX_KABOO_WEB_ORIGIN production` first.)

- [ ] **Step 7: Commit the Vercel config and push**

```bash
git add web/vercel.json
git commit -m "$(cat <<'MSG'
Add the Vercel build configuration for the web workspace

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)"
git push origin main
```

- [ ] **Step 8: Deploy to production and read the build log**

Run: `vercel --prod 2>&1 | tail -30`
Expected: the log contains `[pack-cli] packed codex-kaboo-cli-…`, `LATEST_CLI_VERSION set on the Convex deployment`, the Next.js route table, `Deployed Convex functions`, and ends with `Production: https://codex-kaboo.vercel.app`.
If the build fails with `Cannot find module '@codex-kaboo/shared'` or `npm ERR! ... workspace`, add `"installCommand": "cd .. && npm ci"` to `web/vercel.json`, commit it with the message `Install workspaces from the repo root on Vercel` (same trailers), and run `vercel --prod` again.

- [ ] **Step 9: Smoke the production URL**

Run:
```bash
curl -sI https://codex-kaboo.vercel.app/ | head -1 && curl -sI https://codex-kaboo.vercel.app/cli/codex-kaboo-cli.tgz | head -1 && curl -s https://codex-kaboo.vercel.app/cli/version.json
```
Expected: `HTTP/2 307` (redirect to sign-in), `HTTP/2 200` for the tarball, and the JSON with the stamped version.

---

### Task 32: Verify in production, first real sync from this Mac, hand-off checklist

**Files:**
- Modify: `README.md` only if a verified command differs from what it documents.

**Interfaces:**
- Consumes: the production dashboard (Task 31), the collector CLI from Plan 1, this Mac's `~/.codex` logs.
- Produces: verified end-to-end flow and the hand-off list for the user.

- [ ] **Step 1: Sign in and create a token**

Open `https://codex-kaboo.vercel.app`, sign in with the user's Clerk account. Expected: Insights shows the "Install the collector" onboarding card, empty stat cards, and `No quota data yet`. Go to Settings → New token (name `Johnny's Mac`), copy the token from the dialog.

- [ ] **Step 2: Install the packed CLI from production and start syncing**

Run:
```bash
npm install -g https://codex-kaboo.vercel.app/cli/codex-kaboo-cli.tgz && codex-kaboo --version && codex-kaboo login --token "<token from Step 1>" --machine-name "johnny-mac" && codex-kaboo sync --dry-run --json | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const out = JSON.parse(s);
  const text = JSON.stringify(out);
  const leaks = ["/Users/", "\\\\Users\\\\", "\"command\":", "unified_diff", "stdout"].filter((k) => text.includes(k));
  console.log("sessions:", out.sessions.length, "events:", out.tokenEvents.length, "leaks:", leaks.length ? leaks : "none");
});' && codex-kaboo install && launchctl list | grep codex-kaboo && codex-kaboo status
```
Expected: the stamped version; `Logged in as <name>`; the dry run prints exactly the session and event counts printed by `codex-kaboo sync --dry-run --json` run just before this step (426 events across 11 sessions at the time of writing) with `leaks: none`; `install` registers `com.codex-kaboo.sync` and runs one sync; `launchctl list` shows the agent; `status` shows the last sync as OK with the inserted counts and a healthy schedule. (If Plan 1's `--dry-run --json` output nests the batches under another key, adapt the two field names in the one-liner to its documented shape.)

- [ ] **Step 3: Check the dashboard against the CLI**

- Insights `?range=ALL`: Total tokens equals the sum of `total` over the dry-run events; Sessions equals the number of non-sub-agent sessions; the leaderboard shows one user at `#1 / 1`; the quota gauge shows a percentage with "as of just now · johnny-mac".
- My Page → Data Sync: the machine row shows the Codex version and `Last sync: just now`. Run `launchctl kickstart -k gui/$(id -u)/com.codex-kaboo.sync`, wait ~10 s and reload: the time updates and `codex-kaboo status` reports the run made no upload (nothing changed).
- Settings → Model prices: change `gpt-5.6-sol` output price, save; the Estimated cost card on Insights changes without a reload; restore the price.
- Settings → Sync tokens: revoke the token; run `codex-kaboo sync`; expected exit code 2 and the message telling you to run `codex-kaboo login`. Create a new token, `codex-kaboo login --token …`, `codex-kaboo sync`: expected `unchanged` for everything.

- [ ] **Step 4: Confirm CI is green on the pushed commit**

Run: `gh run list --limit 1 && gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status`
Expected: the latest workflow run on `main` completes with `✓`.

- [ ] **Step 5: Hand-off notes for the user (put them in the final message, not in the repo)**

- **(user)** Clerk → User & Authentication → Restrictions → Sign-up mode "Restricted" once the three accounts exist; invite the other two people from Clerk → Users → Invite (they sign up at `https://codex-kaboo.vercel.app/sign-up`).
- **(user)** Ask the first Linux and Windows users to run `codex-kaboo doctor` after installing and report anything red; their scheduler paths are covered by unit tests only.
- The Clerk development instance runs in production (Step 1 of Task 31); switching to a production instance needs a custom domain.
- Keep `CONVEX_DEPLOY_KEY` and `CLERK_SECRET_KEY` only in Vercel; `web/.env.local` stays git-ignored.
- Follow-ups not in v1 (from the spec): quota history chart, dark mode QA, Playwright smoke tests, CSV export, per-machine data deletion.

- [ ] **Step 6: Commit any README correction and push**

```bash
git status --short
git add README.md
git commit -m "$(cat <<'MSG'
Correct README commands verified against production

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q8G1yVYF1rfbje5mJGvMVt
MSG
)" || echo "nothing to commit"
git push origin main
```

---

## Self-review notes (kept for the executor)

- Every Convex function used here exists in contracts §9 with these argument shapes: `users.ensure {}`, `users.me {}`, `users.list {}`, `stats.summary { from, to, userId?, previous? }`, `stats.leaderboard { from, to, previous? }`, `stats.trends { from, to, bucket, userId? }`, `stats.breakdowns { from, to, userId? }`, `stats.activityHeatmap { userId, from, to }`, `stats.dayHourHeatmap { from, to, userId? }`, `stats.quota {}`, `stats.bounds { userId? }`, `sessions.listRecent { userId?, paginationOpts }`, `syncTokens.list {}`, `syncTokens.create { name }`, `syncTokens.revoke { tokenId }`, `machines.list { userId? }`, `machines.rename { machineId, label }`, `prices.list {}`, `prices.upsert { model, inputUsdPerMTok, cachedInputUsdPerMTok, outputUsdPerMTok }`, `prices.remove { model }`.
- Type names used across tasks: `ResolvedRange`/`RangeParams`/`Preset` (Task 4), `Section`/`View`/`Tab` (Task 5), `ColorMap` (Task 6), `MetricKind`/`GoodDirection`/`MetricDef` (Task 7), `Stacked`/`SeriesDef`/`ChartRow`/`Segment`/`TrendMetric` (Task 8), `ActivityGrid`/`ActivityCell`/`HeatLevel` (Task 9), `InstallOs`/`InstallStep` (Task 10), `ModelTableRow` (Task 21), `Column<T>`/`BarScale`/`PodiumEntry` (Task 13), `TrendVariant` (Task 16), `LeaderMetric` (Task 20).
- Recharts is only mounted in the browser (`TrendChart`); every jsdom test targets pure transforms, HTML/CSS/SVG components or the table view.
