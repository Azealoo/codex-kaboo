import { describe, expect, it } from "vitest";
import { costPerLine, costWithoutCaching } from "./efficiency";

describe("efficiency helpers", () => {
  it("guards cost per line and adds savings back", () => {
    expect(costPerLine(10, 0)).toBeNull();
    expect(costPerLine(10, 4)).toBe(2.5);
    expect(costWithoutCaching(10, 2.5)).toBe(12.5);
  });
});
