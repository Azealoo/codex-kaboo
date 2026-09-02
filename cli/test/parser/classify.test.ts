import { describe, expect, it } from "vitest";
import {
  asRecord, classifyParsedCmdType, clipString, detectSkills, isSubagentSource, mcpKeyFromFunctionName,
  projectOf, sourceOf, toCount,
} from "../../src/parser/classify";

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
