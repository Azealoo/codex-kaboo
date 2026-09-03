"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** `window.location.origin` on the client, `null` during server render. */
export function useOrigin(): string | null {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => null,
  );
}
