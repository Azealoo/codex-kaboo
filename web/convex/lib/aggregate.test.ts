import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { Ttft } from "../../../shared/src/sync";
import {
  computeDayRollup,
  emptyRollupBody,
  type EventInput,
  type SessionInput,
} from "./aggregate";

const userId = "users|alice" as Id<"users">;
const DAY = "2026-08-31";
const AT = 1_756_700_000_000;

function hist(...indexes: number[]): Ttft["hist"] {
  const h = new Array<number>(16).fill(0);
  for (const i of indexes) h[i] = (h[i] ?? 0) + 1;
  return h;
}
const zeroTools = {
  commandRead: 0,
  commandList: 0,
  commandSearch: 0,
  commandOther: 0,
  fileChange: 0,
  webSearch: 0,
  imageView: 0,
  mcpTool: 0,
  other: 0,
};

const events: EventInput[] = [
  { hour: 9, model: "gpt-5.6-sol", effort: "medium", project: "alpha", isSubagent: false, input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200 },
  { hour: 9, model: "gpt-5.6-sol", effort: "medium", project: "alpha", isSubagent: false, input: 500, cachedInput: 100, cacheWrite: 10, output: 100, reasoning: 0, total: 600 },
  { hour: 23, model: "gpt-5.6-luna", effort: "low", project: "beta", isSubagent: false, input: 300, cachedInput: 0, cacheWrite: 0, output: 30, reasoning: 0, total: 330 },
  { hour: 10, model: "codex-auto-review", project: "alpha", isSubagent: true, input: 700, cachedInput: 700, cacheWrite: 0, output: 70, reasoning: 70, total: 770 },
];

const sessions: SessionInput[] = [
  {
    machineId: "m1", project: "alpha", source: "cli", isSubagent: false,
    turns: 2, userMessages: 2, agentMessages: 3, linesAdded: 10, linesRemoved: 2, filesChanged: 1, compactions: 1,
    activeMs: 600_000, wallMs: 3_600_000, ttft: { count: 2, sumMs: 1500, hist: hist(1, 3) },
    toolCounts: { ...zeroTools, commandRead: 3, commandList: 1, commandOther: 2, fileChange: 1, mcpTool: 1 },
    mcpTools: [{ key: "context7/query-docs", count: 1 }],
    skills: [{ key: "dataviz", count: 2 }],
    tokens: { input: 1500, cachedInput: 500, cacheWrite: 10, output: 300, reasoning: 50, total: 1800 },
  },
  {
    machineId: "m2", project: "beta", source: "exec", isSubagent: false,
    turns: 1, userMessages: 1, agentMessages: 1, linesAdded: 0, linesRemoved: 0, filesChanged: 0, compactions: 0,
    activeMs: 120_000, wallMs: 300_000, ttft: { count: 1, sumMs: 250, hist: hist(0) },
    toolCounts: { ...zeroTools, commandRead: 1 },
    mcpTools: [],
    skills: [{ key: "dataviz", count: 1 }, { key: "brainstorming", count: 1 }],
    tokens: { input: 300, cachedInput: 0, cacheWrite: 0, output: 30, reasoning: 0, total: 330 },
  },
  {
    machineId: "m1", project: "alpha", source: "subagent:review", isSubagent: true,
    turns: 1, userMessages: 0, agentMessages: 1, linesAdded: 5, linesRemoved: 5, filesChanged: 1, compactions: 0,
    activeMs: 60_000, wallMs: 60_000, ttft: { count: 1, sumMs: 100, hist: hist(0) },
    toolCounts: { ...zeroTools, commandRead: 4 },
    mcpTools: [],
    skills: [],
    tokens: { input: 700, cachedInput: 700, cacheWrite: 0, output: 70, reasoning: 70, total: 770 },
  },
];

