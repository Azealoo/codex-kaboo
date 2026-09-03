import { promises as fs } from "node:fs";

export interface LockInfo {
  pid: number;
  at: number;
}

export interface LockOptions {
  now: number;
  staleMs: number;
  pid: number;
  isAlive?: (pid: number) => boolean;
}

export interface LockResult {
  acquired: boolean;
  holder?: LockInfo;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function readLock(lockPath: string): Promise<LockInfo | null> {
  try {
    const raw = JSON.parse(await fs.readFile(lockPath, "utf8")) as Partial<LockInfo>;
    if (typeof raw.pid === "number" && typeof raw.at === "number")
      return { pid: raw.pid, at: raw.at };
    return null;
  } catch {
    return null;
  }
}

/**
 * How old an unreadable lock file must be before it counts as abandoned rather than half-written.
 *
 * `open(lockPath, "wx")` creates the file and the JSON lands a moment later, so for that moment the
 * lock exists and parses to nothing. Reading "no holder" as "stale" makes a second sync arriving
 * inside that window rename the file away and take a lock of its own, while the first process —
 * still holding its handle and about to write through it — also believes it holds the lock: two
 * runs uploading and overwriting `state.json` at once. The file's own mtime settles it, since a
 * lock that unreadable and that recent is being written, not abandoned. `now` and mtime are the
 * same wall clock here (the caller passes `Date.now()`).
 *
 * A lock left unreadable by a crash still heals — it just waits out `staleMs`, the same window a
 * readable lock from a vanished process waits out.
 */
async function unreadableLockIsStale(lockPath: string, opts: LockOptions): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    return opts.now - stat.mtimeMs > opts.staleMs;
  } catch {
    return true; // gone between the failed read and this stat: nothing to protect
  }
}

/**
 * Creates the lock file atomically (`wx`); steals it when stale (age > staleMs) or the holder is
 * dead. The takeover is atomic: the stale file is moved aside with `rename` — never removed by
 * path — so of any concurrent takers exactly one wins the rename (the loser gets `ENOENT`, since
 * `rename` is atomic for a shared source) and only the winner gets to recreate the lock. A loser
 * simply retries `wx`: it either creates the lock itself (nobody has yet) or sees `EEXIST`,
 * re-reads the now-fresh holder, and backs off.
 */
export async function acquireLock(lockPath: string, opts: LockOptions): Promise<LockResult> {
  const isAlive = opts.isAlive ?? defaultIsAlive;
  let lastHolder: LockInfo | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: opts.pid, at: opts.now }), "utf8");
      } finally {
        await handle.close();
      }
      return { acquired: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = await readLock(lockPath);
      lastHolder = holder ?? lastHolder;
      const stale =
        holder === null
          ? await unreadableLockIsStale(lockPath, opts)
          : opts.now - holder.at > opts.staleMs || !isAlive(holder.pid);
      if (!stale) return { acquired: false, holder: holder ?? undefined };

      const stolen = `${lockPath}.stale-${opts.pid}-${opts.now}`;
      try {
        await fs.rename(lockPath, stolen);
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code === "ENOENT") continue; // lost the race
        throw renameError;
      }
      try {
        await fs.rm(stolen, { force: true });
      } catch {
        // best-effort cleanup of our own renamed-away copy only; never touches lockPath itself
      }
    }
  }
  return { acquired: false, holder: lastHolder };
}

export async function releaseLock(lockPath: string, pid: number): Promise<void> {
  const holder = await readLock(lockPath);
  if (holder !== null && holder.pid !== pid) return;
  await fs.rm(lockPath, { force: true });
}
