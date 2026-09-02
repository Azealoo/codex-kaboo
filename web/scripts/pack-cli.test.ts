import { afterEach, describe, expect, it, vi } from "vitest";
import { buildVersion, commitSha, stamp } from "./pack-cli.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("stamp", () => {
  it("formats a UTC date as yyyymmddHHmm", () => {
    expect(stamp(new Date(Date.UTC(2026, 8, 2, 9, 34)))).toBe("202609020934");
  });

  it("zero-pads single-digit month, day, hour and minute", () => {
    expect(stamp(new Date(Date.UTC(2026, 0, 1, 0, 5)))).toBe("202601010005");
  });

  it("uses UTC fields, not local time", () => {
    // 1ms before midnight UTC on 2027-01-01 is still 2026-12-31 in UTC.
    expect(stamp(new Date(Date.UTC(2027, 0, 1, 0, 0) - 1))).toBe("202612312359");
  });
});

describe("buildVersion", () => {
  const at = new Date(Date.UTC(2026, 8, 2, 9, 34));

  it("joins the package's base version, the build stamp and the short sha", () => {
    expect(buildVersion("0.1.0", "abc1234", at)).toBe("0.1.0-build.202609020934.abc1234");
  });

  it("strips any existing pre-release/build suffix from the package version", () => {
    expect(buildVersion("0.1.0-beta.3", "abc1234", at)).toBe("0.1.0-build.202609020934.abc1234");
  });
});

describe("commitSha", () => {
  it("prefers VERCEL_GIT_COMMIT_SHA, truncated to 7 characters, when set", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef0123456789");
    expect(commitSha()).toBe("abcdef0");
  });
});
