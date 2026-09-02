import { describe, expect, it } from "vitest";
import { MAX_QUERY_RANGE_DAYS } from "@shared/constants";

describe("workspace aliases", () => {
  it("resolves @shared/* from vitest", () => {
    expect(MAX_QUERY_RANGE_DAYS).toBe(1100);
  });
});
