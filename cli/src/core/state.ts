import { promises as fs } from "node:fs";
import { PARSER_VERSION } from "@codex-kaboo/shared";
import type { FileState, SyncState } from "../types";
import { writeJsonAtomic } from "./config";
import type { KabooPaths } from "./paths";

export const TAIL_BYTES = 64;

export function emptyState(): SyncState {
  return {
    version: 1,
    parserVersion: PARSER_VERSION, // nothing uploaded yet, so nothing to re-upload
    lastSyncAt: null,
    lastSyncOk: null,
    lastError: null,
    lastHeartbeatAt: null,
    latestCliVersion: null,
    codexVersion: null,
    rateLimit: null,
    files: {},
  };
}

export async function readState(
  paths: KabooPaths,
): Promise<{ state: SyncState; corrupt: boolean }> {
  let text: string;
  try {
    text = await fs.readFile(paths.state, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { state: emptyState(), corrupt: false };
    throw error;
  }
  try {
    const raw = JSON.parse(text) as Partial<SyncState> | null;
    if (!raw || raw.version !== 1 || typeof raw.files !== "object" || raw.files === null) {
      return { state: emptyState(), corrupt: true };
    }
    return {
      state: {
        ...emptyState(),
        ...raw,
        version: 1,
        // Spreading `raw` cannot supply an absent key, and emptyState()'s value is the CURRENT
        // parser — which would silently mean "already up to date" for exactly the old state files
        // that need the re-upload. Read it explicitly so absent means null, i.e. stale.
        parserVersion: typeof raw.parserVersion === "number" ? raw.parserVersion : null,
        files: raw.files,
      },
      corrupt: false,
    };
  } catch {
    return { state: emptyState(), corrupt: true };
  }
}

export async function writeState(paths: KabooPaths, state: SyncState): Promise<void> {
  await writeJsonAtomic(paths.state, state);
}

export function emptyFileState(filePath: string): FileState {
  return {
    path: filePath,
    offset: 0,
    lines: 0,
    size: 0,
    mtimeMs: 0,
    tail: "",
    lastUploadedSeq: -1,
    summaryHash: null,
    generation: 0,
    complete: false,
    lastError: null,
  };
}

export function resetFileState(previous: FileState | undefined, filePath: string): FileState {
  return {
    ...emptyFileState(filePath),
    generation: previous === undefined ? 0 : previous.generation + 1,
  };
}

/** `sync --full`: forget every file's progress but keep generations increasing. */
export function resetAllFiles(state: SyncState): SyncState {
  const files: Record<string, FileState> = {};
  for (const [sessionId, file] of Object.entries(state.files))
    files[sessionId] = resetFileState(file, file.path);
  return { ...state, files };
}

export type ResetReason = "shrunk" | "tail-mismatch";

/** Null when the bytes before `offset` still match the recorded tail (so the file only grew). */
export async function detectReset(
  fileState: FileState,
  filePath: string,
  size: number,
): Promise<ResetReason | null> {
  if (fileState.offset === 0) return null;
  if (size < fileState.offset) return "shrunk";
  const start = Math.max(0, fileState.offset - TAIL_BYTES);
  const length = fileState.offset - start;
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const tail = buffer.subarray(0, bytesRead).toString("base64");
    return tail === fileState.tail ? null : "tail-mismatch";
  } finally {
    await handle.close();
  }
}

export function isUnchanged(
  fileState: FileState | undefined,
  size: number,
  mtimeMs: number,
): boolean {
  return (
    fileState !== undefined &&
    fileState.lastError === null &&
    fileState.size === size &&
    fileState.mtimeMs === mtimeMs
  );
}

/**
 * How many times one unchanged file may fail the same way before it is parked.
 *
 * `isUnchanged` returns false while `lastError` is set, so a failing file is re-parsed and re-sent
 * on every run — right for a transient server-side 400, but a permanently invalid summary (a
 * rollout written while the machine's clock was wrong, say, whose timestamps fall outside the
 * schema's [2020, 2100) bound) then fails identically forever and pins every scheduled run at
 * exit 1. Six attempts is well past any transient fault, and parking is never permanent: the
 * counter is keyed to the file's size and mtime, so any edit at all starts it over.
 */
export const MAX_FILE_FAILURES = 5;

/** Records one failure, incrementing the counter only when the same file failed the same way. */
export function recordFailure(
  previous: FileState,
  error: string,
  size: number,
  mtimeMs: number,
): FileState {
  const repeat =
    previous.lastError === error &&
    previous.failure !== undefined &&
    previous.failure.size === size &&
    previous.failure.mtimeMs === mtimeMs;
  return {
    ...previous,
    lastError: error,
    failure: { count: repeat ? previous.failure!.count + 1 : 1, size, mtimeMs },
  };
}

/** Clears any recorded failure: the file went through, so the next problem starts from zero. */
export function clearFailure(fileState: FileState): FileState {
  const { failure: _failure, ...rest } = fileState;
  return { ...rest, lastError: null };
}

/**
 * True when this exact file has failed the same way more than `MAX_FILE_FAILURES` times.
 * `lastError` is checked too, so a stale counter can never park a file that is now succeeding.
 */
export function isPermanentlyFailing(
  fileState: FileState | undefined,
  size: number,
  mtimeMs: number,
): boolean {
  const failure = fileState?.failure;
  if (failure === undefined || fileState?.lastError == null) return false;
  return failure.count > MAX_FILE_FAILURES && failure.size === size && failure.mtimeMs === mtimeMs;
}
