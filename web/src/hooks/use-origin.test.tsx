import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOrigin } from "./use-origin";

describe("useOrigin", () => {
  it("returns window.location.origin on the client", () => {
    const { result } = renderHook(() => useOrigin());
    expect(result.current).toBe(window.location.origin);
  });
});
