import type { RateLimitSnapshot } from "@codex-kaboo/shared";

/** ~/.codex-kaboo/config.json (mode 0600). */
export interface Config {
  server: string;
  token: string;
  machineId: string;
  label: string;
  hostnameOptIn: boolean;
  codexHomes: string[];
  userId?: string;
  userName?: string | null;
  userEmail?: string | null;
  tokenName?: string;
  loggedInAt?: number;
}

/** Per-rollout-file progress, keyed by sessionId in SyncState.files. */
export interface FileState {
  path: string; // local only, never uploaded
  offset: number; // bytes consumed up to and including the last '\n'
  lines: number; // complete lines consumed
  size: number;
  mtimeMs: number;
  tail: string; // base64 of the last ≤ 64 bytes before `offset`
  lastUploadedSeq: number; // -1 when no event was acknowledged yet
  summaryHash: string | null; // hash acknowledged by the server
  generation: number; // incremented on every reset
  complete: boolean; // immutable file fully processed (.zst)
  lastError: string | null;
  /**
   * Consecutive failures with the identical `lastError`, plus the file's size/mtime when the last
   * one was recorded. Absent whenever the file last succeeded, and reset to a count of 1 as soon as
   * the file changes or fails a different way — so this only ever accumulates for a file that is
   * genuinely, repeatably broken. Optional so a state.json written by an older CLI still loads.
   */
  failure?: { count: number; size: number; mtimeMs: number };
}

/** ~/.codex-kaboo/state.json */
export interface SyncState {
  version: 1; // state.json's own format version
  /**
   * The PARSER_VERSION that produced the stored per-file progress. `null` in a state.json written
   * before this field existed. When it differs from the running parser, `sync` re-uploads every
   * file once (see `runSync`) — the only way a corrected event field reaches a row the server has
   * already stored, since an ordinary run never re-sends an event whose seq was acknowledged.
   */
  parserVersion: number | null;
  lastSyncAt: number | null;
  lastSyncOk: boolean | null;
  lastError: string | null;
  lastHeartbeatAt: number | null;
  latestCliVersion: string | null;
  codexVersion: string | null; // newest session_meta.cli_version ever parsed
  rateLimit: RateLimitSnapshot | null; // newest snapshot acknowledged by the server
  files: Record<string, FileState>;
}
