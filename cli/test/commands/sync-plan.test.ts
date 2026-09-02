import { afterEach, describe, expect, it } from "vitest";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLI_MAX_FILE_BYTES } from "@codex-kaboo/shared/constants";
import type { RateLimitSnapshot } from "@codex-kaboo/shared/sync";
import {
  buildMachineInfo,
  planSync,
  readCodexLatestVersion,
  toSyncBatch,
} from "../../src/commands/sync-plan";
import { emptyFileState, emptyState } from "../../src/core/state";
import { discoverRolloutFiles } from "../../src/core/discover";
import { zstdSupported } from "../../src/core/jsonl-reader";
import { silentLogger } from "../../src/util/log";
import { buildBatches } from "../../src/upload/batch";
import type { SyncState } from "../../src/types";
import { FIXTURE_HOME, FX } from "../fixture-ids";

const NOW = Date.UTC(2026, 8, 1, 12);
const deps = { env: {}, now: () => NOW, log: silentLogger, machineZone: "UTC" };

// Every mkdtempSync directory created by a test (directly, or via copyFixtures) is tracked here and
// removed in afterEach, so failed or repeated runs don't litter os.tmpdir().
const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function copyFixtures(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "ck-plan-"));
  tmpDirs.push(home);
  cpSync(FIXTURE_HOME, home, { recursive: true });
  writeFileSync(
    path.join(home, "version.json"),
    JSON.stringify({ latest_version: "0.151.0", last_checked_at: "x" }),
  );
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
    expect(next).toMatchObject({
      lines: 159,
      lastUploadedSeq: -1,
      summaryHash: null,
      generation: 0,
      complete: false,
      lastError: null,
    });
    expect(next.offset).toBe(statSync(next.path).size);
    expect(next.tail.length).toBeGreaterThan(0);
  });
  it("treats files with identical size and mtime as unchanged without parsing, unless --full", async () => {
    const home = copyFixtures();
    const { files } = await discoverRolloutFiles([home]);
    const state: SyncState = emptyState();
    for (const f of files) {
      state.files[f.sessionId] = {
        ...emptyFileState(f.path),
        offset: f.size,
        size: f.size,
        mtimeMs: f.mtimeMs,
        lastUploadedSeq: 10_000,
        summaryHash: "x".repeat(40),
      };
    }
    const plan = await planSync(state, [home], { full: false }, deps);
    expect(plan.files.every((f) => f.action === "unchanged")).toBe(true);
    expect(plan.uploads).toEqual([]);
    const full = await planSync(
      {
        ...state,
        files: Object.fromEntries(
          Object.entries(state.files).map(([k, v]) => [
            k,
            { ...v, offset: 0, size: 0, mtimeMs: 0, lastUploadedSeq: -1, summaryHash: null },
          ]),
        ),
      },
      [home],
      { full: true },
      deps,
    );
    expect(full.uploads.length).toBeGreaterThanOrEqual(8);
  });
  it("re-parses a grown file but reports unchanged when the acknowledged hash matches", async () => {
    const home = copyFixtures();
    const first = await planSync(emptyState(), [home], { full: false }, deps);
    const planned = first.files.find((f) => f.file.sessionId === FX.paginatedSmall)!;
    const state = emptyState();
    state.files[FX.paginatedSmall] = {
      ...planned.next,
      mtimeMs: planned.next.mtimeMs + 1,
      lastUploadedSeq: 158,
      summaryHash: planned.summaryHash,
    };
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
    state.files[FX.corrupt] = {
      ...planned.next,
      lastUploadedSeq: 5,
      summaryHash: planned.summaryHash,
      generation: 2,
    };
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
    const budgeted = await planSync(
      emptyState(),
      [home],
      { full: false },
      { ...deps, now: () => NOW + (calls++ > 2 ? 10_000 : 0), budgetMs: 5000, startedAt: NOW },
    );
    expect(budgeted.budgetExhausted).toBe(true);
    expect(budgeted.files.length).toBeLessThan(8);
    const bad = path.join(
      home,
      "sessions",
      "2026",
      "08",
      "30",
      "rollout-2026-08-30T23-00-00-0199f1c0-0000-7000-8000-0000000000e1.jsonl",
    );
    writeFileSync(
      bad,
      `${JSON.stringify({ timestamp: "2026-08-30T23:00:00.000Z", type: "session_meta", payload: { id: "0199f1c0-0000-7000-8000-0000000000e1", timestamp: "1999-01-01T00:00:00.000Z" } })}\n`,
    );
    const plan = await planSync(emptyState(), [home], { full: false }, deps);
    const broken = plan.files.find(
      (f) => f.file.sessionId === "0199f1c0-0000-7000-8000-0000000000e1",
    )!;
    expect(broken.action).toBe("error");
    expect(broken.next.lastError).toMatch(/startedAt/);
    expect(plan.errors).toHaveLength(1);
  });
});

