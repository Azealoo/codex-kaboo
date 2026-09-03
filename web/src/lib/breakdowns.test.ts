import { describe, expect, it } from "vitest";
import { OTHER_KEY, TOOL_KINDS } from "@shared/constants";
import type { ModelRow } from "@convex/lib/types";
import { OTHER_COLOR, assignSlots } from "./colors";
import {
  TOOL_LABELS,
  modelSegments,
  modelTableRows,
  sourceLabel,
  sourceSegments,
  toolSegments,
} from "./breakdowns";

const modelRow = (
  key: string,
  input: number,
  cached: number,
  costUsd: number | null,
  responses = 1,
): ModelRow => ({
  key,
  effort: null,
  tokens: { input, cachedInput: cached, cacheWrite: 0, output: 0, reasoning: 0, total: input },
  responses,
  costUsd,
  share: 0.5,
});

describe("breakdown helpers", () => {
  it("labels every tool kind", () => {
    for (const kind of TOOL_KINDS) expect(TOOL_LABELS[kind].length).toBeGreaterThan(0);
  });
  it("builds tool segments in the fixed order with shares", () => {
    const segs = toolSegments([
      { key: "commandRead", count: 30, share: 0.75 },
      { key: "fileChange", count: 10, share: 0.25 },
    ]);
    expect(segs.map((s) => s.key)).toEqual(["commandRead", "fileChange"]);
    expect(segs[0]?.label).toBe("Read files");
    expect(segs[0]?.share).toBeCloseTo(0.75);
    expect(segs[0]?.color).not.toBe(segs[1]?.color);
  });
  it("builds model segments with registry colors", () => {
    const colors = assignSlots(["gpt-5.6-sol"]);
    const tokens = {
      input: 100,
      cachedInput: 0,
      cacheWrite: 0,
      output: 0,
      reasoning: 0,
      total: 100,
    };
    const segs = modelSegments(
      [{ key: "gpt-5.6-sol", effort: null, tokens, responses: 1, costUsd: 0.1, share: 1 }],
      colors,
    );
    expect(segs).toEqual([
      { key: "gpt-5.6-sol", label: "gpt-5.6-sol", value: 100, share: 1, color: "#008300" },
    ]);
  });
  it("derives the shared per-model row with cache hit and $ per million tokens", () => {
    const rows = modelTableRows([
      modelRow("a", 2_000_000, 500_000, 3, 4),
      modelRow("b", 1_000_000, 0, null),
    ]);
    expect(rows[0]).toEqual({
      model: "a",
      tokens: 2_000_000,
      share: 0.5,
      responses: 4,
      cacheHitRate: 0.25,
      costUsd: 3,
      usdPerMTok: 1.5,
    });
    expect(rows[1]).toEqual({
      model: "b",
      tokens: 1_000_000,
      share: 0.5,
      responses: 1,
      cacheHitRate: 0,
      costUsd: null,
      usdPerMTok: null,
    });
  });
  it("labels source shares and gives each source its own color", () => {
    const segs = sourceSegments([
      { key: "cli", tokens: 80, sessions: 4, share: 0.8 },
      { key: "something_new", tokens: 20, sessions: 1, share: 0.2 },
    ]);
    expect(segs.map((s) => s.label)).toEqual(["CLI", "something_new"]);
    expect(segs[0]?.value).toBe(80);
    expect(segs[0]?.color).not.toBe(segs[1]?.color);
  });
  it("folds nine distinct sources into eight named segments plus one Other", () => {
    const segs = sourceSegments([
      { key: "cli", tokens: 90, sessions: 1, share: 0 },
      { key: "exec", tokens: 80, sessions: 1, share: 0 },
      { key: "vscode", tokens: 70, sessions: 1, share: 0 },
      { key: "mcp", tokens: 60, sessions: 1, share: 0 },
      { key: "custom", tokens: 50, sessions: 1, share: 0 },
      { key: "internal", tokens: 40, sessions: 1, share: 0 },
      { key: "subagent:review", tokens: 30, sessions: 1, share: 0 },
      { key: "subagent:plan", tokens: 20, sessions: 1, share: 0 },
      { key: "subagent:build", tokens: 10, sessions: 1, share: 0 },
    ]);
    expect(segs).toHaveLength(9);
    expect(segs.filter((s) => s.key !== OTHER_KEY)).toHaveLength(8);
    const other = segs.find((s) => s.key === OTHER_KEY);
    expect(other?.label).toBe("Other");
    expect(other?.value).toBe(10);
    expect(other?.color).toBe(OTHER_COLOR);
    // The fold reserves gray for Other, so no surviving source may also be gray.
    expect(new Set(segs.map((seg) => seg.color)).size).toBe(segs.length);
  });
  it("gives every returned segment a distinct color", () => {
    const segs = sourceSegments([
      { key: "cli", tokens: 60, sessions: 1, share: 0 },
      { key: "exec", tokens: 50, sessions: 1, share: 0 },
      { key: "vscode", tokens: 40, sessions: 1, share: 0 },
      { key: "mcp", tokens: 30, sessions: 1, share: 0 },
      { key: "custom", tokens: 20, sessions: 1, share: 0 },
      { key: "internal", tokens: 10, sessions: 1, share: 0 },
    ]);
    const colors = new Set(segs.map((s) => s.color));
    expect(colors.size).toBe(segs.length);
  });
  it("keeps cli's color stable whether or not exec is present in the input", () => {
    const withExec = sourceSegments([
      { key: "exec", tokens: 50, sessions: 1, share: 0.5 },
      { key: "cli", tokens: 50, sessions: 1, share: 0.5 },
    ]);
    const withoutExec = sourceSegments([{ key: "cli", tokens: 100, sessions: 1, share: 1 }]);
    const cliWithExec = withExec.find((s) => s.key === "cli")?.color;
    const cliWithoutExec = withoutExec.find((s) => s.key === "cli")?.color;
    expect(cliWithoutExec).toBe(cliWithExec);
  });
  it("labels a sub-agent source with its kind, not the raw `subagent:<kind>` key", () => {
    // sourceOf (cli/src/parser/classify.ts) always emits `subagent:<kind>`, never a bare
    // "subagent" — sourceSegments used to index SOURCE_LABELS directly and print the raw key.
    const segs = sourceSegments([
      { key: "subagent:auto-review", tokens: 10, sessions: 1, share: 1 },
    ]);
    expect(segs[0]?.label).toBe("Sub-agent · auto-review");
  });
});

