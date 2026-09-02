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

/** One rollout file dropped by `dedupeBySession` because another file carries the same sessionId. */
export interface DuplicateSession {
  sessionId: string;
  kept: string; // path of the file that will be processed
  dropped: string; // path of the file that will be ignored this run
}

export interface DiscoverResult {
  files: DiscoveredFile[];
  truncated: boolean;
  homes: { path: string; exists: boolean; files: number }[];
  duplicates: DuplicateSession[];
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

/**
 * The single file to process for a session, given two that claim the same `sessionId`. Ordered by:
 * uncompressed first, then larger, then the lexicographically smaller path. Every key is derived
 * from the files themselves (never from walk order), and paths are unique, so this is a total order
 * — reducing a group with it yields the same winner however the group was assembled.
 *
 * Uncompressed wins because the `.zst` is Codex's archived copy of the same rollout and, during the
 * compress-then-delete window, is the one that may still be catching up: the original is the live
 * file and the one that keeps growing. Nothing is lost when the original later disappears — state
 * is keyed by `sessionId`, not by path, so the `.zst` inherits that session's cursor on the next
 * run (`planSync` already rewrites `prev.path` for a file that moved).
 */
function preferredOf(a: DiscoveredFile, b: DiscoveredFile): DiscoveredFile {
  if (a.compressed !== b.compressed) return a.compressed ? b : a;
  if (a.size !== b.size) return a.size > b.size ? a : b;
  return a.path <= b.path ? a : b;
}

/**
 * Keeps exactly one file per `sessionId`.
 *
 * `sessionId` is derived from the filename alone, and compressing a rollout only appends `.zst` to
 * that name, so during Codex's compress-then-delete window `sessions/**\/rollout-<ts>-<uuid>.jsonl`
 * and `archived_sessions/**\/rollout-<ts>-<uuid>.jsonl.zst` are two files with one id. Shipping both
 * corrupts data on the server (one batch carrying two `SessionSummary` objects with the same
 * `sessionId`, and token events whose `(sessionId, seq)` upsert keys collide) and never settles
 * locally: every map downstream — `plannedById`, `applyAck`'s `acked`, `state.files` — is keyed by
 * `sessionId` and silently keeps only the last writer, so the stored `summaryHash` alternates
 * between the two and the session is re-uploaded on every run, forever.
 */
export function dedupeBySession(files: DiscoveredFile[]): { files: DiscoveredFile[]; duplicates: DuplicateSession[] } {
  const groups = new Map<string, DiscoveredFile[]>();
  for (const file of files) {
    const group = groups.get(file.sessionId);
    if (group) group.push(file);
    else groups.set(file.sessionId, [file]);
  }
  if (groups.size === files.length) return { files, duplicates: [] };
  const winners = new Set<DiscoveredFile>();
  const duplicates: DuplicateSession[] = [];
  for (const group of groups.values()) {
    const winner = group.reduce(preferredOf);
    winners.add(winner);
    for (const file of group) {
      if (file !== winner) duplicates.push({ sessionId: file.sessionId, kept: winner.path, dropped: file.path });
    }
  }
  return { files: files.filter((file) => winners.has(file)), duplicates };
}

export async function discoverRolloutFiles(
  codexHomes: string[],
  opts: { maxFiles?: number } = {},
): Promise<DiscoverResult> {
  const maxFiles = opts.maxFiles ?? CLI_MAX_FILES;
  const files: DiscoveredFile[] = [];
  const homes: DiscoverResult["homes"] = [];
  // Which `homes` entry each file was counted under, so a file dropped as a duplicate below can be
  // subtracted from the right one. Keyed by object identity, which survives the sort.
  const homeIndexOf = new Map<DiscoveredFile, number>();
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
      if (files.length < maxFiles) {
        for (const sub of SUBDIRS) await walk(path.join(home, sub), found, maxFiles + 1 - files.length);
      } else {
        truncated = true; // an existing home reached after the cap is already full is never examined
      }
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
      const file: DiscoveredFile = {
        ...parsed,
        path: full,
        codexHome: home,
        name,
        sessionId: parsed.rolloutId ? `${parsed.threadId}_${parsed.rolloutId}` : parsed.threadId,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
      files.push(file);
      homeIndexOf.set(file, homes.length);
      count += 1;
    }
    homes.push({ path: home, exists, files: count });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // Deduped after the sort so the winner never depends on walk order, and after the `maxFiles` cap
  // so `truncated` keeps meaning "we stopped scanning" rather than "we discarded a copy".
  const deduped = dedupeBySession(files);
  if (deduped.duplicates.length > 0) {
    const kept = new Set(deduped.files);
    for (const file of files) {
      if (kept.has(file)) continue;
      const index = homeIndexOf.get(file);
      if (index !== undefined) homes[index]!.files -= 1; // keep the per-home count = files processed
    }
  }
  return { files: deduped.files, truncated, homes, duplicates: deduped.duplicates };
}
