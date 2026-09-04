import { describe, expect, it } from "vitest";
import { csvCell, csvFilename, toCsv } from "./csv";

describe("csvCell", () => {
  it.each([
    ["plain", "plain"],
    [42, "42"],
    [1.5, "1.5"],
    [true, "true"],
    [null, ""],
    [undefined, ""],
    [NaN, ""],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["two\nlines", '"two\nlines"'],
  ])("%s → %s", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("neutralises formula-looking cells so a model or project name cannot run in a spreadsheet", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    // A negative NUMBER is data, not a formula.
    expect(csvCell(-5)).toBe("-5");
  });
});

describe("toCsv", () => {
  it("emits a BOM, a header row and CRLF line endings", () => {
    const text = toCsv(
      ["Model", "Tokens"],
      [
        ["gpt-5.6-sol", 1200],
        ["other, inc", null],
      ],
    );
    expect(text).toBe('﻿Model,Tokens\r\ngpt-5.6-sol,1200\r\n"other, inc",\r\n');
  });
});

describe("csvFilename", () => {
  it("slugs the name and appends the range", () => {
    expect(csvFilename("Users (team)", { from: "2026-08-01", to: "2026-08-31" })).toBe(
      "codex-kaboo-users-team-2026-08-01_2026-08-31.csv",
    );
    expect(csvFilename("Sessions")).toBe("codex-kaboo-sessions.csv");
  });
});
