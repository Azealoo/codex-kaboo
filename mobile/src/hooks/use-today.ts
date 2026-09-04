import { useSyncExternalStore } from "react";

export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const listeners = new Set<() => void>();
let current: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  const next = localDay(new Date());
  if (next !== current) {
    current = next;
    listeners.forEach((l) => l());
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) timer = setInterval(tick, 60_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): string {
  if (current === null) current = localDay(new Date());
  return current;
}

/** The device's local calendar day, refreshed across midnight. */
export function useToday(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
