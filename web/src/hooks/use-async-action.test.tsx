import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAsyncAction } from "./use-async-action";

describe("useAsyncAction", () => {
  it("toggles pending and stores the message of a rejected call", async () => {
    let reject: ((reason: unknown) => void) | undefined;
    const fn = () =>
      new Promise<void>((_resolve, r) => {
        reject = r;
      });
    const { result } = renderHook(() => useAsyncAction(fn));
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();

    act(() => {
      void result.current.run();
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      reject?.(new Error("revoke failed"));
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe("revoke failed");

    act(() => {
      result.current.reset();
    });
    expect(result.current.error).toBeNull();
  });

  it("stringifies a non-Error rejection and clears the error on a later success", async () => {
    let fail = true;
    const { result } = renderHook(() =>
      useAsyncAction(() => (fail ? Promise.reject("nope") : Promise.resolve())),
    );
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toBe("nope");

    fail = false;
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });
});
