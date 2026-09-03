/**
 * The card's cached copy of `GET /api/v1/summary`.
 *
 * Two jobs. First, the card renders instantly and works offline: whatever the server last said is
 * on disk, labelled with its age, instead of an empty card while a request is in flight. Second —
 * and this is the part that is cheap now and painful to retrofit — the cache is **identity
 * fenced**. It records which account, which token and which deployment produced it, and a snapshot
 * that does not match the config on disk is discarded rather than shown. Without that fence, the
 * first paint after `codex-kaboo login` as a different user is the *previous* user's numbers.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { SummaryResponse } from "@codex-kaboo/shared/summary";
import { writeJsonAtomic } from "../core/config";
import type { KabooPaths } from "../core/paths";
import type { Config } from "../types";

export const SNAPSHOT_VERSION = 1 as const;

/**
 * Who a snapshot belongs to. The token is reduced to its first 8 characters — enough to notice
 * that a different token is now configured, and no more of a secret than the dashboard already
 * prints beside each token.
 */
export interface SnapshotIdentity {
  userId: string;
  tokenPrefix: string;
  server: string;
}

export interface CachedSnapshot extends SnapshotIdentity {
  version: typeof SNAPSHOT_VERSION;
  fetchedAt: number;
  summary: SummaryResponse;
}

export function identityOf(config: Config): SnapshotIdentity {
  return {
    // A config written before `login` recorded the user id still has to fence on *something*, and
    // the token prefix alone does that: a second login writes a different token.
    userId: config.userId ?? "",
    tokenPrefix: config.token.slice(0, 8),
    server: config.server.replace(/\/+$/, ""),
  };
}

export function identityMatches(a: SnapshotIdentity, b: SnapshotIdentity): boolean {
  return a.userId === b.userId && a.tokenPrefix === b.tokenPrefix && a.server === b.server;
}

/** Stable hash of the numbers, ignoring `fetchedAt` — the field that changes on every poll. */
export function snapshotDigest(summary: SummaryResponse): string {
  const { serverTime: _serverTime, ...rest } = summary;
  return createHash("sha1").update(JSON.stringify(rest)).digest("hex");
}

/**
 * Reads the cache, returning null when it is missing, unreadable, malformed, written by a future
 * version, or — the important case — belongs to someone else.
 *
 * A rejected cache is not an error the caller has to handle: an empty card that fills in a moment
 * is correct, and a corrupt file heals on the next successful fetch.
 */
export async function readSnapshotCache(
  paths: KabooPaths,
  identity: SnapshotIdentity,
): Promise<CachedSnapshot | null> {
  let text: string;
  try {
    text = await fs.readFile(paths.cardSnapshot, "utf8");
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Partial<CachedSnapshot>;
  if (record.version !== SNAPSHOT_VERSION) return null;
  if (typeof record.fetchedAt !== "number") return null;
  if (
    typeof record.userId !== "string" ||
    typeof record.tokenPrefix !== "string" ||
    typeof record.server !== "string"
  ) {
    return null;
  }
  if (!identityMatches(record as SnapshotIdentity, identity)) return null;
  // Validated rather than trusted: a cache written by an older CLI can predate a schema change,
  // and half-parsed numbers on a card are worse than none.
  const parsed = SummaryResponse.safeParse(record.summary);
  if (!parsed.success) return null;
  return {
    version: SNAPSHOT_VERSION,
    userId: record.userId,
    tokenPrefix: record.tokenPrefix,
    server: record.server,
    fetchedAt: record.fetchedAt,
    summary: parsed.data,
  };
}

/**
 * Writes the cache unless the stored snapshot already holds the identical numbers.
 *
 * The digest gate is why an idle card does no disk work: a poll that finds nothing changed also
 * finds nothing to write. `fetchedAt` is deliberately outside the digest — refreshing it on every
 * poll would defeat the gate, and its only job is to age the "Synced 4m ago" label, which is
 * recomputed from the response anyway while the app is running.
 *
 * Returns whether it wrote.
 */
export async function writeSnapshotCache(
  paths: KabooPaths,
  identity: SnapshotIdentity,
  summary: SummaryResponse,
  fetchedAt: number,
): Promise<boolean> {
  const existing = await readSnapshotCache(paths, identity);
  if (existing !== null && snapshotDigest(existing.summary) === snapshotDigest(summary)) {
    return false;
  }
  const snapshot: CachedSnapshot = { version: SNAPSHOT_VERSION, ...identity, fetchedAt, summary };
  // 0600: the file holds one user's usage totals and a token prefix, and lives beside config.json.
  await writeJsonAtomic(paths.cardSnapshot, snapshot, 0o600);
  return true;
}

/** Removes the cache; used by `logout` so one account's numbers cannot outlive its login. */
export async function clearSnapshotCache(paths: KabooPaths): Promise<void> {
  await fs.rm(paths.cardSnapshot, { force: true });
}
