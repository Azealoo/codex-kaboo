"use client";

import { useCallback, useSyncExternalStore } from "react";

function supported(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/**
 * `true` while `query` matches; `false` on the server, during hydration, and in environments
 * without `matchMedia` (jsdom), so layout decisions default to the small-screen branch and only
 * widen once the browser has confirmed the viewport.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!supported()) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => (supported() ? window.matchMedia(query).matches : false),
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Tailwind's `md` breakpoint: the point where the bottom tab bar gives way to the top nav links. */
export const DESKTOP_QUERY = "(min-width: 768px)";

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
