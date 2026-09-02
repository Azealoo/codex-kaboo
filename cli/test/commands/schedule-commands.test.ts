import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

// Every mkdtempSync directory created by setup() is tracked here and removed in afterEach, so
// failed or repeated runs don't litter os.tmpdir().
const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

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
  tmpDirs.push(root);
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
