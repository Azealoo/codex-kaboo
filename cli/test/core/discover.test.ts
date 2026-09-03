import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dedupeBySession,
  discoverRolloutFiles,
  parseRolloutName,
  type DiscoveredFile,
} from "../../src/core/discover";

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
  writeFileSync(
    path.join(archived, `rollout-2026-07-01T09-00-00-${T2}.jsonl.zst`),
    Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
  );
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
      fileTimestamp: "2026-08-30T10-00-00",
      fileTimestampMs: Date.UTC(2026, 7, 30, 10, 0, 0),
      threadId: T1,
      rolloutId: null,
      compressed: false,
    });
    expect(parseRolloutName(`rollout-2026-08-30T10-00-00-${T1}_${R1}.jsonl.zst`)).toMatchObject({
      threadId: T1,
      rolloutId: R1,
      compressed: true,
    });
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
    expect(forked).toMatchObject({
      codexHome: home,
      threadId: T1,
      rolloutId: R1,
      compressed: false,
      size: 6,
    });
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
  it("keeps only the uncompressed copy when one session exists as both .jsonl and .jsonl.zst", async () => {
    // Codex compresses a rollout and only then deletes the original, so mid-window both files
    // exist under the same rollout-<ts>-<uuid> base name and map to one sessionId. Shipping both
    // put two SessionSummary objects with the same sessionId in a single batch and made every
    // (sessionId, seq) event key collide; locally the stored summaryHash then alternated between
    // the two forever.
    const home = mkdtempSync(path.join(os.tmpdir(), "ck-codex-dup-"));
    tmpDirs.push(home);
    const live = path.join(home, "sessions", "2026", "08", "30");
    const archived = path.join(home, "archived_sessions", "2026", "08", "30");
    mkdirSync(live, { recursive: true });
    mkdirSync(archived, { recursive: true });
    const base = `rollout-2026-08-30T10-00-00-${T1}.jsonl`;
    writeFileSync(path.join(live, base), "{}\n{}\n{}\n");
    writeFileSync(path.join(archived, `${base}.zst`), Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));

    const result = await discoverRolloutFiles([home]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      sessionId: T1,
      compressed: false,
      path: path.join(live, base),
    });
    expect(result.duplicates).toEqual([
      { sessionId: T1, kept: path.join(live, base), dropped: path.join(archived, `${base}.zst`) },
    ]);
    // The per-home count stays equal to the number of files that will actually be processed.
    expect(result.homes).toEqual([{ path: home, exists: true, files: 1 }]);

    // Deterministic: the winner is derived from the files, never from walk order, so removing the
    // uncompressed copy (the rest of the compress-then-delete window) simply promotes the .zst,
    // and progress carries over because state is keyed by sessionId rather than by path.
    rmSync(path.join(live, base));
    const after = await discoverRolloutFiles([home]);
    expect(after.files).toHaveLength(1);
    expect(after.files[0]).toMatchObject({ sessionId: T1, compressed: true });
    expect(after.duplicates).toEqual([]);
  });
  it("breaks a same-compression duplicate by size, then by path, and reports every dropped file", () => {
    const file = (over: Partial<DiscoveredFile>): DiscoveredFile => ({
      fileTimestamp: "2026-08-30T10-00-00",
      fileTimestampMs: 0,
      threadId: T1,
      rolloutId: null,
      compressed: false,
      path: "/a",
      codexHome: "/h",
      name: "n",
      sessionId: T1,
      size: 10,
      mtimeMs: 0,
      ...over,
    });
    const small = file({ path: "/a", size: 10 });
    const big = file({ path: "/b", size: 99 });
    const other = file({ path: "/c", size: 99, sessionId: T2, threadId: T2 });
    const zst = file({ path: "/d", size: 500, compressed: true });
    const byPath = file({ path: "/e", size: 99 });

    // Bigger wins at equal compression; an uncompressed file wins even against a much larger .zst.
    const three = dedupeBySession([small, big, other, zst]);
    expect(three.files.map((f) => f.path)).toEqual(["/b", "/c"]);
    expect(three.duplicates).toEqual([
      { sessionId: T1, kept: "/b", dropped: "/a" },
      { sessionId: T1, kept: "/b", dropped: "/d" },
    ]);
    // Equal size and compression: the lexicographically smaller path, so the pick never depends on
    // the order the two were discovered in.
    expect(dedupeBySession([byPath, big]).files.map((f) => f.path)).toEqual(["/b"]);
    expect(dedupeBySession([big, byPath]).files.map((f) => f.path)).toEqual(["/b"]);
    // Nothing to do: the input array is returned untouched.
    const distinct = [big, other];
    expect(dedupeBySession(distinct).files).toBe(distinct);
    expect(dedupeBySession(distinct).duplicates).toEqual([]);
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

describe("which files survive the cap", () => {
  // One rollout per day directory, dated so that path order and chronological order agree — which
  // is how Codex actually lays sessions out: sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl.
  function makeDatedHome(days: number[]): string {
    const home = mkdtempSync(path.join(os.tmpdir(), "ck-codex-dated-"));
    tmpDirs.push(home);
    for (const day of days) addDay(home, day);
    return home;
  }

  function addDay(home: string, day: number): string {
    const dd = String(day).padStart(2, "0");
    const dir = path.join(home, "sessions", "2026", "08", dd);
    mkdirSync(dir, { recursive: true });
    const id = `0199a1b2-0000-7000-8000-0000000000${dd}`;
    const name = `rollout-2026-08-${dd}T10-00-00-${id}.jsonl`;
    writeFileSync(path.join(dir, name), "{}\n");
    return id;
  }

  // The cap exists to bound one run's work, so it has to drop something. Dropping the NEWEST
  // files is the one choice that never self-corrects: a depth-first walk of sorted names visits
  // dated directories oldest-first, so every run would fill the cap with the same old prefix and
  // a heavy user's current sessions would be excluded permanently, not deferred.
  it("keeps the newest files, not the lexicographically first ones", async () => {
    const home = makeDatedHome([1, 2, 3, 4, 5]);
    const capped = await discoverRolloutFiles([home], { maxFiles: 2 });
    expect(capped.files.map((f) => f.fileTimestamp)).toEqual([
      "2026-08-04T10-00-00",
      "2026-08-05T10-00-00",
    ]);
    expect(capped.truncated).toBe(true);
  });

  it("sees a session created after the cap was already full", async () => {
    const home = makeDatedHome([1, 2, 3]);
    const before = await discoverRolloutFiles([home], { maxFiles: 2 });
    const newId = addDay(home, 9);
    const after = await discoverRolloutFiles([home], { maxFiles: 2 });
    expect(after.files.map((f) => f.sessionId)).toContain(newId);
    expect(after.files.map((f) => f.sessionId)).not.toEqual(before.files.map((f) => f.sessionId));
  });

  it("still spends the cap on live sessions before archived ones", async () => {
    // `sessions` is walked before `archived_sessions` regardless of dates: an archived rollout is
    // finished and immutable, so it can wait a run, while a live one is still being appended to.
    const home = mkdtempSync(path.join(os.tmpdir(), "ck-codex-archived-"));
    tmpDirs.push(home);
    const live = path.join(home, "sessions", "2026", "08", "01");
    const archived = path.join(home, "archived_sessions", "2026", "09", "01");
    mkdirSync(live, { recursive: true });
    mkdirSync(archived, { recursive: true });
    const liveId = "0199a1b2-0000-7000-8000-00000000ff01";
    writeFileSync(path.join(live, `rollout-2026-08-01T10-00-00-${liveId}.jsonl`), "{}\n");
    writeFileSync(
      path.join(archived, `rollout-2026-09-01T10-00-00-0199a1b2-0000-7000-8000-00000000ff02.jsonl`),
      "{}\n",
    );
    const capped = await discoverRolloutFiles([home], { maxFiles: 1 });
    expect(capped.files.map((f) => f.sessionId)).toEqual([liveId]);
  });
});
