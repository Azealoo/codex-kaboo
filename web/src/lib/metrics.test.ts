import { describe, expect, it } from "vitest";
import {
  EFFICIENCY_CARD_KEYS,
  METRIC_DEFS,
  USER_OVERVIEW_KEYS,
  VOLUME_CARD_KEYS,
  deltaTone,
  formatMetricValue,
} from "./metrics";

describe("METRIC_DEFS", () => {
  it("defines every card key", () => {
    for (const key of [...VOLUME_CARD_KEYS, ...EFFICIENCY_CARD_KEYS, ...USER_OVERVIEW_KEYS]) {
      expect(METRIC_DEFS[key].label.length).toBeGreaterThan(0);
      expect(METRIC_DEFS[key].help.length).toBeGreaterThan(0);
    }
    expect(USER_OVERVIEW_KEYS).toHaveLength(15);
  });
  it("surfaces the sub-agent split the rollups compute", () => {
    // Both were folded into every rollup and rendered nowhere, so the README's rule — sub-agent
    // threads count toward tokens but not toward sessions — was unverifiable on screen. Showing
    // them next to `sessions` and `totalTokens` is what makes those two numbers legible.
    expect(USER_OVERVIEW_KEYS).toContain("subagentTokens");
    expect(USER_OVERVIEW_KEYS).toContain("subagentSessions");
  });
  it("marks latency and waste metrics as lower-is-better", () => {
    expect(METRIC_DEFS.ttftP50Ms.goodDirection).toBe("down");
    expect(METRIC_DEFS.tokensPerLine.goodDirection).toBe("down");
    expect(METRIC_DEFS.compactions.goodDirection).toBe("down");
    expect(METRIC_DEFS.cacheHitRate.goodDirection).toBe("up");
    expect(METRIC_DEFS.totalTokens.goodDirection).toBe("up");
  });
  it("marks metrics with no better direction as neutral", () => {
    expect(METRIC_DEFS.costUsd.goodDirection).toBe("neutral");
    expect(METRIC_DEFS.linesRemoved.goodDirection).toBe("neutral");
  });
});

describe("formatMetricValue", () => {
  it.each([
    ["tokens", 1_234_567, "1.2M"],
    ["usd", 12.5, "$12.50"],
    ["percent", 0.42, "42.0%"],
    ["duration", 725_000, "12m 5s"],
    ["hours", 45_000_000, "12.5h"],
    ["count", 1234, "1,234"],
    ["ratio", 3.456, "3.5"],
  ] as const)("%s %s → %s", (kind, value, expected) => {
    expect(formatMetricValue(kind, value)).toBe(expected);
  });
  it("renders null as an em dash", () => {
    expect(formatMetricValue("percent", null)).toBe("—");
  });
});

describe("deltaTone", () => {
  it("is positive when the change goes in the good direction", () => {
    expect(deltaTone(0.2, "up")).toEqual({ tone: "up", good: true });
    expect(deltaTone(-0.2, "up")).toEqual({ tone: "down", good: false });
    expect(deltaTone(-0.2, "down")).toEqual({ tone: "down", good: true });
    expect(deltaTone(0.2, "down")).toEqual({ tone: "up", good: false });
  });
  it("is flat for zero or unknown", () => {
    expect(deltaTone(0, "up")).toEqual({ tone: "flat", good: null });
    expect(deltaTone(null, "up")).toEqual({ tone: "flat", good: null });
  });
  it("keeps the direction but no verdict for neutral metrics", () => {
    expect(deltaTone(0.2, "neutral")).toEqual({ tone: "up", good: null });
    expect(deltaTone(-0.2, "neutral")).toEqual({ tone: "down", good: null });
  });
});
