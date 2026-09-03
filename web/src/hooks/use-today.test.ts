import { describe, expect, it } from "vitest";
import { localDay } from "./use-today";

describe("localDay", () => {
  it("formats a local Date as YYYY-MM-DD with zero padding", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDay(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});
