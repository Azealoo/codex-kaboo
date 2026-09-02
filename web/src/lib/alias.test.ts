import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "@shared/constants";
import { addDays } from "@shared/days";

describe("@shared alias", () => {
  it("resolves shared modules", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