describe("machine info and batches", () => {
  it("builds the machine block and a schema-valid SyncBatch", async () => {
    const machine = buildMachineInfo({
      config: {
        server: "s",
        token: "t",
        machineId: "m1",
        label: "brisk-otter",
        hostnameOptIn: true,
        codexHomes: [],
      },
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "24.17.0",
      hostname: () => "my-mac",
      machineZone: "UTC",
      codexVersion: "0.150.1",
      codexLatestVersion: "0.151.0",
    });
    expect(machine).toEqual({
      machineId: "m1",
      label: "brisk-otter",
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "24.17.0",
      codexVersion: "0.150.1",
      codexLatestVersion: "0.151.0",
      hostname: "my-mac",
      tz: "UTC",
    });
    expect(
      buildMachineInfo({
        config: null,
        platform: "linux",
        arch: "x64",
        nodeVersion: "20.0.0",
        hostname: () => "h",
        machineZone: undefined,
        codexVersion: null,
        codexLatestVersion: undefined,
      }),
    ).toMatchObject({ machineId: "dry-run", label: "dry-run", hostname: null });
    const home = copyFixtures();
    const plan = await planSync(emptyState(), [home], { full: false }, deps);
    const [batch] = buildBatches(plan.uploads);
    const sync = toSyncBatch(batch!, machine, {
      cliVersion: "0.1.0",
      batchId: "b1",
      sentAt: NOW,
      rateLimit: plan.rateLimit,
      rateLimitChanged: plan.rateLimitChanged,
    });
    const { SyncBatch } = await import("@codex-kaboo/shared/sync");
    expect(SyncBatch.safeParse(sync).success).toBe(true);
    expect(sync.rateLimit).toEqual(plan.rateLimit);
    expect(await readCodexLatestVersion([home, "/nonexistent"])).toBe("0.151.0");
    expect(await readCodexLatestVersion(["/nonexistent"])).toBeUndefined();
  });
});

// Supplementary to the brief's Step 1 suite above (copied verbatim): these target the carry-over
// concern from Task 9's review ("relocated files must keep offset/tail/lastUploadedSeq by
// sessionId", surfaced again in this task's brief) plus two other decision branches — the
// > 256 MB skip and the .zst complete-after-one-pass fast path — that the brief's own tests never
// exercise (no fixture is moved, oversized or re-planned against a "complete" .zst state there).
describe("relocated files, oversize skip and .zst fast path (carry-over coverage)", () => {
  it("keeps offset/tail/lastUploadedSeq/summaryHash when a session's file moves, and updates its path", async () => {
    const home = copyFixtures();
    const first = await planSync(emptyState(), [home], { full: false }, deps);
    const planned = first.files.find((f) => f.file.sessionId === FX.paginatedSmall)!;
    const state = emptyState();
    state.files[FX.paginatedSmall] = {
      ...planned.next,
      lastUploadedSeq: 158,
      summaryHash: planned.summaryHash,
    };

    // Move the file into archived_sessions/ under a new directory, same filename (same threadId,
    // so the same sessionId) — this is the "moved file" case: archival or on-disk relocation.
    // renameSync is a metadata-only move (same inode): size and mtime are preserved exactly, so
    // isUnchanged is deterministically true afterwards and the "unchanged" fast path — not a
    // detectReset + full reparse that merely happens to land on the same answer — is what runs.
    const oldPath = planned.file.path;
    const archivedDir = path.join(home, "archived_sessions", "2026", "08", "30");
    mkdirSync(archivedDir, { recursive: true });
    const newPath = path.join(archivedDir, path.basename(oldPath));
    renameSync(oldPath, newPath);

    // Prove the fast path never re-reads the file: corrupt its bytes in place (same length, so
    // size still matches state) and restore the exact original mtime — using raw epoch-seconds
    // numbers, not Date objects, because Date truncates the sub-millisecond remainder utimesSync
    // would otherwise lose, which would make mtimeMs mismatch and defeat isUnchanged. If planSync
    // ever opened this file again, parsing garbage would raise parseErrors and change the summary
    // hash (or throw), neither of which "unchanged" with the original hash/offset intact allows.
    const beforeCorrupt = statSync(newPath);
    writeFileSync(newPath, Buffer.alloc(beforeCorrupt.size, 0x2a));
    utimesSync(newPath, beforeCorrupt.atimeMs / 1000, beforeCorrupt.mtimeMs / 1000);
    expect(statSync(newPath).mtimeMs).toBe(beforeCorrupt.mtimeMs); // the restore itself is exact

    const plan = await planSync(state, [home], { full: false }, deps);
    const moved = plan.files.find((f) => f.file.sessionId === FX.paginatedSmall)!;
    expect(moved.file.path).toBe(newPath);
    expect(moved.action).toBe("unchanged");
    expect(moved.reason).toBeUndefined();
    expect(moved.upload).toBeNull();
    expect(moved.next.path).toBe(newPath);
    expect(moved.next.generation).toBe(0);
    expect(moved.next.offset).toBe(planned.next.offset);
    expect(moved.next.lastUploadedSeq).toBe(158);
    expect(moved.next.summaryHash).toBe(planned.summaryHash);
    expect(plan.errors).toEqual([]);
  });

  it("skips a file larger than 256 MB with a warning, without reading it", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "ck-plan-big-"));
    tmpDirs.push(home);
    const day = path.join(home, "sessions", "2026", "08", "30");
    mkdirSync(day, { recursive: true });
    const big = path.join(
      day,
      "rollout-2026-08-30T09-00-00-0199f1c0-0000-7000-8000-0000000000f1.jsonl",
    );
    writeFileSync(big, ""); // truncate to a sparse file: instant, no real 256 MB of I/O
    truncateSync(big, CLI_MAX_FILE_BYTES + 1);

    const plan = await planSync(emptyState(), [home], { full: false }, deps);
    expect(plan.files).toHaveLength(1);
    const skipped = plan.files[0]!;
    expect(skipped.action).toBe("skipped");
    expect(skipped.reason).toMatch(/256 MB/);
    expect(plan.uploads).toEqual([]);
    expect(plan.warnings.some((w) => w.includes("256 MB"))).toBe(true);
    expect(plan.errors).toEqual([]);
  });

  it.skipIf(!zstdSupported())(
    "parses a .zst rollout once, then skips it as complete unless --full is set",
    async () => {
      const home = copyFixtures();
      const first = await planSync(emptyState(), [home], { full: false }, deps);
      const planned = first.files.find((f) => f.file.sessionId === FX.zst)!;
      expect(planned.action).toBe("parsed");
      expect(planned.next.complete).toBe(true);

      const state = emptyState();
      state.files[FX.zst] = planned.next;

      // Corrupt the archived .zst on disk: if the "complete" fast path ever re-read it, this
      // proves it by failing (decompression of garbage bytes rejects), instead of silently
      // returning a plausible-looking summary.
      writeFileSync(planned.file.path, Buffer.from([0, 1, 2, 3]));

      const skipped = await planSync(state, [home], { full: false }, deps);
      const skippedFile = skipped.files.find((f) => f.file.sessionId === FX.zst)!;
      expect(skippedFile.action).toBe("unchanged");
      expect(skippedFile.upload).toBeNull();
      expect(skipped.errors).toEqual([]);

      const full = await planSync(state, [home], { full: true }, deps);
      const fullFile = full.files.find((f) => f.file.sessionId === FX.zst)!;
      expect(fullFile.action).toBe("error");
      expect(full.errors.length).toBe(1);
    },
  );
});

