import { describe, expect, it } from "vitest";
import { TOOL_KINDS, TTFT_BUCKETS_MS, TTFT_BUCKET_COUNT, SCHEMA_VERSION } from "./constants";

describe("constants", () => {
  it("has 16 TTFT buckets ending in +Infinity", () => {
    expect(TTFT_BUCKETS_MS).toHaveLength(TTFT_BUCKET_COUNT);
    expect(TTFT_BUCKETS_MS[15]).toBe(Number.POSITIVE_INFINITY);
    expect(TTFT_BUCKETS_MS[0]).toBe(250);
  });
  it("lists the nine fixed tool kinds", () => {
    expect(TOOL_KINDS).toEqual([
      "commandRead", "commandList", "commandSearch", "commandOther", "fileChange",
      "webSearch", "imageView", "mcpTool", "other",
    ]);
    expect(SCHEMA_VERSION).toBe(1);
  });
});
