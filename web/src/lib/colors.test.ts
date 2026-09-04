import { describe, expect, it } from "vitest";
import {
  CATEGORICAL,
  OTHER_COLOR,
  assignSlots,
  colorFor,
  heatColor,
  modelColorMap,
  modelRegistryOrder,
  quotaColor,
  userColorMap,
} from "./colors";

describe("assignSlots", () => {
  it("assigns the fixed palette in order and folds the 9th into gray", () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const map = assignSlots(keys);
    expect(map.get("a")).toBe(CATEGORICAL[0]);
    expect(map.get("h")).toBe(CATEGORICAL[7]);
    expect(map.get("i")).toBe(OTHER_COLOR);
    expect(colorFor(map, "unknown")).toBe(OTHER_COLOR);
  });
  it("ignores duplicate keys", () => {
    const map = assignSlots(["a", "a", "b"]);
    expect(map.get("b")).toBe(CATEGORICAL[1]);
  });
});

describe("userColorMap", () => {
  it("is stable regardless of input order", () => {
    const a = userColorMap(["u2", "u1", "u3"]);
    const b = userColorMap(["u3", "u2", "u1"]);
    expect(a.get("u1")).toBe(CATEGORICAL[0]);
    expect(b.get("u1")).toBe(CATEGORICAL[0]);
    expect(a.get("u3")).toBe(b.get("u3"));
  });
  it("keeps a survivor's slot when the view reorders, and repaints when the list is filtered", () => {
    const all = userColorMap(["u1", "u2", "u3"]);
    expect(all.get("u3")).toBe(CATEGORICAL[2]);
    // Reordering the same registry cannot repaint anyone.
    expect(userColorMap(["u3", "u1", "u2"]).get("u3")).toBe(all.get("u3"));
    // Filtering does repaint — which is why `useUserColors` builds the map from `api.users.list`
    // (the full registry) and never from the rows currently on screen.
    expect(userColorMap(["u3"]).get("u3")).toBe(CATEGORICAL[0]);
    expect(userColorMap(["u3"]).get("u3")).not.toBe(all.get("u3"));
  });
});

describe("modelRegistryOrder", () => {
  it("puts priced models newest-first, then unpriced seen models alphabetically", () => {
    const priced = ["gpt-5", "gpt-5.6-sol", "gpt-5.4", "gpt-5.6-luna", "o3", "gpt-5-mini"];
    const seen = ["codex-auto-review", "gpt-5.6-sol", "gpt-5.7-preview"];
    expect(modelRegistryOrder(priced, seen)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.4",
      "gpt-5",
      "gpt-5-mini",
      "o3",
      "codex-auto-review",
      "gpt-5.7-preview",
    ]);
  });
  it("gives the newest priced models the first slots", () => {
    const map = modelColorMap(["gpt-5", "gpt-5.6-sol"], ["gpt-5.6-sol"]);
    expect(map.get("gpt-5.6-sol")).toBe(CATEGORICAL[0]);
    expect(map.get("gpt-5")).toBe(CATEGORICAL[1]);
  });
});

describe("status helpers", () => {
  it("maps quota usage to status colors", () => {
    expect(quotaColor(10)).toBe("#0ca30c");
    expect(quotaColor(60)).toBe("#fab219");
    expect(quotaColor(84.9)).toBe("#fab219");
    expect(quotaColor(85)).toBe("#d03b3b");
  });
  it("maps heat levels to the ramp", () => {
    // CSS variables, not literal hex: the ramp has a dark-theme definition in globals.css.
    expect(heatColor(0)).toBe("var(--heat-0)");
    expect(heatColor(4)).toBe("var(--heat-4)");
  });
});
