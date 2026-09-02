import { describe, expect, it } from "vitest";
import { countDiffLines, countLines } from "../../src/parser/diff";

describe("countDiffLines", () => {
  it("counts + and - lines inside hunks only", () => {
    const diff = [
      "--- a/file",
      "+++ b/file",
      "@@ -1,2 +1,3 @@",
      " context",
      "+added one",
      "-removed one",
      "\\ No newline at end of file",
      "@@ -10 +11 @@",
      "+added two",
      "+added three",
      " more context",
    ].join("\n");
    expect(countDiffLines(diff)).toEqual({ added: 3, removed: 1 });
  });
  it("ignores text before the first hunk and handles empty input", () => {
    expect(countDiffLines("+not a hunk\n-nope")).toEqual({ added: 0, removed: 0 });
    expect(countDiffLines("")).toEqual({ added: 0, removed: 0 });
    expect(countDiffLines("@@ -1 +1 @@\r\n+a\r\n-b\r\n")).toEqual({ added: 1, removed: 1 });
  });
});

describe("countLines", () => {
  it("counts newline-terminated and unterminated lines", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("\n")).toBe(1);
  });
});
