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
    if (typeof raw.pid === "number" && typeof raw.at === "number") return { pid: raw.pid, at: raw.at };
    return null;
  } catch {
    return null;
  }
}

/** Creates the lock file atomically (`wx`); steals it when stale (age > staleMs) or the holder is dead. */
export async function acquireLock(lockPath: string, opts: LockOptions): Promise<LockResult> {
  const isAlive = opts.isAlive ?? defaultIsAlive;
  for (let attempt = 0; attempt < 2; attempt++) {
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
      const stale = holder === null || opts.now - holder.at > opts.staleMs || !isAlive(holder.pid);
      if (!stale) return { acquired: false, holder: holder ?? undefined };
      await fs.rm(lockPath, { force: true });
    }
  }
  return { acquired: false };
}

export async function releaseLock(lockPath: string, pid: number): Promise<void> {
  const holder = await readLock(lockPath);
  if (holder !== null && holder.pid !== pid) return;
  await fs.rm(lockPath, { force: true });
}
