import { describe, expect, it } from "vitest";
import { SessionSummary } from "@codex-kaboo/shared/sync";
import { createReducerState, finalize, reduceLine, type ReducerContext } from "../../src/parser/session";

const TID = "0199a1b2-0000-7000-8000-000000000002";
const T = (s: number): string => new Date(Date.UTC(2026, 7, 30, 17, 0, s)).toISOString();
const line = (type: string, payload: unknown, ts: string): string => JSON.stringify({ timestamp: ts, type, payload });
const item = (it: Record<string, unknown>, s: number): string => line("event_msg", { type: "item_completed", item: it }, T(s));
const meta = line("session_meta", { id: TID, timestamp: T(0), cwd: "/redacted/project-b", originator: "codex-tui", source: "cli", cli_version: "0.150.1" }, T(0));

const ctx: ReducerContext = { sessionId: TID, threadId: TID, rolloutId: null, fileTimestampMs: null, machineZone: "UTC" };
function run(lines: string[]) {
  const state = createReducerState(ctx);
  lines.forEach((text, seq) => reduceLine(state, seq, text));
  return finalize(state, { now: Date.UTC(2026, 7, 30, 18), generation: 0 });
}

const SKILL_PATH = "/Users/me/.codex/skills/.system/openai-docs/SKILL.md";
const DIFF = "@@ -1,3 +1,4 @@\n context\n+added line one\n+added line two\n-removed line\n";

