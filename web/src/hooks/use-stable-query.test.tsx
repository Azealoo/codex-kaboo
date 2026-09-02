import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));

import { useStableQuery } from "./use-stable-query";

describe("useStableQuery", () => {
  it("keeps the previous data while new args are loading", () => {
    const query = {} as never;
    useQueryMock.mockReturnValueOnce(undefined);
    const { result, rerender } = renderHook(({ args }) => useStableQuery(query, args), {
      initialProps: { args: { from: "a" } as never },
    });
    expect(result.current).toEqual({ data: undefined, isStale: false });

    useQueryMock.mockReturnValue({ value: 1 });
    rerender({ args: { from: "a" } as never });
    expect(result.current).toEqual({ data: { value: 1 }, isStale: false });

    useQueryMock.mockReturnValue(undefined);
    rerender({ args: { from: "b" } as never });
    expect(result.current).toEqual({ data: { value: 1 }, isStale: true });

    useQueryMock.mockReturnValue({ value: 2 });
    rerender({ args: { from: "b" } as never });
    expect(result.current).toEqual({ data: { value: 2 }, isStale: false });
  });
});
