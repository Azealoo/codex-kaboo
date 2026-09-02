import { describe, expect, it } from "vitest";
import {
  customParams,
  presetParams,
  rangeHref,
  rangeParsers,
  sectionParser,
  tabParser,
  viewParser,
} from "./search-params";

describe("parsers", () => {
  it("range defaults to 30D and rejects unknown values", () => {
    expect(rangeParsers.range.parseServerSide(undefined)).toBe("30D");
    expect(rangeParsers.range.parseServerSide("7D")).toBe("7D");
    expect(rangeParsers.range.parseServerSide("bogus")).toBe("30D");
  });
  it("section/view/tab default and validate", () => {
    expect(sectionParser.parseServerSide(undefined)).toBe("users");
    expect(sectionParser.parseServerSide("models")).toBe("models");
    expect(viewParser.parseServerSide("efficiency")).toBe("efficiency");
    expect(viewParser.parseServerSide("x")).toBe("volume");
    expect(tabParser.parseServerSide("sessions")).toBe("sessions");
    expect(tabParser.parseServerSide(undefined)).toBe("overview");
  });
});

describe("rangeHref", () => {
  it("keeps the preset visible in the URL, even the default", () => {
    expect(rangeHref("/users/abc", presetParams("30D"))).toBe("/users/abc?range=30D");
    expect(rangeHref("/", presetParams("7D"))).toBe("/?range=7D");
  });
  it("writes from/to for custom ranges and drops the preset", () => {
    expect(rangeHref("/settings", customParams("2026-08-01", "2026-08-15"))).toBe(
      "/settings?from=2026-08-01&to=2026-08-15",
    );
  });
  it("carries only the range keys, never anything else", () => {
    const preset = new URL(rangeHref("/", { range: "90D", from: null, to: null }), "https://x.test");
    expect([...preset.searchParams.keys()]).toEqual(["range"]);
    const custom = new URL(rangeHref("/", customParams("2026-08-01", "2026-08-15")), "https://x.test");
    expect([...custom.searchParams.keys()].sort()).toEqual(["from", "to"]);
  });
});
