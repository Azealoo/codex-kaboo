import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  existsSync,
  readdirSync,
  writeFileSync,
  promises as fsPromises,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, readLock, releaseLock } from "../../src/util/lock";

function tmpLock(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "ck-lock-")), "sync.lock");
}

describe("lock", () => {
  it("acquires, refuses a live holder, and releases only for the owner", async () => {
    const lock = tmpLock();
    expect(
      await acquireLock(lock, { now: 1000, staleMs: 600000, pid: 11, isAlive: () => true }),
    ).toEqual({ acquired: true });
    expect(await readLock(lock)).toEqual({ pid: 11, at: 1000 });
    const second = await acquireLock(lock, {
      now: 2000,
      staleMs: 600000,
      pid: 22,
      isAlive: () => true,
    });
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
    expect(
      (await acquireLock(lock, { now: 600001, staleMs: 600000, pid: 22, isAlive: () => true }))
        .acquired,
    ).toBe(true);
    expect(await readLock(lock)).toEqual({ pid: 22, at: 600001 });
    expect(
      (await acquireLock(lock, { now: 600002, staleMs: 600000, pid: 33, isAlive: () => false }))
        .acquired,
    ).toBe(true);
    expect(await readLock(lock)).toEqual({ pid: 33, at: 600002 });
  });
  it("lets exactly one of two concurrent takers steal the same stale lock", async () => {
    const lock = tmpLock();
    await acquireLock(lock, { now: 0, staleMs: 600000, pid: 99, isAlive: () => true });
    const now = 600001;
    const [a, b] = await Promise.all([
      acquireLock(lock, { now, staleMs: 600000, pid: 11, isAlive: () => true }),
      acquireLock(lock, { now, staleMs: 600000, pid: 22, isAlive: () => true }),
    ]);
    const winners = [a, b].filter((r) => r.acquired);
    expect(winners.length).toBe(1);
    const winnerPid = a.acquired ? 11 : 22;
    expect(await readLock(lock)).toEqual({ pid: winnerPid, at: now });
    const leftovers = readdirSync(path.dirname(lock)).filter((name) => name.includes(".stale-"));
    expect(leftovers).toEqual([]);
  });
  it("refuses when a fresh lock is present where a stale one was just taken over", async () => {
    const lock = tmpLock();
    // Stands in for the state a rename-race loser sees after retrying `wx`: the stale holder is
    // gone and a fresh, live lock already occupies the path.
    await acquireLock(lock, { now: 500000, staleMs: 600000, pid: 44, isAlive: () => true });
    const result = await acquireLock(lock, {
      now: 500100,
      staleMs: 600000,
      pid: 55,
      isAlive: () => true,
    });
    expect(result).toEqual({ acquired: false, holder: { pid: 44, at: 500000 } });
  });
});

describe("an unreadable lock", () => {
  it("is respected while it is new enough to be mid-write", async () => {
    const lock = tmpLock();
    // Exactly the window a second sync can arrive in: another process's `open(lockPath, "wx")` has
    // succeeded and its JSON is not written yet, so the file exists and is empty. Reading no holder
    // there used to mean "stale" -- the newcomer renamed the file away and took a lock of its own
    // while the first process, still holding its handle, also returned acquired. Two runs then
    // uploaded and overwrote state.json at once, each believing it was alone.
    const handle = await fsPromises.open(lock, "wx");
    try {
      const result = await acquireLock(lock, {
        now: Date.now(),
        staleMs: 600000,
        pid: 22,
        isAlive: () => true,
      });
      expect(result.acquired).toBe(false);
      expect(existsSync(lock)).toBe(true); // and it was not renamed out from under the writer
    } finally {
      await handle.close();
    }
  });

  it("is still stolen once it is older than staleMs", async () => {
    // The other half: a lock left unreadable by a crash must not block sync forever. The clock is
    // advanced rather than the file backdated -- `now` and mtime are the same wall clock in
    // production (`deps.now()` is Date.now()), and utimesSync round-trips differ per filesystem.
    const lock = tmpLock();
    writeFileSync(lock, "{ truncated mid-writ");
    const later = Date.now() + 600001;
    const result = await acquireLock(lock, {
      now: later,
      staleMs: 600000,
      pid: 22,
      isAlive: () => true,
    });
    expect(result.acquired).toBe(true);
    expect(await readLock(lock)).toEqual({ pid: 22, at: later });
    expect(readdirSync(path.dirname(lock))).toEqual(["sync.lock"]);
  });
});
