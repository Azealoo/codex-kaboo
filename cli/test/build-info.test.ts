import { describe, expect, it } from "vitest";
import { BAKED_SERVER, BAKED_WEB_ORIGIN, CLI_VERSION } from "../src/build-info";

describe("build-info", () => {
  it("falls back to a dev version when no build-time define exists", () => {
    expect(CLI_VERSION).toBe("0.0.0-dev");
  });
  it("has no baked server or web origin outside a tsup build", () => {
    expect(BAKED_SERVER).toBeUndefined();
    expect(BAKED_WEB_ORIGIN).toBeUndefined();
  });
});
