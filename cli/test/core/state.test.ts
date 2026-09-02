import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { kabooPaths } from "../../src/core/paths";
import {
  clearFailure, detectReset, emptyFileState, emptyState, isPermanentlyFailing, isUnchanged, MAX_FILE_FAILURES,
  readState, recordFailure, resetAllFiles, resetFileState, writeState,
} from "../../src/core/state";

// Temp dirs are tracked and removed in afterEach so failed runs don't litter os.tmpdir().
const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ck-state-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

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

// Review finding: `isUnchanged` is false while `lastError` is set, so a file that fails is retried
// on every run — right for a transient 400, but a permanently invalid summary then fails
// identically forever and pins every scheduled run at exit 1.
describe("bounded retry of a failing file", () => {
  it("counts identical failures, parks past the cap, and starts over on any change", () => {
    let f = emptyFileState("/p/a.jsonl");
    expect(isPermanentlyFailing(f, 10, 5)).toBe(false); // never failed

    for (let attempt = 1; attempt <= MAX_FILE_FAILURES; attempt++) {
      f = recordFailure(f, "400 invalid_batch", 10, 5);
      expect(f.failure?.count).toBe(attempt);
      expect(isPermanentlyFailing(f, 10, 5)).toBe(false); // still retried at and below the cap
    }
    f = recordFailure(f, "400 invalid_batch", 10, 5); // one past the cap
    expect(f.failure?.count).toBe(MAX_FILE_FAILURES + 1);
    expect(f.lastError).toBe("400 invalid_batch");
    expect(isPermanentlyFailing(f, 10, 5)).toBe(true);

    // Any edit to the file is a new file as far as the counter is concerned.
    expect(isPermanentlyFailing(f, 11, 5)).toBe(false); // grew
    expect(isPermanentlyFailing(f, 10, 6)).toBe(false); // touched
    expect(recordFailure(f, "400 invalid_batch", 11, 5).failure?.count).toBe(1);
    // A different failure is a different problem: worth its own six attempts.
    expect(recordFailure(f, "500 server_error", 10, 5).failure?.count).toBe(1);

    // A success clears the record entirely — the key is dropped, not zeroed, so state.json stays
    // as small as it was and a stale counter can never park a healthy file.
    const cleared = clearFailure(f);
    expect(cleared.lastError).toBeNull();
    expect("failure" in cleared).toBe(false);
    expect(isPermanentlyFailing(cleared, 10, 5)).toBe(false);
    // Belt and braces: even a counter left behind by an older CLI cannot park a file that is fine.
    expect(isPermanentlyFailing({ ...f, lastError: null }, 10, 5)).toBe(false);
  });

  it("survives a state.json written before the counter existed", async () => {
    const paths = kabooPaths(path.join(tmp(), "home"));
    const legacy = { ...emptyFileState("/p/a.jsonl"), size: 10, mtimeMs: 5, lastError: "boom" };
    delete (legacy as { failure?: unknown }).failure;
    mkdirSync(paths.home, { recursive: true });
    writeFileSync(paths.state, JSON.stringify({ ...emptyState(), files: { s1: legacy } }));
    const { state, corrupt } = await readState(paths);
    expect(corrupt).toBe(false);
    const loaded = state.files["s1"]!;
    expect(isPermanentlyFailing(loaded, 10, 5)).toBe(false); // retried as before, not parked
    expect(recordFailure(loaded, "boom", 10, 5).failure?.count).toBe(1);
  });
});
