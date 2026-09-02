import { promises as fs } from "node:fs";
import type { FileState, SyncState } from "../types";
import { writeJsonAtomic } from "./config";
import type { KabooPaths } from "./paths";

export const TAIL_BYTES = 64;

export function emptyState(): SyncState {
  return {
    version: 1,
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

export async function readState(paths: KabooPaths): Promise<{ state: SyncState; corrupt: boolean }> {
  let text: string;
  try {
    text = await fs.readFile(paths.state, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: emptyState(), corrupt: false };
    throw error;
  }
  try {
    const raw = JSON.parse(text) as Partial<SyncState> | null;
    if (!raw || raw.version !== 1 || typeof raw.files !== "object" || raw.files === null) {
      return { state: emptyState(), corrupt: true };
    }
    return { state: { ...emptyState(), ...raw, version: 1, files: raw.files }, corrupt: false };
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
  return { ...emptyFileState(filePath), generation: previous === undefined ? 0 : previous.generation + 1 };
}

/** `sync --full`: forget every file's progress but keep generations increasing. */
export function resetAllFiles(state: SyncState): SyncState {
  const files: Record<string, FileState> = {};
  for (const [sessionId, file] of Object.entries(state.files)) files[sessionId] = resetFileState(file, file.path);
  return { ...state, files };
}

export type ResetReason = "shrunk" | "tail-mismatch";

/** Null when the bytes before `offset` still match the recorded tail (so the file only grew). */
export async function detectReset(fileState: FileState, filePath: string, size: number): Promise<ResetReason | null> {
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

export function isUnchanged(fileState: FileState | undefined, size: number, mtimeMs: number): boolean {
  return (
    fileState !== undefined &&
    fileState.lastError === null &&
    fileState.size === size &&
    fileState.mtimeMs === mtimeMs
  );
}
