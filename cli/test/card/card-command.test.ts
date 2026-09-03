import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SummaryResponse } from "@codex-kaboo/shared/summary";
import { formatCard, localQuota, pickQuota, runCard, type CardDeps } from "../../src/commands/card";
import { writeConfig } from "../../src/core/config";
import { kabooPaths } from "../../src/core/paths";
import { writeState } from "../../src/core/state";
import { SyncHttpError, SyncNetworkError, type SyncClient } from "../../src/upload/client";
import { FIXTURE_HOME } from "../fixture-ids";

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const TODAY = "2026-09-03";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function range(total: number, over: Partial<SummaryResponse["ranges"]["day"]> = {}) {
  const output = Math.round(total / 6);
  return {
    range: { from: TODAY, to: TODAY },
    previousRange: null,
    tokens: {
      input: total - output,
      cachedInput: Math.round((total - output) / 2),
      cacheWrite: 0,
      output,
      reasoning: 0,
      total,
    },
    costUsd: 1.25,
    unpricedModels: [] as string[],
    sessions: 3,
    changePercent: 0.1,
    topModel: "gpt-5.6-sol",
    ...over,
  };
}

function summaryBody(over: Partial<SummaryResponse> = {}): SummaryResponse {
  return {
    ok: true,
    serverTime: NOW,
    today: TODAY,
    user: { userId: "u1", name: "Alice" },
    ranges: {
      day: range(1200),
      week: range(6000),
      month: range(24_000),
      all: range(1_510_000_000),
    },
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
    ...over,
  };
}

function fakeClient(over: Partial<SyncClient> = {}): SyncClient {
  return {
    async sync() {
      throw new Error("not used");
    },
    async whoami() {
      throw new Error("not used");
    },
    async summary() {
      return summaryBody();
    },
    async health() {
      return { ok: true, serverTime: NOW };
    },
    ...over,
  };
}

async function setup(opts: { loggedIn?: boolean } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ck-card-"));
  tmpDirs.push(root);
  const paths = kabooPaths(path.join(root, "kaboo"));
  if (opts.loggedIn !== false) {
    await writeConfig(paths, {
      server: "https://x.convex.site",
      token: "ck_alice0000",
      machineId: "m-1",
      label: "brisk-otter",
      hostnameOptIn: false,
      codexHomes: [],
      userId: "u1",
      userName: "Alice",
    });
  }
  const summaryCalls: (string | undefined)[] = [];
  const deps: CardDeps = {
    paths,
    env: {},
    now: () => NOW,
    cliVersion: "0.1.0",
    machineZone: "UTC",
    platform: "darwin",
    createClient: () =>
      fakeClient({
        async summary(today) {
          summaryCalls.push(today);
          return summaryBody();
        },
      }),
  };
  // The fixture home has no rollout file recent enough to sample, which is exactly the quiet-card
  // case; tests that care about live numbers cover it in sampler.test.ts.
  const options = { json: true, codexHome: FIXTURE_HOME };
  return { paths, deps, options, summaryCalls };
}

