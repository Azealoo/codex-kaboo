import { describe, expect, it } from "vitest";
import { compareVersions, meetsVersion, newestVersion, parseVersion } from "../../src/util/version";

describe("versions", () => {
  it("parses and compares numeric dotted versions, ignoring suffixes", () => {
    expect(parseVersion("v0.150.1")).toEqual([0, 150, 1]);
    expect(parseVersion("junk")).toBeNull();
    expect(compareVersions("0.150.1", "0.99.0")).toBe(1);
    expect(compareVersions("0.150.1-build.202609011400.abc1234", "0.150.1")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("22.14.9", "22.15.0")).toBe(-1);
  });
  it("picks the newest valid version and checks floors", () => {
    expect(newestVersion(["0.149.0", undefined, "0.150.1", "junk", null])).toBe("0.150.1");
    expect(newestVersion([])).toBeUndefined();
    expect(meetsVersion("24.17.0", "22.15.0")).toBe(true);
    expect(meetsVersion("22.14.0", "22.15.0")).toBe(false);
  });
});
