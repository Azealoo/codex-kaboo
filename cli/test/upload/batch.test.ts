import { describe, expect, it } from "vitest";
import {
  CLI_BATCH_MAX_BYTES,
  CLI_BATCH_MAX_EVENTS,
  MAX_SESSIONS_PER_REQUEST,
} from "@codex-kaboo/shared/constants";
import { SyncBatch } from "@codex-kaboo/shared/sync";
import { makeEvent, makeMachine, makeSummary } from "@codex-kaboo/shared/test-fixtures";
import {
  applyAck,
  buildBatches,
  DEFAULT_BATCH_LIMITS,
  eventBytes,
  type Batch,
  type FileUpload,
} from "../../src/upload/batch";

function upload(sessionId: string, seqs: number[], summaryChanged = true): FileUpload {
  return {
    sessionId,
    summary: makeSummary({ sessionId, threadId: sessionId }),
    events: seqs.map((seq) => makeEvent({ sessionId, seq })),
    summaryChanged,
  };
}
const LIMITS = { maxEvents: 1000, maxBytes: 3_500_000, maxSessions: 500 };

describe("buildBatches", () => {
  it("coalesces small files into one batch with final entries", () => {
    const batches = buildBatches(
      [upload("a", [3, 1, 2]), upload("b", [7]), upload("c", [], true), upload("d", [], false)],
      LIMITS,
    );
    expect(batches).toHaveLength(1);
    const b = batches[0]!;
    expect(b.sessions.map((s) => s.sessionId)).toEqual(["a", "b", "c"]);
    expect(b.tokenEvents.map((e) => `${e.sessionId}:${e.seq}`)).toEqual([
      "a:1",
      "a:2",
      "a:3",
      "b:7",
    ]);
    expect(b.files).toEqual([
      { sessionId: "a", lastSeq: 3, final: true },
      { sessionId: "b", lastSeq: 7, final: true },
      { sessionId: "c", lastSeq: -1, final: true },
    ]);
  });
  it("splits a big file by maxEvents and ships the summary with the last chunk", () => {
    const seqs = Array.from({ length: 2500 }, (_, i) => i);
    const batches = buildBatches([upload("big", seqs), upload("tiny", [0])], LIMITS);
    expect(batches.map((b) => b.tokenEvents.length)).toEqual([1000, 1000, 501]);
    expect(batches[0]!.files).toEqual([{ sessionId: "big", lastSeq: 999, final: false }]);
    expect(batches[0]!.sessions).toEqual([]);
    expect(batches[1]!.files).toEqual([{ sessionId: "big", lastSeq: 1999, final: false }]);
    expect(batches[2]!.files).toEqual([
      { sessionId: "big", lastSeq: 2499, final: true },
      { sessionId: "tiny", lastSeq: 0, final: true },
    ]);
    expect(batches[2]!.sessions.map((s) => s.sessionId)).toEqual(["big", "tiny"]);
  });
  it("splits by bytes and never loops on an oversize event", () => {
    const events = [0, 1, 2, 3].map((seq) => makeEvent({ sessionId: "x", seq }));
    const perEvent = eventBytes(events[0]!);
    const batches = buildBatches(
      [{ sessionId: "x", summary: makeSummary({ sessionId: "x" }), events, summaryChanged: true }],
      { maxEvents: 1000, maxBytes: perEvent * 2 + 10, maxSessions: 500 },
    );
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches.flatMap((b) => b.tokenEvents.map((e) => e.seq))).toEqual([0, 1, 2, 3]);
    expect(batches[batches.length - 1]!.files.some((f) => f.sessionId === "x" && f.final)).toBe(
      true,
    );
    const single = buildBatches(
      [
        {
          sessionId: "y",
          summary: makeSummary({ sessionId: "y" }),
          events: [makeEvent({ sessionId: "y", seq: 0 })],
          summaryChanged: true,
        },
      ],
      { maxEvents: 1000, maxBytes: 10, maxSessions: 500 },
    );
    expect(single.flatMap((b) => b.tokenEvents)).toHaveLength(1);
  });
  it("respects maxSessions", () => {
    const uploads = Array.from({ length: 3 }, (_, i) => upload(`s${i}`, [0]));
    const batches = buildBatches(uploads, { maxEvents: 1000, maxBytes: 3_500_000, maxSessions: 2 });
    expect(batches.map((b) => b.sessions.length)).toEqual([2, 1]);
  });
});

