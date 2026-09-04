"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  /** What the user picked: `system`, `light` or `dark`. */
  preference: ThemePreference;
  /** What is actually on screen once `system` is resolved against the OS setting. */
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ----- preference store (localStorage + a same-tab change channel) -----

const prefListeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

function writePreference(next: ThemePreference): void {
  try {
    if (next === DEFAULT_THEME_PREFERENCE) window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private mode or a blocked storage: the choice still applies for this page load.
  }
  prefListeners.forEach((l) => l());
}

function subscribePreference(listener: () => void): () => void {
  prefListeners.add(listener);
  // Another tab changing the preference should flip this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === THEME_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// ----- OS preference store -----

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystem(listener: () => void): () => void {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

function readSystemDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * Owns the `dark` class on `<html>`. The inline boot script in the root layout sets it before
 * hydration so there is no flash; this keeps it in step afterwards (toggle, OS change, other tab).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    readPreference,
    () => DEFAULT_THEME_PREFERENCE,
  );
  const systemDark = useSyncExternalStore(subscribeSystem, readSystemDark, () => false);
  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => writePreference(next), []);
  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
