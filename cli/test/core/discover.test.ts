import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverRolloutFiles, parseRolloutName } from "../../src/core/discover";

const T1 = "0199a1b2-0000-7000-8000-000000000001";
const T2 = "0199a1b2-0000-7000-8000-000000000002";
const T3 = "0199a1b2-0000-7000-8000-000000000003";
const R1 = "0199a1b2-0000-7000-8000-00000000000a";

// Temp dirs are tracked and removed in afterEach so failed runs don't litter os.tmpdir().
const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "ck-codex-"));
  tmpDirs.push(home);
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

// A second, distinct existing home with exactly one matching rollout file — used to prove that
// once the cap is already full, a later home is not walked at all (not just discarded).
function makeSmallHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "ck-codex-small-"));
  tmpDirs.push(home);
  const day = path.join(home, "sessions", "2026", "08", "30");
  mkdirSync(day, { recursive: true });
  writeFileSync(path.join(day, `rollout-2026-08-30T09-00-00-${T3}.jsonl`), "{}\n");
  return home;
}

// A home with exactly two matching rollout files and nothing more — used to land the cap
// (maxFiles: 2) precisely, with no local overflow entry to trip the materialisation loop's own
// truncation check.
function makeExactHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "ck-codex-exact-"));
  tmpDirs.push(home);
  const day = path.join(home, "sessions", "2026", "08", "30");
  mkdirSync(day, { recursive: true });
  writeFileSync(path.join(day, `rollout-2026-08-30T10-00-00-${T1}.jsonl`), "{}\n");
  writeFileSync(path.join(day, `rollout-2026-08-30T11-00-00-${T1}_${R1}.jsonl`), "{}\n{}\n");
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
  it("stops walking further homes once the file cap is already reached", async () => {
    const home1 = makeHome();
    const home2 = makeSmallHome();
    const capped = await discoverRolloutFiles([home1, home2], { maxFiles: 2 });
    expect(capped.files).toHaveLength(2);
    expect(capped.files.map((f) => f.sessionId)).toEqual([T1, `${T1}_${R1}`]);
    expect(capped.files.every((f) => f.codexHome === home1)).toBe(true);
    expect(capped.truncated).toBe(true);
    expect(capped.homes[1]).toEqual({ path: home2, exists: true, files: 0 });
  });
  it("marks the result truncated when a later home is skipped exactly at the cap", async () => {
    const home1 = makeExactHome();
    const home2 = makeSmallHome();
    const capped = await discoverRolloutFiles([home1, home2], { maxFiles: 2 });
    expect(capped.files).toHaveLength(2);
    expect(capped.files.map((f) => f.sessionId)).toEqual([T1, `${T1}_${R1}`]);
    expect(capped.truncated).toBe(true);
    expect(capped.homes[1]).toEqual({ path: home2, exists: true, files: 0 });
  });
});
