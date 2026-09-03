import { describe, expect, it } from "vitest";
import { bucketize, niceMax, trimSamples, type TpsSample } from "../../src/card/buckets";

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0); // a multiple of 5 s, so `now` starts a bucket

const sample = (offsetMs: number, output: number, over: Partial<TpsSample> = {}): TpsSample => ({
  ts: NOW + offsetMs,
  output,
  model: "gpt-5.6-sol",
  sessionId: "s1",
  ...over,
});

describe("bucketize", () => {
  it("fills a 3-minute window with 5-second buckets, oldest first", () => {
    const w = bucketize([], NOW);
    expect(w.buckets).toHaveLength(36);
    expect(w.bucketMs).toBe(5000);
    expect(w.buckets[0]?.startMs).toBe(NOW - 35 * 5000);
    expect(w.buckets[35]?.startMs).toBe(NOW);
    expect(w.to).toBe(NOW + 5000);
    expect(w.totalOutput).toBe(0);
    expect(w.currentTps).toBe(0);
    expect(w.averageTps).toBe(0);
    expect(w.models).toEqual([]);
  });

  it("puts a sample in the bucket its timestamp falls in", () => {
    const w = bucketize([sample(-12_000, 50)], NOW);
    // -12 s lands in the bucket starting 15 s before now (absolute 5 s boundaries).
    const bucket = w.buckets.find((b) => b.output > 0);
    expect(bucket?.startMs).toBe(NOW - 15_000);
    expect(bucket?.output).toBe(50);
  });

  it("reads current TPS off the last COMPLETE bucket, not the one still filling", () => {
    // 100 tokens in the bucket that contains `now` (still filling) and 50 in the one before it.
    const w = bucketize([sample(1000, 100), sample(-3000, 50)], NOW);
    expect(w.currentTps).toBe(10); // 50 / 5 s
    expect(w.totalOutput).toBe(150);
  });

  it("averages over the whole window, not over the buckets that have data", () => {
    const w = bucketize([sample(-10_000, 180)], NOW);
    expect(w.averageTps).toBeCloseTo(1, 10); // 180 tokens / 180 s
    expect(w.peakTps).toBe(36); // 180 / 5 s
  });

  it("counts only output tokens that fall inside the window", () => {
    const w = bucketize([sample(-10_000, 30), sample(-10 * 60_000, 5000)], NOW);
    expect(w.totalOutput).toBe(30);
  });

  it("splits a bucket by model, biggest first", () => {
    const w = bucketize(
      [
        sample(-3000, 20, { model: "b" }),
        sample(-3000, 60, { model: "a" }),
        sample(-3000, 60, { model: "c" }),
      ],
      NOW,
    );
    const bucket = w.buckets[w.buckets.length - 2];
    expect(bucket?.output).toBe(140);
    expect(bucket?.byModel).toEqual([
      { key: "a", output: 60 },
      { key: "c", output: 60 },
      { key: "b", output: 20 },
    ]);
    expect(w.models).toEqual(["a", "c", "b"]);
  });

  it("counts a session active on recent output only", () => {
    const w = bucketize(
      [
        sample(-30_000, 10, { sessionId: "recent" }),
        sample(-5 * 60_000, 10, { sessionId: "old" }),
        sample(-1000, 0, { sessionId: "silent" }),
      ],
      NOW,
    );
    // `old` produced nothing in the last two minutes; `silent` produced no tokens at all.
    expect(w.activeSessions).toBe(1);
  });

  it("keeps bucket boundaries absolute as the window slides", () => {
    const s = [sample(-7000, 40)];
    const before = bucketize(s, NOW);
    const after = bucketize(s, NOW + 5000);
    const startOf = (w: ReturnType<typeof bucketize>) =>
      w.buckets.find((b) => b.output > 0)?.startMs;
    expect(startOf(before)).toBe(startOf(after));
  });

  it("honours a custom window and bucket width", () => {
    const w = bucketize([sample(-1000, 60)], NOW, { windowMs: 60_000, bucketMs: 10_000 });
    expect(w.buckets).toHaveLength(6);
    expect(w.averageTps).toBe(1); // 60 tokens / 60 s
  });
});

describe("trimSamples", () => {
  it("drops everything older than the retention window", () => {
    const kept = trimSamples([sample(-60_000, 1), sample(-31 * 60_000, 1)], NOW, 30 * 60_000);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.ts).toBe(NOW - 60_000);
  });
});

describe("niceMax", () => {
  it("never drops below the floor", () => {
    expect(niceMax(0)).toBe(20);
    expect(niceMax(3)).toBe(20);
  });

  it("rounds up onto the 1/2/5 ladder", () => {
    expect(niceMax(21)).toBe(50);
    expect(niceMax(60)).toBe(100);
    expect(niceMax(101)).toBe(200);
    expect(niceMax(2500)).toBe(5000);
  });

  it("returns an exact power of ten unchanged", () => {
    expect(niceMax(100)).toBe(100);
    expect(niceMax(1000)).toBe(1000);
  });
});
