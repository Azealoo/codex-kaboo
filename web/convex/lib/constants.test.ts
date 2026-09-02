import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS, latestCliVersion } from "./constants";

afterEach(() => vi.unstubAllEnvs());

describe("LIMITS", () => {
  it("advertises the shared request limits", () => {
    expect(LIMITS).toEqual({ maxBodyBytes: 8 * 1024 * 1024, maxSessions: 500, maxEvents: 5000 });
  });
});

describe("latestCliVersion", () => {
  it("reads LATEST_CLI_VERSION from the environment", () => {
    vi.stubEnv("LATEST_CLI_VERSION", "0.1.0-build.202609011200.abc1234");
    expect(latestCliVersion()).toBe("0.1.0-build.202609011200.abc1234");
  });
  it("returns null when unset or empty", () => {
    vi.stubEnv("LATEST_CLI_VERSION", "");
    expect(latestCliVersion()).toBeNull();
  });
});
