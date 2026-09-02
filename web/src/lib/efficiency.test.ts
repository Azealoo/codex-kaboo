import { describe, expect, it } from "vitest";
import { costPerLine, costWithoutCaching, withUnpriced } from "./efficiency";

describe("efficiency helpers", () => {
  it("guards cost per line and adds savings back", () => {
    expect(costPerLine(10, 0)).toBeNull();
    expect(costPerLine(10, 4)).toBe(2.5);
    expect(costWithoutCaching(10, 2.5)).toBe(12.5);
  });
  it("qualifies a dollar footer when the range contains an unpriced model", () => {
    expect(withUnpriced("Without caching: $12.50", [])).toBe("Without caching: $12.50");
    expect(withUnpriced(undefined, [])).toBeUndefined();
    expect(withUnpriced(undefined, ["codex-auto-review"])).toBe("Unpriced: codex-auto-review");
    expect(withUnpriced("Without caching: $12.50", ["codex-auto-review", "gpt-x"])).toBe(
      "Without caching: $12.50 · Unpriced: codex-auto-review, gpt-x",
    );
  });
});