// Review finding (round 1): planSync used to seed plan.rateLimit from null instead of
// state.rateLimit, so an idle run (nothing reparsed) would make the caller persist null and wipe
// the last known quota snapshot. Fixed by seeding from state.rateLimit the way codexVersion is
// seeded, keeping the newest by observedAt, and exposing rateLimitChanged so the caller only sends
// it to the server when it actually moved forward (but always persists plan.rateLimit).
describe("rate limit: seeded from state, changed only when newer than stored", () => {
  it("keeps the stored snapshot and reports no change on an idle run", async () => {
    const home = copyFixtures();
    const { files } = await discoverRolloutFiles([home]);
    const state: SyncState = emptyState();
    for (const f of files) {
      state.files[f.sessionId] = {
        ...emptyFileState(f.path),
        offset: f.size,
        size: f.size,
        mtimeMs: f.mtimeMs,
        lastUploadedSeq: 10_000,
        summaryHash: "x".repeat(40),
      };
    }
    const stored: RateLimitSnapshot = {
      observedAt: Date.UTC(2026, 7, 30),
      usedPercent: 12.5,
      windowMinutes: 10080,
    };
    state.rateLimit = stored;

    const plan = await planSync(state, [home], { full: false }, deps);
    expect(plan.files.every((f) => f.action === "unchanged")).toBe(true); // genuinely idle: nothing reparsed
    expect(plan.rateLimit).toEqual(stored);
    expect(plan.rateLimitChanged).toBe(false);
  });

  it("adopts a freshly parsed snapshot newer than the stored one", async () => {
    const home = copyFixtures();
    const stale: RateLimitSnapshot = {
      observedAt: Date.UTC(2020, 0, 1),
      usedPercent: 1,
      windowMinutes: 10080,
    };
    const state = emptyState();
    state.rateLimit = stale;

    const plan = await planSync(state, [home], { full: false }, deps);
    expect(plan.rateLimit).not.toBeNull();
    expect(plan.rateLimit).not.toEqual(stale);
    expect(plan.rateLimit!.observedAt).toBeGreaterThan(stale.observedAt);
    expect(plan.rateLimitChanged).toBe(true);
  });

  it("keeps a stored snapshot newer than anything parsed this run", async () => {
    const home = copyFixtures();
    const future: RateLimitSnapshot = {
      observedAt: Date.UTC(2030, 0, 1),
      usedPercent: 50,
      windowMinutes: 10080,
    };
    const state = emptyState();
    state.rateLimit = future;

    // A fresh state means every fixture is genuinely reparsed (not skipped as unchanged), so this
    // exercises "saw snapshots this run, all older than stored" rather than "saw nothing at all".
    const plan = await planSync(state, [home], { full: false }, deps);
    expect(plan.files.some((f) => f.action === "parsed")).toBe(true);
    expect(plan.rateLimit).toEqual(future);
    expect(plan.rateLimitChanged).toBe(false);
  });
});
