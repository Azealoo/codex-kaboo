import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLI_RUN_BUDGET_MS } from "@codex-kaboo/shared/constants";
import type { SyncBatch, SyncResponse } from "@codex-kaboo/shared/sync";
import { runSync, type SyncDeps } from "../../src/commands/sync";
import { writeConfig } from "../../src/core/config";
import { kabooPaths } from "../../src/core/paths";
import { readState } from "../../src/core/state";
import { SyncHttpError, SyncNetworkError, type SyncClient } from "../../src/upload/client";
import { silentLogger } from "../../src/util/log";
import { FIXTURE_HOME, FX } from "../fixture-ids";

const NOW = Date.UTC(2026, 8, 1, 12);

// Every mkdtempSync directory created by setup() is tracked here and removed in afterEach, so
// failed or repeated runs don't litter os.tmpdir().
const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

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
  tmpDirs.push(root);
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
  // Review finding: the dry-run branch returned before the heartbeat block, so in steady state —
  // nothing changed since the last sync, which is where a machine spends most of its life — the
  // audit reported `"batches": []` while a real run still POSTed a machine-only heartbeat carrying
  // the whole machine object, hostname included. The one payload a privacy-conscious user most
  // wants to inspect was the one the audit never showed (and check-dry-run.mjs treated an empty
  // batch list as a failure, so steady state could not be audited at all).
  it("reports the machine-only heartbeat a real run would still send when nothing changed", async () => {
    const s = await setup();
    const first = await runSync({ ...base, codexHome: s.codexHome }, s.deps); // steady state
    expect(first.exitCode).toBe(0);
    expect((await readState(s.paths)).state.lastHeartbeatAt).toBe(NOW);

    s.clock.now = NOW + 2 * 60 * 60 * 1000; // past HEARTBEAT_INTERVAL_MS: a real run would heartbeat
    const dry = await runSync({ ...base, dryRun: true, codexHome: s.codexHome }, { ...s.deps, createClient: () => { throw new Error("no network in dry-run"); } });
    expect(dry.heartbeat).toBe(true);
    expect(dry.uploads).toEqual({ sessions: 0, events: 0, requests: 1 });
    expect(dry.files.every((f) => f.action === "unchanged")).toBe(true);
    expect(dry.batches).toHaveLength(1);
    const shown = dry.batches![0]!;
    expect(shown.sessions).toEqual([]); // machine-only: no session or event data
    expect(shown.tokenEvents).toEqual([]);
    expect(shown.rateLimit).toBeUndefined(); // the real run already acked this snapshot
    expect(shown.machine).toMatchObject({ machineId: "m-1", label: "brisk-otter", platform: "darwin", hostname: null });
    // A dry run still writes nothing, so the real run below is still due.
    expect((await readState(s.paths)).state.lastHeartbeatAt).toBe(NOW);

    // The audit is only worth anything if it shows what the wire actually carries: the reported
    // payload must equal the one a real run at the same moment sends, batch identity aside.
    const real = await runSync({ ...base, codexHome: s.codexHome }, s.deps);
    expect(real.heartbeat).toBe(true);
    const sent = s.fake.batches[s.fake.batches.length - 1]!;
    const identity = (b: SyncBatch): unknown => ({ ...b, batchId: "-", sentAt: 0 });
    expect(identity(sent)).toEqual(identity(shown));

    // With `login --hostname`, the audit now shows the hostname the heartbeat carries.
    const t = await setup();
    await writeConfig(t.paths, { server: "https://x.convex.site", token: "ck_t", machineId: "m-2", label: "brisk-otter", hostnameOptIn: true, codexHomes: [] });
    await runSync({ ...base, codexHome: t.codexHome }, t.deps);
    t.clock.now = NOW + 2 * 60 * 60 * 1000;
    const opted = await runSync({ ...base, dryRun: true, codexHome: t.codexHome }, { ...t.deps, createClient: () => { throw new Error("no network in dry-run"); } });
    expect(opted.batches?.[0]?.machine.hostname).toBe("h");
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
  // Review finding (round 1): a non-final ack used to adopt the fully-parsed cursor
  // (offset/size/mtimeMs), so if a LATER batch for the same file then failed, the next run's
  // isUnchanged() saw a clean match (lastError was null) and skipped re-parsing forever — silently
  // dropping every event past what the successful chunk covered. Fixed by keeping the pre-run
  // cursor on a non-final ack and only raising lastUploadedSeq, so the file is always re-parsed
  // (and the still-unacked events re-derived) until its final batch actually lands.
  it("keeps a non-final ack's cursor unmoved so a later run resumes without losing or duplicating events", async () => {
    const s = await setup();
    const target = FX.paginatedCli; // the largest fixture file: its own upload needs several batches
    const limits = { maxEvents: 30, maxBytes: 3_500_000, maxSessions: 500 };
    let touches = 0;
    const flaky = fakeClient({
      fail: (b) => {
        if (!b.tokenEvents.some((e) => e.sessionId === target)) return null;
        touches += 1;
        return touches === 2 ? new SyncNetworkError("ECONNRESET", null) : null;
      },
    });

    const first = await runSync({ ...base, codexHome: s.codexHome }, { ...s.deps, createClient: () => flaky.client, batchLimits: limits });
    expect(first.exitCode).toBe(1);
    const touchingTarget = flaky.batches.filter((b) => b.tokenEvents.some((e) => e.sessionId === target));
    expect(touchingTarget.length).toBeGreaterThanOrEqual(2); // the successful first chunk, then the failed second
    const firstChunkSeqs = touchingTarget[0]!.tokenEvents.filter((e) => e.sessionId === target).map((e) => e.seq);
    const firstChunkLastSeq = Math.max(...firstChunkSeqs);
    expect(touchingTarget[0]!.sessions.some((sess) => sess.sessionId === target)).toBe(false); // not the file's final chunk

    const afterFirst = (await readState(s.paths)).state.files[target]!;
    expect(afterFirst.offset).toBe(0); // NOT advanced past what was actually acked
    expect(afterFirst.lastUploadedSeq).toBe(firstChunkLastSeq);
    expect(afterFirst.lastError).toBeNull();

    const second = await runSync({ ...base, codexHome: s.codexHome }, { ...s.deps, createClient: () => flaky.client, batchLimits: limits });
    expect(second.exitCode).toBe(0);
    const afterSecond = (await readState(s.paths)).state.files[target]!;
    expect(afterSecond.lastUploadedSeq).toBeGreaterThan(afterFirst.lastUploadedSeq);
    expect(afterSecond.summaryHash).toMatch(/^[0-9a-f]{40}$/);

    // No event was lost, and none was uploaded twice: the sum across both runs matches a clean run.
    const clean = await setup();
    const cleanFake = fakeClient();
    const cleanReport = await runSync({ ...base, codexHome: clean.codexHome }, { ...clean.deps, createClient: () => cleanFake.client, batchLimits: limits });
    expect(cleanReport.exitCode).toBe(0);
    expect(first.uploads.events + second.uploads.events).toBe(cleanReport.uploads.events);
  });
  it("stops the upload loop once the run budget is exhausted, keeping progress and exit code 0", async () => {
    const s = await setup();
    const flaky = fakeClient({
      fail: (_b, i) => {
        if (i === 0) s.clock.now += CLI_RUN_BUDGET_MS + 1; // jump the injected clock past the deadline right after the first request
        return null;
      },
    });
    const report = await runSync({ ...base, codexHome: s.codexHome }, { ...s.deps, createClient: () => flaky.client, batchLimits: { maxEvents: 30, maxBytes: 3_500_000, maxSessions: 500 } });
    expect(report.exitCode).toBe(0);
    expect(report.warnings.some((w) => w.includes("run budget exhausted"))).toBe(true);
    expect(report.uploads.requests).toBe(1);
    expect(flaky.batches).toHaveLength(1);
    expect((await readState(s.paths)).state.lastSyncOk).toBe(true);
  });
});
