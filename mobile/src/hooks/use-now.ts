import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let now: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const STEP_MS = 30_000;

function tick() {
  now = Math.floor(Date.now() / STEP_MS) * STEP_MS;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) timer = setInterval(tick, STEP_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  if (now === null) now = Math.floor(Date.now() / STEP_MS) * STEP_MS;
  return now;
}

/** Wall clock rounded to 30 s, for "3 min ago" labels. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