describe("sourceLabel", () => {
  it.each([
    ["cli", false, "CLI"],
    ["exec", false, "Exec"],
    ["vscode", false, "VS Code"],
    ["mcp", false, "MCP"],
    ["subagent:review", true, "Sub-agent · review"],
    ["custom", true, "Sub-agent"],
    ["something_new", false, "something_new"],
  ])("%s / subagent=%s → %s", (source, isSubagent, expected) => {
    expect(sourceLabel(source, isSubagent)).toBe(expected);
  });
  it("defaults isSubagent to false for breakdown-row callers, which have no separate flag", () => {
    expect(sourceLabel("cli")).toBe("CLI");
    expect(sourceLabel("subagent:auto-review")).toBe("Sub-agent · auto-review");
  });
  it("renders the same source identically whether it reaches sourceLabel as a session row or a breakdown row", () => {
    // This is the Fix 2 regression: the Breakdown tab's Sources table and the user's Sessions
    // tab used to disagree on the same underlying source key.
    const viaSessionRow = sourceLabel("subagent:auto-review", true);
    const viaBreakdownRow = sourceSegments([
      { key: "subagent:auto-review", tokens: 10, sessions: 1, share: 1 },
    ])[0]?.label;
    expect(viaSessionRow).toBe("Sub-agent · auto-review");
    expect(viaBreakdownRow).toBe(viaSessionRow);
  });
});
