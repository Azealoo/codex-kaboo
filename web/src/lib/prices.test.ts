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
  ])("%s → %s", (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });
});
