import { describe, expect, it } from "vitest";
import {
  dayHour,
  isValidZone,
  machineZone,
  parseLineTimestamp,
  resolveZone,
  secondsToMs,
} from "../../src/parser/time";

describe("timestamps", () => {
  it("parses ISO strings and numeric seconds/ms", () => {
    expect(parseLineTimestamp("2026-08-30T17:00:00.000Z")).toBe(Date.UTC(2026, 7, 30, 17));
    expect(parseLineTimestamp("not a date")).toBeNull();
    expect(parseLineTimestamp(undefined)).toBeNull();
    expect(parseLineTimestamp(1756573200)).toBe(1756573200000);
    expect(parseLineTimestamp(1756573200123)).toBe(1756573200123);
  });
  it("converts Unix seconds to ms and tolerates ms input", () => {
    expect(secondsToMs(1756573200)).toBe(1756573200000);
    expect(secondsToMs(1756573200.5)).toBe(1756573200500);
    expect(secondsToMs(1756573200123)).toBe(1756573200123);
    expect(secondsToMs(-1)).toBeNull();
    expect(secondsToMs("1756573200")).toBeNull();
    expect(secondsToMs(null)).toBeNull();
  });
});

describe("zones", () => {
  it("validates IANA zones and resolves session → fallback → undefined", () => {
    expect(isValidZone("Asia/Tokyo")).toBe(true);
    expect(isValidZone("Mars/Olympus")).toBe(false);
    expect(isValidZone("")).toBe(false);
    expect(isValidZone(5)).toBe(false);
    expect(resolveZone("Asia/Tokyo", "UTC")).toBe("Asia/Tokyo");
    expect(resolveZone("Mars/Olympus", "UTC")).toBe("UTC");
    expect(resolveZone(undefined, "Mars/Olympus")).toBeUndefined();
    const mz = machineZone();
    expect(mz === undefined || isValidZone(mz)).toBe(true);
  });
  it("delegates day/hour to the shared helper", () => {
    expect(dayHour(Date.UTC(2026, 0, 1, 0), "Asia/Tokyo")).toEqual({ day: "2026-01-01", hour: 9 });
  });
});
