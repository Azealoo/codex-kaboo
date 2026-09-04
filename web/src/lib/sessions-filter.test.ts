import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { SessionRow } from "@convex/lib/types";
import { TOOL_LABELS } from "./breakdowns";
import { filterSessions, sessionSearchText, toolBreakdown } from "./sessions-filter";

function row(overrides: Partial<SessionRow> & { sessionId: string }): SessionRow {
  return {
    _id: overrides.sessionId as Id<"sessions">,
    threadId: overrides.sessionId,
    parentThreadId: null,
    userId: "u1" as Id<"users">,
    userName: "Alice",
    machineId: "m1",
    machineLabel: "brisk-otter",
    startedAt: 0,
    endedAt: 1,
    wallMs: 1,
    day: "2026-09-01",
    timezone: "UTC",
    project: "codex-kaboo",
    gitBranch: "main",
    originator: "codex-tui",
    cliVersion: "0.150.1",
    model: "gpt-5.6-sol",
    effort: "medium",
    source: "cli",
    isSubagent: false,
    turns: 1,
    completedTurns: 1,
    userMessages: 1,
    agentMessages: 1,
    reasoningItems: 0,
    responses: 1,
    tokens: { input: 10, cachedInput: 5, cacheWrite: 0, output: 2, reasoning: 0, total: 12 },
    cacheHitRate: 0.5,
    costUsd: 0,
    activeMs: 1,
    ttftAvgMs: null,
    linesAdded: 0,
    linesRemoved: 0,
    filesChanged: 0,
    compactions: 0,
    toolCounts: {
      commandRead: 0,
      commandList: 0,
      commandSearch: 0,
      commandOther: 0,
      fileChange: 0,
      webSearch: 0,
      imageView: 0,
      mcpTool: 0,
      other: 0,
    },
    mcpTools: [],
    skills: [],
    inProgress: false,
    ...overrides,
  };
}

const rows = [
  row({ sessionId: "a" }),
  row({ sessionId: "b", project: "website", gitBranch: "feat/dark-mode", model: "gpt-5.6-luna" }),
  row({
    sessionId: "c",
    project: "codex-kaboo",
    source: "subagent:auto-review",
    isSubagent: true,
    model: "codex-auto-review",
    userName: "Bob",
  }),
];

describe("filterSessions", () => {
  it("returns every row for an empty or whitespace query", () => {
    expect(filterSessions(rows, "")).toBe(rows);
    expect(filterSessions(rows, "   ")).toBe(rows);
  });
  it("matches project, branch, model and source labels case-insensitively", () => {
    expect(filterSessions(rows, "WEBSITE").map((r) => r.sessionId)).toEqual(["b"]);
    expect(filterSessions(rows, "dark-mode").map((r) => r.sessionId)).toEqual(["b"]);
    expect(filterSessions(rows, "luna").map((r) => r.sessionId)).toEqual(["b"]);
    expect(filterSessions(rows, "sub-agent").map((r) => r.sessionId)).toEqual(["c"]);
  });
  it("requires every term to match (AND), in any order", () => {
    expect(filterSessions(rows, "kaboo sol").map((r) => r.sessionId)).toEqual(["a"]);
    expect(filterSessions(rows, "bob kaboo").map((r) => r.sessionId)).toEqual(["c"]);
    expect(filterSessions(rows, "kaboo luna")).toEqual([]);
  });
  it("searches the machine label and user name too", () => {
    expect(sessionSearchText(rows[0]!)).toContain("brisk-otter");
    expect(filterSessions(rows, "otter")).toHaveLength(3);
    expect(filterSessions(rows, "alice")).toHaveLength(2);
  });
});

describe("toolBreakdown", () => {
  it("lists only non-zero kinds, busiest first, with display labels", () => {
    const counts = { ...rows[0]!.toolCounts, commandRead: 3, fileChange: 5, mcpTool: 3 };
    expect(toolBreakdown(counts, TOOL_LABELS)).toEqual([
      { key: "fileChange", label: "File changes", count: 5 },
      { key: "commandRead", label: "Read files", count: 3 },
      { key: "mcpTool", label: "MCP tools", count: 3 },
    ]);
    expect(toolBreakdown(rows[0]!.toolCounts, TOOL_LABELS)).toEqual([]);
  });
});
