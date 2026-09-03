import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEnvProblems, buildVersion, commitSha, isDeployBuild, stamp } from "./pack-cli.mjs";

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

describe("buildEnvProblems", () => {
  const complete = {
    CODEX_KABOO_SERVER: "https://example.convex.site",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
    CLERK_SECRET_KEY: "sk_test_x",
  };

  it("reports nothing when every build-time value is present", () => {
    expect(buildEnvProblems(complete)).toEqual([]);
  });

  it("flags a missing server URL, which would force --server at login", () => {
    expect(buildEnvProblems({ ...complete, CODEX_KABOO_SERVER: "" })).toEqual([
      expect.stringContaining("CODEX_KABOO_SERVER"),
    ]);
  });

  it.each(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"])(
    "flags a missing %s, which would 500 every route",
    (key) => {
      expect(buildEnvProblems({ ...complete, [key]: undefined })).toEqual([
        expect.stringContaining(key),
      ]);
    },
  );

  it("reports every missing value at once rather than only the first", () => {
    expect(buildEnvProblems({})).toHaveLength(3);
  });
});

describe("isDeployBuild", () => {
  it("is true when Convex or Vercel supplied deployment credentials", () => {
    expect(isDeployBuild({ CONVEX_DEPLOY_KEY: "prod:x|y" })).toBe(true);
    expect(isDeployBuild({ VERCEL: "1" })).toBe(true);
  });

  it("is false for a plain local build, which only warns", () => {
    expect(isDeployBuild({})).toBe(false);
  });
});

describe("the Clerk key guard's location", () => {
  // This check used to live in next.config.ts. `next typegen` — which `npm run typecheck` runs —
  // loads that file with phase `phase-production-build` and NODE_ENV=production, indistinguishable
  // from a real build, so the guard failed typecheck on every checkout without a .env.local. That
  // is every CI run. Pinning its absence here keeps the fix from being quietly undone; the
  // alternative is rediscovering it from a red CI matrix.
  it("is not in next.config.ts, which typegen also evaluates", () => {
    const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    expect(config).not.toContain("CLERK_SECRET_KEY");
    expect(config).not.toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });
});
