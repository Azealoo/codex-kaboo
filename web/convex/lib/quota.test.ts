import { describe, expect, it } from "vitest";
import { freshestRateLimit, type StoredRateLimit } from "./quota";

/** Stands in for a `Doc<"machines">`: an id to assert on, plus the field the ranking reads. */
type Machine = { id: string; lastRateLimit?: StoredRateLimit };

const reading = (receivedAt: number, observedAt: number, usedPercent: number): StoredRateLimit => ({
  usedPercent,
  windowMinutes: 10_080,
  observedAt,
  receivedAt,
});

describe("freshestRateLimit", () => {
  it("returns null when nothing has reported", () => {
    const machines: Machine[] = [{ id: "a" }, { id: "b" }];
    expect(freshestRateLimit<Machine>([])).toBeNull();
    expect(freshestRateLimit(machines)).toBeNull();
  });

  it("ignores machines with no reading", () => {
    const machines: Machine[] = [{ id: "a" }, { id: "b", lastRateLimit: reading(100, 100, 7) }];
    expect(freshestRateLimit(machines)?.machine.id).toBe("b");
  });

  it("ignores a client clock running ahead of the server's", () => {
    // `a` claims to have observed its reading a day later — a fast RTC, or a machine resuming from
    // sleep. It must not win, or the shared gauge freezes on its number forever.
    const machines: Machine[] = [
      { id: "a", lastRateLimit: reading(100, 86_400_100, 90) },
      { id: "b", lastRateLimit: reading(200, 200, 7) },
    ];
    expect(freshestRateLimit(machines)?.snapshot.usedPercent).toBe(7);
  });

  it("does not let a machine catching up after being offline win on arrival time alone", () => {
    // `a` was offline for a day and has just synced, so its reading ARRIVED most recently while
    // being the oldest one anyone holds. Ranking on `receivedAt` alone picked it and walked the
    // shared gauge backwards past `b`'s fresher number.
    const machines: Machine[] = [
      { id: "a", lastRateLimit: reading(1_000, 100, 90) },
      { id: "b", lastRateLimit: reading(900, 900, 7) },
    ];
    expect(freshestRateLimit(machines)?.machine.id).toBe("b");
  });

  it("breaks a freshness tie on the server's receive time", () => {
    const machines: Machine[] = [
      { id: "a", lastRateLimit: reading(300, 200, 90) },
      { id: "b", lastRateLimit: reading(400, 200, 7) },
    ];
    expect(freshestRateLimit(machines)?.machine.id).toBe("b");
  });

  it("does not depend on the order it sees machines in", () => {
    const machines: Machine[] = [
      { id: "a", lastRateLimit: reading(300, 300, 5) },
      { id: "b", lastRateLimit: reading(200, 200, 7) },
      { id: "c", lastRateLimit: reading(100, 100, 9) },
    ];
    expect(freshestRateLimit(machines)?.machine.id).toBe("a");
    expect(freshestRateLimit([...machines].reverse())?.machine.id).toBe("a");
  });
});
