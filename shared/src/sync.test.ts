import { describe, expect, it } from "vitest";
import { ErrorResponse, SessionSummary, SyncBatch, SyncResponse, TokenEvent, WhoamiResponse } from "./sync";
import { makeBatch, makeEvent, makeSummary } from "./test-fixtures";

describe("SyncBatch", () => {
  it("parses a valid batch and strips unknown keys", () => {
    const raw = { ...makeBatch(), extra: "nope", machine: { ...makeBatch().machine, secret: "x" } };
    const result = SyncBatch.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as Record<string, unknown>).extra).toBeUndefined();
    expect((result.data.machine as Record<string, unknown>).secret).toBeUndefined();
    expect(result.data.machine.hostname).toBeNull();
  });
  it("rejects a wrong schema version", () => {
    expect(SyncBatch.safeParse({ ...makeBatch(), schemaVersion: 2 }).success).toBe(false);
  });
  it("rejects more than 5000 events", () => {
    const events = Array.from({ length: 5001 }, (_, i) => makeEvent({ seq: i }));
    expect(SyncBatch.safeParse(makeBatch({ tokenEvents: events })).success).toBe(false);
    expect(SyncBatch.safeParse(makeBatch({ tokenEvents: events.slice(0, 5000) })).success).toBe(true);
  });
  it("accepts an optional rate limit snapshot", () => {
    const batch = makeBatch({
      rateLimit: { observedAt: Date.UTC(2026, 7, 30), usedPercent: 12.5, windowMinutes: 10080, resetsAt: Date.UTC(2026, 8, 5), planType: "pro", limitId: "weekly" },
    });
    expect(SyncBatch.safeParse(batch).success).toBe(true);
  });
});

describe("SessionSummary", () => {
  it("rejects invalid days, short histograms and bad hashes", () => {
    expect(SessionSummary.safeParse(makeSummary({ day: "2026-02-30" })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ ttft: { count: 0, sumMs: 0, hist: new Array(15).fill(0) } })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ summaryHash: "ABCDEF" })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ tokens: { input: -1, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 } })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ startedAt: Date.UTC(2019, 0, 1) })).success).toBe(false);
  });
  it("caps keyed arrays at 64 entries", () => {
    const skills = Array.from({ length: 65 }, (_, i) => ({ key: `s${i}`, count: 1 }));
    expect(SessionSummary.safeParse(makeSummary({ skills })).success).toBe(false);
    expect(SessionSummary.safeParse(makeSummary({ skills: skills.slice(0, 64) })).success).toBe(true);
  });
});

describe("TokenEvent", () => {
  it("validates hour and integer counts", () => {
    expect(TokenEvent.safeParse(makeEvent({ hour: 24 })).success).toBe(false);
    expect(TokenEvent.safeParse(makeEvent({ input: 1.5 })).success).toBe(false);
    expect(TokenEvent.safeParse(makeEvent({ effort: undefined, turnId: undefined, contextWindow: undefined })).success).toBe(true);
  });
});

describe("responses", () => {
  it("parses success, error and whoami bodies", () => {
    expect(SyncResponse.safeParse({
      ok: true,
      accepted: { sessions: { inserted: 1, updated: 0, unchanged: 0 }, events: { inserted: 3, updated: 0, unchanged: 0 } },
      conflicts: { sessions: [], events: 0 },
      serverTime: 1,
      latestCliVersion: null,
      limits: { maxBodyBytes: 8388608, maxSessions: 500, maxEvents: 5000 },
    }).success).toBe(true);
    expect(ErrorResponse.safeParse({ ok: false, error: "unauthorized" }).success).toBe(true);
    expect(ErrorResponse.safeParse({ ok: false, error: "brand_new_code", message: "x" }).success).toBe(true);
    expect(WhoamiResponse.safeParse({ ok: true, userId: "u1", name: null, email: "a@b.c", token: { name: "mac", prefix: "ck_3f9a1c" }, serverTime: 1 }).success).toBe(true);
  });
});
