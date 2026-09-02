import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, readLock, releaseLock } from "../../src/util/lock";

function tmpLock(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "ck-lock-")), "sync.lock");
}

describe("lock", () => {
  it("acquires, refuses a live holder, and releases only for the owner", async () => {
    const lock = tmpLock();
    expect(await acquireLock(lock, { now: 1000, staleMs: 600000, pid: 11, isAlive: () => true })).toEqual({ acquired: true });
    expect(await readLock(lock)).toEqual({ pid: 11, at: 1000 });
    const second = await acquireLock(lock, { now: 2000, staleMs: 600000, pid: 22, isAlive: () => true });
    expect(second.acquired).toBe(false);
    expect(second.holder).toEqual({ pid: 11, at: 1000 });
    await releaseLock(lock, 22);
    expect(existsSync(lock)).toBe(true);
    await releaseLock(lock, 11);
    expect(existsSync(lock)).toBe(false);
  });
  it("steals a stale lock (old timestamp) or a dead holder", async () => {
    const lock = tmpLock();
    await acquireLock(lock, { now: 0, staleMs: 600000, pid: 11, isAlive: () => true });
    expect((await acquireLock(lock, { now: 600001, staleMs: 600000, pid: 22, isAlive: () => true })).acquired).toBe(true);
    expect(await readLock(lock)).toEqual({ pid: 22, at: 600001 });
    expect((await acquireLock(lock, { now: 600002, staleMs: 600000, pid: 33, isAlive: () => false })).acquired).toBe(true);
    expect(await readLock(lock)).toEqual({ pid: 33, at: 600002 });
  });
});
