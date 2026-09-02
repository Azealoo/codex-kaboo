import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../../shared/src/constants";

describe("convex test environment", () => {
  it("runs in edge-runtime with Web Crypto and the shared package", () => {
    expect(typeof crypto.subtle.digest).toBe("function");
    expect(SCHEMA_VERSION).toBe(1);
  });
});