describe("runCard", () => {
  it("fetches the summary for the machine's own day and reports it", async () => {
    const { deps, options, summaryCalls } = await setup();
    const report = await runCard(options, deps);

    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.source).toBe("server");
    expect(report.today).toBe(TODAY);
    expect(summaryCalls).toEqual([TODAY]); // the server must not guess the day in UTC
    expect(report.account).toEqual({ userId: "u1", name: "Alice" });
    expect(report.ranges?.all.tokens.total).toBe(1_510_000_000);
    expect(report.ageMs).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("caches the response and serves it when the network is gone", async () => {
    const { paths, deps, options } = await setup();
    await runCard(options, deps);
    expect(readFileSync(paths.cardSnapshot, "utf8")).toContain("1510000000");

    const offlineDeps: CardDeps = {
      ...deps,
      now: () => NOW + 4 * 60_000,
      createClient: () =>
        fakeClient({
          async summary() {
            throw new SyncNetworkError("network error: getaddrinfo ENOTFOUND", null);
          },
        }),
    };
    const report = await runCard(options, offlineDeps);

    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(0); // a stale card is still a card
    expect(report.source).toBe("cache");
    expect(report.ranges?.all.tokens.total).toBe(1_510_000_000);
    expect(report.ageMs).toBe(4 * 60_000);
    expect(report.errors).toEqual([expect.stringContaining("network error")]);
  });

  it("--offline never calls the server", async () => {
    const { deps, options } = await setup();
    await runCard(options, deps);

    let called = false;
    const report = await runCard(
      { ...options, offline: true },
      {
        ...deps,
        createClient: () =>
          fakeClient({
            async summary() {
              called = true;
              return summaryBody();
            },
          }),
      },
    );
    expect(called).toBe(false);
    expect(report.source).toBe("cache");
  });

  it("fails cleanly when there is nothing cached and no network", async () => {
    const { deps, options } = await setup();
    const report = await runCard(options, {
      ...deps,
      createClient: () =>
        fakeClient({
          async summary() {
            throw new SyncNetworkError("network error: offline", null);
          },
        }),
    });
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.source).toBe("none");
    expect(report.ranges).toBeNull();
    expect(formatCard(report)).toContain(
      "  no totals: the server could not be reached and nothing is cached",
    );
  });

  it("points at `login` when the token is rejected", async () => {
    const { deps, options } = await setup();
    const report = await runCard(options, {
      ...deps,
      createClient: () =>
        fakeClient({
          async summary() {
            throw new SyncHttpError(401, "unauthorized", "unauthorized [HTTP 401]", null, null);
          },
        }),
    });
    expect(report.errors).toEqual([expect.stringContaining("codex-kaboo login")]);
  });

  it("never shows another account's cached numbers", async () => {
    const { paths, deps, options } = await setup();
    await runCard(options, deps);

    // A second login as someone else: same machine, same file, different identity.
    await writeConfig(paths, {
      server: "https://x.convex.site",
      token: "ck_bob00000000",
      machineId: "m-1",
      label: "brisk-otter",
      hostnameOptIn: false,
      codexHomes: [],
      userId: "u2",
      userName: "Bob",
    });
    const report = await runCard({ ...options, offline: true }, { ...deps, now: () => NOW + 1000 });
    expect(report.source).toBe("none");
    expect(report.ranges).toBeNull();
  });

  it("rejects a corrupt cache instead of throwing", async () => {
    const { paths, deps, options } = await setup();
    writeFileSync(paths.cardSnapshot, "{not json");
    const report = await runCard({ ...options, offline: true }, deps);
    expect(report.source).toBe("none");
    expect(report.errors).toEqual([]);
  });

  it("does not rewrite the cache when the numbers have not changed", async () => {
    const { paths, deps, options } = await setup();
    await runCard(options, deps);
    const first = readFileSync(paths.cardSnapshot, "utf8");

    await runCard(options, { ...deps, now: () => NOW + 60_000 });
    // `fetchedAt` would have moved if the digest gate had not skipped the write.
    expect(readFileSync(paths.cardSnapshot, "utf8")).toBe(first);
  });

  it("still reports live numbers and quota when not logged in", async () => {
    const { deps, options, paths } = await setup({ loggedIn: false });
    await writeState(paths, {
      version: 1,
      parserVersion: 1,
      lastSyncAt: NOW - 600_000,
      lastSyncOk: true,
      lastError: null,
      lastHeartbeatAt: null,
      latestCliVersion: null,
      codexVersion: null,
      rateLimit: {
        observedAt: NOW - 120_000,
        usedPercent: 42,
        windowMinutes: 300,
        resetsAt: NOW + 3_600_000,
        planType: "prolite",
      },
      files: {},
    });

    const report = await runCard(options, deps);
    expect(report.exitCode).toBe(2);
    expect(report.ranges).toBeNull();
    expect(report.account).toBeNull();
    expect(report.quota.source).toBe("local");
    expect(report.quota.value?.usedPercent).toBe(42);
    expect(report.live.buckets.length).toBeGreaterThan(0);
    expect(formatCard(report)).toContain("  no totals: not logged in (run `codex-kaboo login`)");
  });

  it("prefers the server's account-wide quota over this machine's reading", async () => {
    const { deps, options, paths } = await setup();
    await writeState(paths, {
      version: 1,
      parserVersion: 1,
      lastSyncAt: NOW,
      lastSyncOk: true,
      lastError: null,
      lastHeartbeatAt: null,
      latestCliVersion: null,
      codexVersion: null,
      rateLimit: { observedAt: NOW, usedPercent: 99, windowMinutes: 300 },
      files: {},
    });
    const report = await runCard(options, deps);
    expect(report.quota.source).toBe("server");
    expect(report.quota.value?.usedPercent).toBe(7);
  });

  it("falls back to the local reading when the account has none", async () => {
    const { deps, options, paths } = await setup();
    await writeState(paths, {
      version: 1,
      parserVersion: 1,
      lastSyncAt: NOW,
      lastSyncOk: true,
      lastError: null,
      lastHeartbeatAt: null,
      latestCliVersion: null,
      codexVersion: null,
      rateLimit: { observedAt: NOW - 60_000, usedPercent: 12, windowMinutes: 10_080 },
      files: {},
    });
    const report = await runCard(options, {
      ...deps,
      createClient: () =>
        fakeClient({
          async summary() {
            return summaryBody({
              quota: { value: null, source: "none", fetchedAt: NOW, stale: false },
            });
          },
        }),
    });
    expect(report.quota.source).toBe("local");
    expect(report.quota.value?.usedPercent).toBe(12);
    expect(report.quota.value?.machine).toBeNull();
  });
});

describe("localQuota", () => {
  it("reports nothing rather than zero when no limit has been seen", () => {
    expect(localQuota(null, NOW)).toEqual({
      value: null,
      source: "none",
      fetchedAt: NOW,
      stale: false,
    });
  });

  it("marks an hour-old reading stale", () => {
    const old = localQuota(
      { observedAt: NOW - 2 * 60 * 60 * 1000, usedPercent: 5, windowMinutes: 300 },
      NOW,
    );
    expect(old.stale).toBe(true);
    expect(old.value?.usedPercent).toBe(5);
  });
});

describe("pickQuota", () => {
  const local = localQuota({ observedAt: NOW, usedPercent: 1, windowMinutes: 300 }, NOW);
  const server = localQuota({ observedAt: NOW, usedPercent: 2, windowMinutes: 300 }, NOW);

  it("takes the server's reading when it has one", () => {
    expect(pickQuota(server, local).value?.usedPercent).toBe(2);
  });

  it("falls back when the server has nothing", () => {
    const empty = { value: null, source: "none" as const, fetchedAt: NOW, stale: false };
    expect(pickQuota(empty, local).value?.usedPercent).toBe(1);
    expect(pickQuota(null, local).value?.usedPercent).toBe(1);
  });
});
