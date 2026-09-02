import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { kabooPaths } from "../../src/core/paths";
import {
  detectReset, emptyFileState, emptyState, isUnchanged, readState, resetAllFiles, resetFileState, writeState,
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
