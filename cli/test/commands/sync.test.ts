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
