import { CLI_BATCH_MAX_BYTES, CLI_BATCH_MAX_EVENTS, MAX_SESSIONS_PER_REQUEST } from "@codex-kaboo/shared/constants";
import type { SessionSummary, TokenEvent } from "@codex-kaboo/shared/sync";

export interface FileUpload {
  sessionId: string;
  summary: SessionSummary;
  events: TokenEvent[]; // only events not yet acknowledged
  summaryChanged: boolean;
}

export interface BatchFileEntry {
  sessionId: string;
  lastSeq: number; // highest seq shipped in this batch, -1 when none
  final: boolean; // the summary rides in this batch
}

export interface Batch {
  sessions: SessionSummary[];
  tokenEvents: TokenEvent[];
  files: BatchFileEntry[];
}

export interface BatchLimits {
  maxEvents: number;
  maxBytes: number;
  maxSessions: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = {
  maxEvents: CLI_BATCH_MAX_EVENTS,
  maxBytes: CLI_BATCH_MAX_BYTES,
  maxSessions: MAX_SESSIONS_PER_REQUEST,
};

export function eventBytes(event: TokenEvent): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
}

export function summaryBytes(summary: SessionSummary): number {
  return Buffer.byteLength(JSON.stringify(summary), "utf8") + 1;
}

function newBatch(): Batch {
  return { sessions: [], tokenEvents: [], files: [] };
}

export function buildBatches(uploads: FileUpload[], limits: BatchLimits = DEFAULT_BATCH_LIMITS): Batch[] {
  const batches: Batch[] = [];
  let current = newBatch();
  let bytes = 0;
  const isEmpty = (): boolean => current.files.length === 0 && current.tokenEvents.length === 0;
  const flush = (): void => {
    if (!isEmpty()) batches.push(current);
    current = newBatch();
    bytes = 0;
  };
  const pushSummary = (upload: FileUpload, lastSeq: number): void => {
    const size = summaryBytes(upload.summary);
    if (!isEmpty() && (bytes + size > limits.maxBytes || current.sessions.length >= limits.maxSessions)) {
      if (lastSeq >= 0) current.files.push({ sessionId: upload.sessionId, lastSeq, final: false });
      flush();
    }
    current.sessions.push(upload.summary);
    current.files.push({ sessionId: upload.sessionId, lastSeq, final: true });
    bytes += size;
  };

  for (const upload of uploads) {
    const events = [...upload.events].sort((a, b) => a.seq - b.seq);
    if (events.length === 0) {
      if (upload.summaryChanged) pushSummary(upload, -1);
      continue;
    }
    let i = 0;
    while (i < events.length) {
      const start = i;
      while (i < events.length) {
        const event = events[i]!;
        const size = eventBytes(event);
        const fits = current.tokenEvents.length < limits.maxEvents && bytes + size <= limits.maxBytes;
        if (!fits && !isEmpty()) break;
        current.tokenEvents.push(event); // an oversize event still ships alone in an empty batch
        bytes += size;
        i += 1;
        if (!fits) break;
      }
      if (i === start) {
        flush();
        continue;
      }
      const lastSeq = events[i - 1]!.seq;
      if (i >= events.length) {
        pushSummary(upload, lastSeq);
      } else {
        current.files.push({ sessionId: upload.sessionId, lastSeq, final: false });
        flush();
      }
    }
  }
  flush();
  return batches;
}

/** After a batch is acknowledged: drop finished files, trim shipped events from the rest. */
export function applyAck(uploads: FileUpload[], batch: Batch): FileUpload[] {
  const acked = new Map(batch.files.map((f) => [f.sessionId, f]));
  const remaining: FileUpload[] = [];
  for (const upload of uploads) {
    const entry = acked.get(upload.sessionId);
    if (!entry) {
      remaining.push(upload);
      continue;
    }
    if (entry.final) continue;
    remaining.push({ ...upload, events: upload.events.filter((e) => e.seq > entry.lastSeq) });
  }
  return remaining;
}
