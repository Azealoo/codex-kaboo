import { describe, expect, it } from "vitest";
import { SessionSummary } from "@codex-kaboo/shared/sync";
import {
  asRecord, classifyParsedCmdType, clipString, detectSkills, isSubagentSource, mcpKeyFromFunctionName,
  projectOf, sourceOf, toCount,
} from "../../src/parser/classify";

/** Smallest object that satisfies `SessionSummary`, for asserting a fix's output still validates on the wire. */
function minimalSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "s1", threadId: "s1", startedAt: Date.UTC(2026, 0, 15), endedAt: Date.UTC(2026, 0, 15),
    wallMs: 0, day: "2026-01-15", project: "(unknown)", originator: "codex-tui", source: "cli",
    isSubagent: false, model: "(unknown)", turns: 0, completedTurns: 0, userMessages: 0, agentMessages: 0,
    reasoningItems: 0,
    toolCounts: {
      commandRead: 0, commandList: 0, commandSearch: 0, commandOther: 0, fileChange: 0,
      webSearch: 0, imageView: 0, mcpTool: 0, other: 0,
    },
    mcpTools: [], skills: [],
    linesAdded: 0, linesRemoved: 0, filesChanged: 0, compactions: 0, activeMs: 0,
    ttft: { count: 0, sumMs: 0, hist: Array(16).fill(0) },
    tokens: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 },
    responses: 0, eventOrigin: "count", inProgress: false, lineCount: 0, generation: 0, parseErrors: 0, parserVersion: 1,
    summaryHash: "a".repeat(40),
    ...overrides,
  };
}

describe("classifyParsedCmdType", () => {
  it("maps the four parsed_cmd types and everything else to Other", () => {
    expect(classifyParsedCmdType("read")).toBe("commandRead");
    expect(classifyParsedCmdType("list_files")).toBe("commandList");
    expect(classifyParsedCmdType("search")).toBe("commandSearch");
    expect(classifyParsedCmdType("unknown")).toBe("commandOther");
    expect(classifyParsedCmdType("future_type")).toBe("commandOther");
    expect(classifyParsedCmdType(undefined)).toBe("commandOther");
  });
});

describe("detectSkills", () => {
  it("extracts the parent directory of any SKILL.md path, with slashes or backslashes", () => {
    expect(detectSkills(["/Users/x/.codex/skills/.system/openai-docs/SKILL.md"])).toEqual(["openai-docs"]);
    expect(detectSkills(["C:\\Users\\x\\.codex\\skills\\skill-alpha\\SKILL.md"])).toEqual(["skill-alpha"]);
    expect(detectSkills(["cat", "skills/foo/SKILL.md", 42, null])).toEqual(["foo"]);
    expect(detectSkills(['cat "a/b/SKILL.md" && cat c/d/SKILL.md'])).toEqual(["b", "d"]);
    expect(detectSkills(["SKILL.md", "notes/skill.txt"])).toEqual([]);
    expect(detectSkills(["/x/y/skill.MD"])).toEqual(["y"]);
  });

  it("clips a skill directory name over 256 characters, like every other extractor, so the session still validates", () => {
    const longName = "a".repeat(300);
    const clipped = longName.slice(0, 256);
    expect(detectSkills([`/x/${longName}/SKILL.md`])).toEqual([clipped]);
    expect(clipped).toHaveLength(256);

    const summary = minimalSessionSummary({ skills: [{ key: clipped, count: 1 }] });
    expect(SessionSummary.safeParse(summary).success).toBe(true);
  });
});

describe("mcpKeyFromFunctionName", () => {
  it("recognises mcp__server__tool and server__tool but not built-ins", () => {
    expect(mcpKeyFromFunctionName("mcp__context7__query-docs")).toBe("context7/query-docs");
    expect(mcpKeyFromFunctionName("mcp__claude-in-chrome__tabs_context_mcp")).toBe("claude-in-chrome/tabs_context_mcp");
    expect(mcpKeyFromFunctionName("github__list_issues")).toBe("github/list_issues");
    expect(mcpKeyFromFunctionName("exec")).toBeNull();
    expect(mcpKeyFromFunctionName("wait")).toBeNull();
    expect(mcpKeyFromFunctionName("apply_patch")).toBeNull();
    expect(mcpKeyFromFunctionName("shell_command")).toBeNull();
    expect(mcpKeyFromFunctionName("")).toBeNull();
    expect(mcpKeyFromFunctionName(undefined)).toBeNull();
  });
});

describe("sourceOf / projectOf", () => {
  it("normalises string and object sources", () => {
    expect(sourceOf("cli")).toBe("cli");
    expect(sourceOf("exec")).toBe("exec");
    expect(sourceOf({ subagent: { other: "guardian" } })).toBe("subagent:guardian");
    expect(sourceOf({ subagent: "review" })).toBe("subagent:review");
    expect(sourceOf({ subagent: {} })).toBe("subagent:unknown");
    expect(sourceOf({ custom: "x" })).toBe("custom");
    expect(sourceOf(undefined)).toBe("unknown");
    expect(isSubagentSource("subagent:guardian")).toBe(true);
    expect(isSubagentSource("cli")).toBe(false);
  });
  it("never copies an unvalidated object key onto the wire: only a short enum-like token survives", () => {
    // Real Codex shapes still resolve exactly as before.
    expect(sourceOf({ subagent: { other: "guardian" } })).toBe("subagent:guardian");
    expect(sourceOf({ subagent: "auto-review" })).toBe("subagent:auto-review");
    expect(sourceOf({ exec: {} })).toBe("exec");
    // A single-key object whose key is a path must not reach `source` as that key.
    expect(sourceOf({ "/Users/victim/CANARYSOURCEKEYAAA": true })).toBe("unknown");
    // Same guard on the subagent inner-key fallback, used when the inner value isn't a string.
    expect(sourceOf({ subagent: { "/Users/victim/CANARYINNERKEYAAA": 123 } })).toBe("subagent:unknown");
    // The guard is a real bound, not just a charset check: an overlong token-shaped key also falls back.
    expect(sourceOf({ [`custom_${"a".repeat(40)}`]: 1 })).toBe("unknown");
  });
  it("keeps only the last path segment of cwd", () => {
    expect(projectOf("/Users/me/Documents/codex-kaboo")).toBe("codex-kaboo");
    expect(projectOf("C:\\work\\my-app\\")).toBe("my-app");
    expect(projectOf("/")).toBe("(unknown)");
    expect(projectOf(undefined)).toBe("(unknown)");
    expect(projectOf(`/x/${"a".repeat(300)}`)).toHaveLength(256);
  });
});

describe("coercion", () => {
  it("clips strings and coerces counts", () => {
    expect(clipString("abc")).toBe("abc");
    expect(clipString("")).toBeUndefined();
    expect(clipString(5)).toBeUndefined();
    expect(clipString("x".repeat(300), 10)).toHaveLength(10);
    expect(toCount(5)).toBe(5);
    expect(toCount(5.9)).toBe(5);
    expect(toCount(-1)).toBe(0);
    expect(toCount("7")).toBe(0);
    expect(toCount(Number.NaN)).toBe(0);
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toBeNull();
    expect(asRecord(null)).toBeNull();
  });
});
