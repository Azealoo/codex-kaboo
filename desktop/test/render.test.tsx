/**
 * Renders the card to static HTML for every state the main process can hand it.
 *
 * This is not a screenshot test and does not try to be one — the visual checks live in
 * `docs/menubar-acceptance.md`. What it catches is everything that would leave the popover blank in
 * someone's menu bar with no way to tell why: a component that throws on a missing range, a
 * formatter handed a null, an empty state that never renders. Those are exactly the failures a GUI
 * cannot report and a headless CI would otherwise never see.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { bucketize } from "@cli/card/buckets";
import type { CardReport } from "@cli/commands/card";
import { Card, type CardActions } from "../src/renderer/components/Card";
import type { CardState } from "../src/main/ipc";
import { DEFAULT_SETTINGS } from "../src/main/settings";

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);

const noop: CardActions = {
  refresh: () => undefined,
  syncNow: () => undefined,
  update: () => undefined,
  openDashboard: () => undefined,
  quit: () => undefined,
  toggleSettings: () => undefined,
};

function range(total: number) {
  const output = Math.round(total / 6);
  return {
    range: { from: "2026-09-03", to: "2026-09-03" },
    previousRange: { from: "2026-09-02", to: "2026-09-02" },
    tokens: {
      input: total - output,
      cachedInput: Math.round((total - output) * 0.996),
      cacheWrite: 0,
      output,
      reasoning: 0,
      total,
    },
    costUsd: 655.29,
    unpricedModels: ["codex-auto-review"],
    sessions: 12,
    changePercent: 0.1,
    topModel: "gpt-5.6-sol",
  };
}

function report(over: Partial<CardReport> = {}): CardReport {
  return {
    ok: true,
    generatedAt: NOW,
    today: "2026-09-03",
    cliVersion: "0.1.0",
    machine: { label: "brisk-otter", platform: "darwin" },
    account: { userId: "u1", name: "Alice" },
    server: "https://x.convex.site",
    source: "server",
    ranges: {
      day: range(1_510_000_000),
      week: range(3_000_000),
      month: range(12_000_000),
      all: range(1_510_000_000),
    },
    fetchedAt: NOW - 4 * 60_000,
    ageMs: 4 * 60_000,
    quota: {
      value: {
        usedPercent: 7,
        windowMinutes: 10_080,
        resetsAt: NOW + 5 * 86_400_000,
        planType: "prolite",
        limitId: "codex",
        observedAt: NOW - 60_000,
        receivedAt: NOW - 60_000,
        machine: { machineId: "m-1", label: "brisk-otter" },
      },
      source: "server",
      fetchedAt: NOW,
      stale: false,
    },
    live: bucketize(
      [
        { ts: NOW - 8000, output: 600, model: "gpt-5.6-sol", sessionId: "s1" },
        { ts: NOW - 20_000, output: 180, model: "gpt-5.6-luna", sessionId: "s2" },
      ],
      NOW,
    ),
    sampled: { homes: ["/home/x/.codex"], filesTracked: 2, filesRead: 2 },
    sync: { lastSyncAt: NOW - 300_000, lastSyncOk: true, lastError: null },
    errors: [],
    exitCode: 0,
    ...over,
  };
}

function state(over: Partial<CardState> = {}): CardState {
  return {
    report: report(),
    settings: DEFAULT_SETTINGS,
    sync: { state: "idle", lastError: null },
    refreshing: false,
    dashboardUrl: "https://kaboo.example.com",
    appVersion: "0.1.0",
    ...over,
  };
}

function render(value: CardState, showSettings = false): string {
  return renderToStaticMarkup(
    <Card state={value} now={NOW} showSettings={showSettings} actions={noop} />,
  );
}

describe("Card", () => {
  it("draws the headline numbers the screenshot promises", () => {
    const html = render(state());
    // The dashboard's own formatters, so a number on the card reads exactly as it does there:
    // one decimal on a compact count, no cents above $100.
    expect(html).toContain("1.5B"); // total tokens
    expect(html).toContain("+10.0%"); // change against the previous period
    expect(html).toContain("$655"); // estimated cost
    expect(html).toContain("Synced 4 min ago");
    expect(html).toContain("99.6%"); // cache hit rate
    expect(html).toContain("1 model unpriced"); // the cost is low by this model's share
    expect(html).toContain("Codex"); // the quota row
    expect(html).toContain("7%");
    expect(html).toContain("Resets in 5d");
    expect(html).toContain("2 active sessions");
    expect(html).toContain("Sync now");
  });

  it("shows the selected tab's numbers, not the day's", () => {
    const html = render(state({ settings: { ...DEFAULT_SETTINGS, range: "week" } }));
    expect(html).toContain("3M");
    expect(html).not.toContain("1.5B");
  });

  it("explains itself when there is no login", () => {
    const html = render(
      state({
        report: report({
          exitCode: 2,
          ok: false,
          account: null,
          ranges: null,
          server: null,
          fetchedAt: null,
          ageMs: null,
          source: "none",
          machine: { label: null, platform: "linux" },
          errors: ["not logged in (run `codex-kaboo login`)"],
        }),
      }),
    );
    expect(html).toContain("Not connected yet");
    expect(html).toContain("codex-kaboo login");
    // The live strip works without an account, and saying so is the point of showing it.
    expect(html).toContain("Tokens / second");
    // The raw error is not repeated below the empty state that already explains it.
    expect(html).not.toContain('class="notice"');
  });

  it("says why the quota row is blank instead of hiding it", () => {
    const html = render(
      state({
        report: report({ quota: { value: null, source: "none", fetchedAt: NOW, stale: false } }),
      }),
    );
    expect(html).toContain("Provider quota");
    expect(html).toContain("No reading yet");
  });

  it("falls back to this machine's quota reading, and labels it as such", () => {
    const html = render(
      state({
        report: report({
          quota: {
            value: {
              usedPercent: 42,
              windowMinutes: 300,
              resetsAt: NOW + 3_600_000,
              planType: null,
              limitId: null,
              observedAt: NOW - 120_000,
              receivedAt: null,
              machine: null,
            },
            source: "local",
            fetchedAt: NOW,
            stale: false,
          },
        }),
      }),
    );
    expect(html).toContain("42%");
    expect(html).toContain("this machine");
    expect(html).toContain("5h"); // the window, not the reset time
  });

  it("says the totals are missing rather than drawing zeros", () => {
    const html = render(
      state({
        report: report({ ranges: null, source: "none", fetchedAt: null, ageMs: null, exitCode: 1 }),
      }),
    );
    expect(html).toContain("No totals yet");
  });

  it("surfaces an error without hiding the numbers it still has", () => {
    const html = render(
      state({ report: report({ source: "cache", errors: ["network error: offline"] }) }),
    );
    expect(html).toContain("1.5B");
    expect(html).toContain("network error: offline");
  });

  it("renders an idle live strip without dividing by zero", () => {
    const html = render(state({ report: report({ live: bucketize([], NOW) }) }));
    expect(html).toContain("0 active sessions");
    expect(html).toContain("Max 20"); // the axis floor, so an idle chart does not rescale
  });

  it("reports a sync that is running, and one the lock turned away", () => {
    expect(render(state({ sync: { state: "running" } }))).toContain("Syncing…");
    const blocked = render(state({ sync: { state: "blocked", holder: "another sync (pid 42)" } }));
    expect(blocked).toContain("A scheduled sync is already running");
  });

  it("hides the dashboard link when the build did not carry a URL", () => {
    expect(render(state({ dashboardUrl: null }))).not.toContain("Dashboard");
  });

  it("renders the settings panel, and only offers the tray label on macOS", () => {
    const mac = render(state(), true);
    expect(mac).toContain("Start at login");
    expect(mac).toContain("Show today");
    expect(mac).toContain("codex-kaboo sync --dry-run --json"); // the privacy note

    const linux = render(
      state({ report: report({ machine: { label: "box", platform: "linux" } }) }),
      true,
    );
    expect(linux).toContain("Start at login");
    expect(linux).not.toContain("Show today");
  });

  it("survives a state with no report at all", () => {
    expect(() => render(state({ report: null }))).not.toThrow();
  });
});