describe("computeDayRollup", () => {
  it("matches the hand-computed fixture", () => {
    const r = computeDayRollup(userId, DAY, events, sessions, AT);
    expect(r.userId).toBe(userId);
    expect(r.day).toBe(DAY);
    expect(r.version).toBe(1);
    expect(r.computedAt).toBe(AT);
    expect(r.tokens).toEqual({ input: 2500, cachedInput: 1200, cacheWrite: 10, output: 400, reasoning: 120, total: 2900 });
    expect(r.subagentTokens).toEqual({ input: 700, cachedInput: 700, cacheWrite: 0, output: 70, reasoning: 70, total: 770 });
    expect(r.responses).toBe(4);
    expect(r.sessions).toBe(2);
    expect(r.subagentSessions).toBe(1);
    expect(r.turns).toBe(3);
    expect(r.userMessages).toBe(3);
    expect(r.agentMessages).toBe(4);
    expect(r.linesAdded).toBe(10);
    expect(r.linesRemoved).toBe(2);
    expect(r.filesChanged).toBe(1);
    expect(r.compactions).toBe(1);
    expect(r.activeMs).toBe(720_000);
    expect(r.wallMs).toBe(3_900_000);
    expect(r.ttft).toEqual({ count: 3, sumMs: 1750, hist: hist(0, 1, 3) });
    const byHour = new Array<number>(24).fill(0);
    byHour[9] = 1800;
    byHour[10] = 770;
    byHour[23] = 330;
    expect(r.byHour).toEqual(byHour);
    expect(r.byModel).toEqual([
      { key: "codex-auto-review", tokens: { input: 700, cachedInput: 700, cacheWrite: 0, output: 70, reasoning: 70, total: 770 }, responses: 1 },
      { key: "gpt-5.6-luna", effort: "low", tokens: { input: 300, cachedInput: 0, cacheWrite: 0, output: 30, reasoning: 0, total: 330 }, responses: 1 },
      { key: "gpt-5.6-sol", effort: "medium", tokens: { input: 1500, cachedInput: 500, cacheWrite: 10, output: 300, reasoning: 50, total: 1800 }, responses: 2 },
    ]);
    expect(r.byTool).toEqual([
      { key: "commandList", count: 1 },
      { key: "commandOther", count: 2 },
      { key: "commandRead", count: 4 },
      { key: "commandSearch", count: 0 },
      { key: "fileChange", count: 1 },
      { key: "imageView", count: 0 },
      { key: "mcpTool", count: 1 },
      { key: "other", count: 0 },
      { key: "webSearch", count: 0 },
    ]);
    expect(r.byMcpTool).toEqual([{ key: "context7/query-docs", count: 1 }]);
    expect(r.bySkill).toEqual([
      { key: "brainstorming", count: 1, sessions: 1 },
      { key: "dataviz", count: 3, sessions: 2 },
    ]);
    expect(r.byProject).toEqual([
      { key: "alpha", tokens: 2570, responses: 3, sessions: 1, userMessages: 2, linesAdded: 10, linesRemoved: 2 },
      { key: "beta", tokens: 330, responses: 1, sessions: 1, userMessages: 1, linesAdded: 0, linesRemoved: 0 },
    ]);
    expect(r.byMachine).toEqual([
      { key: "m1", tokens: 2570, sessions: 2 },
      { key: "m2", tokens: 330, sessions: 1 },
    ]);
    expect(r.bySource).toEqual([
      { key: "cli", tokens: 1800, sessions: 1 },
      { key: "exec", tokens: 330, sessions: 1 },
      { key: "subagent:review", tokens: 770, sessions: 1 },
    ]);
  });

  it("is independent of input order", () => {
    const a = computeDayRollup(userId, DAY, events, sessions, AT);
    const b = computeDayRollup(userId, DAY, [...events].reverse(), [...sessions].reverse(), AT);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("produces the empty rollup for no data", () => {
    const r = computeDayRollup(userId, DAY, [], [], AT);
    expect(r).toEqual({ userId, day: DAY, version: 1, computedAt: AT, ...emptyRollupBody() });
    expect(r.byTool).toHaveLength(9);
    expect(r.byHour).toEqual(new Array(24).fill(0));
  });

  it("counts only tokens for sub-agent sessions", () => {
    const sub = sessions[2]!;
    const r = computeDayRollup(userId, DAY, [events[3]!], [sub], AT);
    expect(r.sessions).toBe(0);
    expect(r.subagentSessions).toBe(1);
    expect(r.turns).toBe(0);
    expect(r.linesAdded).toBe(0);
    expect(r.activeMs).toBe(0);
    expect(r.ttft.count).toBe(0);
    expect(r.byTool.every((t) => t.count === 0)).toBe(true);
    expect(r.tokens.total).toBe(770);
    expect(r.byMachine).toEqual([{ key: "m1", tokens: 770, sessions: 1 }]);
    expect(r.bySource).toEqual([{ key: "subagent:review", tokens: 770, sessions: 1 }]);
  });

  it("caps keyed arrays at 100 entries and folds the rest into (other)", () => {
    const mcpTools = Array.from({ length: 150 }, (_, i) => ({
      key: `mcp-${String(i + 1).padStart(3, "0")}`,
      count: i + 1,
    }));
    const r = computeDayRollup(userId, DAY, [], [{ ...sessions[1]!, mcpTools }], AT);
    expect(r.byMcpTool).toHaveLength(100);
    expect(r.byMcpTool[0]).toEqual({ key: "(other)", count: 1326 });
    expect(r.byMcpTool[1]).toEqual({ key: "mcp-052", count: 52 });
    expect(r.byMcpTool[99]).toEqual({ key: "mcp-150", count: 150 });
    const keys = r.byMcpTool.map((e) => e.key);
    expect([...keys].sort()).toEqual(keys);
  });
});