describe("applyAck", () => {
  it("drops finished files and trims acknowledged events", () => {
    const uploads = [upload("a", [0, 1, 2]), upload("b", [5, 6])];
    const remaining = applyAck(uploads, {
      sessions: [],
      tokenEvents: [],
      files: [
        { sessionId: "a", lastSeq: 1, final: false },
        { sessionId: "b", lastSeq: 6, final: true },
      ],
    });
    expect(remaining.map((u) => [u.sessionId, u.events.map((e) => e.seq)])).toEqual([["a", [2]]]);
  });
});

describe("DEFAULT_BATCH_LIMITS", () => {
  it("wires up to the shared CLI batch constants (1,000 events / 3.5 MB / 500 sessions)", () => {
    expect(DEFAULT_BATCH_LIMITS).toEqual({
      maxEvents: CLI_BATCH_MAX_EVENTS,
      maxBytes: CLI_BATCH_MAX_BYTES,
      maxSessions: MAX_SESSIONS_PER_REQUEST,
    });
    expect(DEFAULT_BATCH_LIMITS.maxEvents).toBe(1000);
  });
});

/** Batches out of this module carry no `SyncBatch` envelope fields (schemaVersion, batchId, machine, ...) —
 * the upload client (Task 19) adds those. This fills them in to confirm the payload shape stays valid. */
function toSyncBatch(batch: Batch, rateLimit?: unknown) {
  return {
    schemaVersion: 1 as const,
    parserVersion: 1,
    cliVersion: "0.1.0",
    batchId: "test-batch",
    sentAt: Date.UTC(2026, 7, 30),
    machine: makeMachine(),
    sessions: batch.sessions,
    tokenEvents: batch.tokenEvents,
    ...(rateLimit ? { rateLimit } : {}),
  };
}

describe("SyncBatch validity", () => {
  it("every produced batch validates against the shared SyncBatch schema once wrapped in an envelope", () => {
    const seqs = Array.from({ length: 2500 }, (_, i) => i);
    const scenarios: Batch[] = [
      ...buildBatches(
        [upload("a", [3, 1, 2]), upload("b", [7]), upload("c", [], true), upload("d", [], false)],
        LIMITS,
      ),
      ...buildBatches([upload("big", seqs), upload("tiny", [0])], LIMITS),
      ...buildBatches(
        Array.from({ length: 3 }, (_, i) => upload(`s${i}`, [0])),
        { maxEvents: 1000, maxBytes: 3_500_000, maxSessions: 2 },
      ),
    ];
    expect(scenarios.length).toBeGreaterThan(0);
    for (const batch of scenarios) {
      const result = SyncBatch.safeParse(toSyncBatch(batch));
      expect(result.success).toBe(true);
    }
  });
});

describe("heartbeat", () => {
  it("buildBatches ships no batch when nothing changed, leaving the caller to send a machine-only heartbeat", () => {
    expect(buildBatches([], LIMITS)).toEqual([]);
    expect(buildBatches([upload("d", [], false)], LIMITS)).toEqual([]);
  });
  it("a machine-only heartbeat (sessions: [], tokenEvents: [], optional rateLimit) validates against SyncBatch", () => {
    const emptyBatch: Batch = { sessions: [], tokenEvents: [], files: [] };
    expect(SyncBatch.safeParse(toSyncBatch(emptyBatch)).success).toBe(true);
    const withRateLimit = SyncBatch.safeParse(
      toSyncBatch(emptyBatch, {
        observedAt: Date.UTC(2026, 7, 30),
        usedPercent: 12.5,
        windowMinutes: 10080,
      }),
    );
    expect(withRateLimit.success).toBe(true);
  });
});
