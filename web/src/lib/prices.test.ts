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

  // Mirrors `SEED_PRICES` in web/convex/prices.ts — the typo-guard bound must never reject a real
  // seed model's price. The highest is `gpt-5.5` output at 30, roughly 333x below the bound.
  it.each([
    2, 0.2, 10, 0.2, 0.02, 1.2, 2, 0.2, 12, 5, 0.5, 30, 2.5, 0.25, 15, 0.75, 0.075, 4.5, 1.75, 0.175,
    14, 1.75, 0.175, 14, 1.25, 0.13, 10, 0.25, 0.03, 2, 1.25, 0.125, 10, 0.25, 0.025, 2, 2, 0.5, 8,
    1.1, 0.275, 4.4,
  ])("parses seed-table price %s", (price) => {
    expect(parsePrice(String(price))).toBe(price);
  });
});
