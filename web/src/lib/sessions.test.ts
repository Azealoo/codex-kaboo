import { describe, expect, it } from "vitest";
import { sourceLabel } from "./sessions";

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
});