describe("reducer: items", () => {
  it("counts every item type per the allow-list and never copies text", () => {
    const parsed = run([
      meta,
      item({ type: "UserMessage", id: "u1", content: "SECRET prompt" }, 1),
      item({ type: "UserMessage", id: "u2", content: "SECRET prompt" }, 2),
      item({ type: "AgentMessage", id: "a1", content: "SECRET answer", phase: "final" }, 3),
      item({ type: "AgentMessage", id: "a2", content: "SECRET" }, 4),
      item({ type: "AgentMessage", id: "a3", content: "SECRET" }, 5),
      item({ type: "Reasoning", id: "r1", summary_text: "SECRET", raw_content: "SECRET" }, 6),
      item({ type: "Reasoning", id: "r2" }, 7),
      item({ type: "Reasoning", id: "r3" }, 8),
      item({ type: "Reasoning", id: "r4" }, 9),
      item({
        type: "CommandExecution", id: "c1", command: ["cat", SKILL_PATH], cwd: "/redacted/project-b", stdout: "SECRET", stderr: "", aggregated_output: "SECRET",
        parsed_cmd: [{ type: "read", cmd: `cat ${SKILL_PATH}`, path: SKILL_PATH, name: "SKILL.md" }, { type: "search", cmd: "rg SECRET", query: "SECRET", path: "src" }, { type: "list_files", cmd: "ls", path: "." }, { type: "unknown", cmd: "SECRET command" }],
      }, 10),
      item({ type: "CommandExecution", id: "c2", command: ["true"], parsed_cmd: [] }, 11),
      item({ type: "CommandExecution", id: "c3", command: ["type", "C:\\Users\\me\\.codex\\skills\\lark-apps\\SKILL.md"], parsed_cmd: [{ type: "unknown", cmd: "SECRET" }] }, 12),
      item({
        type: "FileChange", id: "f1", status: "completed", stdout: "SECRET",
        changes: {
          "/redacted/project-b/src/a.ts": { type: "update", unified_diff: DIFF, move_path: null },
          "/redacted/project-b/src/new.ts": { type: "add", content: "l1\nl2\nl3\n" },
          "/redacted/project-b/src/old.ts": { type: "delete", content: "x\ny" },
        },
      }, 13),
      item({ type: "Extension", id: "e1", kind: "web.search", query: "SECRET query", results: ["SECRET"] }, 14),
      item({ type: "Extension", id: "e2", kind: "web.search", query: "SECRET" }, 15),
      item({ type: "Extension", id: "e3", kind: "something.else" }, 16),
      item({ type: "WebSearch", id: "w1", query: "SECRET" }, 17),
      item({ type: "ImageView", id: "i1", path: "/redacted/shot.png" }, 18),
      item({ type: "McpToolCall", id: "m1", server: "context7", tool: "query-docs", arguments: { q: "SECRET" } }, 19),
      item({ type: "McpToolCall", id: "m2", server: "context7", tool: "query-docs" }, 20),
      item({ type: "ContextCompaction", id: "cc1" }, 21),
      item({ type: "Plan", id: "p1", text: "SECRET" }, 22),
      line("compacted", { message: "SECRET", replacement_history: ["SECRET"], window_id: 1 }, T(23)),
      line("compacted", { message: "SECRET", window_id: 2 }, T(24)),
      line("response_item", { type: "function_call", name: "mcp__github__list_issues", arguments: "{\"SECRET\":1}", call_id: "x" }, T(25)),
      line("response_item", { type: "custom_tool_call", name: "exec", input: "SECRET" }, T(26)),
      line("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "SECRET" }] }, T(27)),
      line("event_msg", { type: "user_message", message: "SECRET legacy" }, T(28)),
      line("event_msg", { type: "agent_message", message: "SECRET legacy" }, T(29)),
    ]);
    const s = parsed.summary;
    expect(SessionSummary.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({
      userMessages: 2, agentMessages: 3, reasoningItems: 4, filesChanged: 3, linesAdded: 5, linesRemoved: 3, compactions: 2,
      mcpTools: [{ key: "context7/query-docs", count: 2 }],
      skills: [{ key: "lark-apps", count: 1 }, { key: "openai-docs", count: 1 }],
    });
    expect(s.toolCounts).toEqual({
      commandRead: 1, commandList: 1, commandSearch: 1, commandOther: 3, fileChange: 1, webSearch: 3, imageView: 1, mcpTool: 2, other: 2,
    });
    expect(parsed.diagnostics.itemTypes).toMatchObject({ Plan: 1, McpToolCall: 2, Extension: 3 });
    expect(parsed.diagnostics.mcpFallbackUsed).toBe(false);
    const text = JSON.stringify(parsed);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("/redacted");
    expect(text).not.toContain("SKILL.md");
    expect(text).not.toContain("added line");
  });
  it("uses legacy message events only when no message items exist", () => {
    const parsed = run([
      meta,
      line("event_msg", { type: "user_message", message: "SECRET" }, T(1)),
      line("event_msg", { type: "user_message", message: "SECRET" }, T(2)),
      line("event_msg", { type: "user_message", message: "SECRET" }, T(3)),
      line("event_msg", { type: "agent_message", message: "SECRET" }, T(4)),
      line("event_msg", { type: "agent_message", message: "SECRET" }, T(5)),
      line("event_msg", { type: "agent_message", message: "SECRET" }, T(6)),
    ]);
    expect(parsed.summary.userMessages).toBe(3);
    expect(parsed.summary.agentMessages).toBe(3);
  });
  it("falls back to function_call names for MCP usage when no McpToolCall items exist", () => {
    const parsed = run([
      meta,
      line("response_item", { type: "function_call", name: "mcp__github__list_issues", arguments: "{}" }, T(1)),
      line("response_item", { type: "function_call", name: "wait", arguments: "{}" }, T(2)),
      line("response_item", { type: "function_call", name: "exec", arguments: "{}" }, T(3)),
      line("response_item", { type: "function_call", name: "linear__create_issue", arguments: "{}" }, T(4)),
      line("response_item", { type: "function_call", name: "mcp__github__list_issues", arguments: "{}" }, T(5)),
    ]);
    expect(parsed.summary.mcpTools).toEqual([{ key: "github/list_issues", count: 2 }, { key: "linear/create_issue", count: 1 }]);
    expect(parsed.summary.toolCounts.mcpTool).toBe(3);
    expect(parsed.diagnostics.mcpFallbackUsed).toBe(true);
  });
  it("counts a skill once per command item and caps keyed arrays at 64", () => {
    const reads = Array.from({ length: 70 }, (_, i) =>
      item({ type: "CommandExecution", id: `c${i}`, command: ["cat", `/skills/skill-${String(i).padStart(2, "0")}/SKILL.md`], parsed_cmd: [{ type: "read", cmd: "cat", path: `/skills/skill-${String(i).padStart(2, "0")}/SKILL.md`, name: "SKILL.md" }] }, i + 1),
    );
    const parsed = run([meta, ...reads, item({ type: "CommandExecution", id: "again", command: ["cat", "/skills/skill-00/SKILL.md"], parsed_cmd: [] }, 99)]);
    expect(parsed.summary.skills).toHaveLength(64);
    expect(parsed.summary.skills.find((k) => k.key === "skill-00")?.count).toBe(2);
    expect(parsed.summary.skills.find((k) => k.key === "(other)")?.count).toBe(7);
    expect(SessionSummary.safeParse(parsed.summary).success).toBe(true);
  });
});

describe("reducer: token_usage_record ruling", () => {
  it("does not let an all-zero token_usage_record line suppress token_count-derived events", () => {
    const zeroUsage = {
      input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0,
    };
    const realUsage = {
      input_tokens: 100, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0,
    };
    const parsed = run([
      meta,
      line("token_usage_record", { turn_id: "t1", usage: zeroUsage }, T(1)),
      line("event_msg", { type: "token_count", info: { last_token_usage: realUsage } }, T(2)),
    ]);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ input: 100, output: 10, total: 110 });
    expect(parsed.summary.responses).toBe(1);
  });
});
