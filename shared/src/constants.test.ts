import { describe, expect, it } from "vitest";
import {
  MAX_DAYS_PER_EVENT_CHUNK,
  MAX_EVENTS_PER_MUTATION,
  TOOL_KINDS,
  TTFT_BUCKETS_MS,
  TTFT_BUCKET_COUNT,
  SCHEMA_VERSION,
} from "./constants";

describe("constants", () => {
  it("has 16 TTFT buckets ending in +Infinity", () => {
    expect(TTFT_BUCKETS_MS).toHaveLength(TTFT_BUCKET_COUNT);
    expect(TTFT_BUCKETS_MS[15]).toBe(Number.POSITIVE_INFINITY);
    expect(TTFT_BUCKETS_MS[0]).toBe(250);
  });
  it("lists the nine fixed tool kinds", () => {
    expect(TOOL_KINDS).toEqual([
      "commandRead",
      "commandList",
      "commandSearch",
      "commandOther",
      "fileChange",
      "webSearch",
      "imageView",
      "mcpTool",
      "other",
    ]);
    expect(SCHEMA_VERSION).toBe(1);
  });
  it("keeps one upsert mutation's worst-case document reads well under Convex's ~32k ceiling", () => {
    // Each touched day costs one full recomputeDay (that day's tokenEvents + sessions re-read) in
    // the same mutation, and a resend that moves events to another day touches up to 2x the days.
    expect(MAX_DAYS_PER_EVENT_CHUNK).toBe(10);
    expect(MAX_EVENTS_PER_MUTATION * MAX_DAYS_PER_EVENT_CHUNK * 2).toBeLessThan(32_000);
  });
});
