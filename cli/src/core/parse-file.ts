import { SessionSummary } from "@codex-kaboo/shared/sync";
import { createReducerState, finalize, reduceLine, type ParsedSession } from "../parser/session";
import type { DiscoveredFile } from "./discover";
import { readJsonlLines, type ReadResult } from "./jsonl-reader";

export interface ParseFileOptions {
  machineZone?: string;
  now: number;
  generation: number;
}

export interface ParseFileResult {
  parsed: ParsedSession;
  read: ReadResult;
}

export class InvalidSummaryError extends Error {
  constructor(public readonly issues: string[]) {
    super(`summary failed validation: ${issues.join("; ")}`);
    this.name = "InvalidSummaryError";
  }
}

/** One streaming pass from byte 0: reader → reducer → finalize → schema check. */
export async function parseRolloutFile(
  file: DiscoveredFile,
  opts: ParseFileOptions,
): Promise<ParseFileResult> {
  const state = createReducerState({
    sessionId: file.sessionId,
    threadId: file.threadId,
    rolloutId: file.rolloutId,
    fileTimestampMs: file.fileTimestampMs,
    machineZone: opts.machineZone,
  });
  const read = await readJsonlLines(
    file.path,
    (record) => reduceLine(state, record.seq, record.text),
    {
      compressed: file.compressed,
    },
  );
  const parsed = finalize(state, { now: opts.now, generation: opts.generation });
  const check = SessionSummary.safeParse(parsed.summary);
  if (!check.success) {
    throw new InvalidSummaryError(
      check.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return { parsed, read };
}
