import { describe, expect, it } from "vitest";
import { parsePrice } from "./prices";

describe("parsePrice", () => {
  it.each([
    ["2", 2],
    ["0.125", 0.125],
    [" 10.5 ", 10.5],
    ["0", 0],
    ["-1", null],
    ["abc", null],
    ["", null],
    ["1e400", null],
    ["10000", 10000],
    ["10000.01", null],
    // A fat-fingered magnitude, not just a malicious one — this is the realistic failure the bound
    // guards against (e.g. `2000000` typed for `2.00`).
    ["1".repeat(38), null],
  ])("%s → %s", (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });
});
