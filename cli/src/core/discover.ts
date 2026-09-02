import { promises as fs } from "node:fs";
import path from "node:path";
import { CLI_MAX_FILES } from "@codex-kaboo/shared/constants";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export const ROLLOUT_RE = new RegExp(
  `^rollout-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2})-(${UUID})(?:_(${UUID}))?\\.jsonl(\\.zst)?$`,
);
const SUBDIRS = ["sessions", "archived_sessions"] as const;

export interface RolloutName {
  fileTimestamp: string;
  fileTimestampMs: number;
  threadId: string;
  rolloutId: string | null;
  compressed: boolean;
}

export interface DiscoveredFile extends RolloutName {
  path: string;
  codexHome: string;
  name: string;
  sessionId: string;
  size: number;
  mtimeMs: number;
}

export interface DiscoverResult {
  files: DiscoveredFile[];
  truncated: boolean;
  homes: { path: string; exists: boolean; files: number }[];
}

export function parseRolloutName(name: string): RolloutName | null {
  const m = ROLLOUT_RE.exec(name);
  if (!m || !m[1] || !m[2]) return null;
  const [date, time] = m[1].split("T") as [string, string];
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi, s] = time.split("-").map(Number) as [number, number, number];
  return {
    fileTimestamp: m[1],
    fileTimestampMs: Date.UTC(y, mo - 1, d, h, mi, s),
    threadId: m[2].toLowerCase(),
    rolloutId: m[3] ? m[3].toLowerCase() : null,
    compressed: m[4] !== undefined,
  };
}

async function walk(dir: string, out: string[], limit: number): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out, limit);
    else if (entry.isFile() && ROLLOUT_RE.test(entry.name)) out.push(full);
  }
}

export async function discoverRolloutFiles(
  codexHomes: string[],
  opts: { maxFiles?: number } = {},
): Promise<DiscoverResult> {
  const maxFiles = opts.maxFiles ?? CLI_MAX_FILES;
  const files: DiscoveredFile[] = [];
  const homes: DiscoverResult["homes"] = [];
  let truncated = false;
  for (const home of codexHomes) {
    let exists = false;
    try {
      exists = (await fs.stat(home)).isDirectory();
    } catch {
      exists = false;
    }
    const found: string[] = [];
    if (exists) {
      for (const sub of SUBDIRS) await walk(path.join(home, sub), found, maxFiles + 1 - files.length);
    }
    let count = 0;
    for (const full of found) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const name = path.basename(full);
      const parsed = parseRolloutName(name);
      if (!parsed) continue;
      let stat: import("node:fs").Stats;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      files.push({
        ...parsed,
        path: full,
        codexHome: home,
        name,
        sessionId: parsed.rolloutId ? `${parsed.threadId}_${parsed.rolloutId}` : parsed.threadId,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
      count += 1;
    }
    homes.push({ path: home, exists, files: count });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, truncated, homes };
}
