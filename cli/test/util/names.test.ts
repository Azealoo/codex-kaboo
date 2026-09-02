import { describe, expect, it } from "vitest";
import { randomLabel } from "../../src/util/names";

describe("randomLabel", () => {
  it("returns adjective-animal labels driven by the random source", () => {
    expect(randomLabel(() => 0)).toBe("agile-otter");
    expect(randomLabel(() => 0.999)).toMatch(/^[a-z]+-[a-z]+$/);
    expect(randomLabel(() => 0.999)).not.toBe("agile-otter");
    expect(randomLabel().length).toBeLessThanOrEqual(64);
  });
});
