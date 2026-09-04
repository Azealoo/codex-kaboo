import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import { paletteFor, type Palette, type Scheme } from "@/lib/theme";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "codex-kaboo.theme";

type ThemeValue = {
  preference: ThemePreference;
  scheme: Scheme;
  palette: Palette;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

function parse(raw: string | null): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(KEY)
      .then((raw) => {
        if (!cancelled) setPreferenceState(parse(raw));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    const write =
      next === "system" ? SecureStore.deleteItemAsync(KEY) : SecureStore.setItemAsync(KEY, next);
    write.catch(() => {});
  }, []);

  const scheme: Scheme =
    preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
  const value = useMemo(
    () => ({ preference, scheme, palette: paletteFor(scheme), setPreference }),
    [preference, scheme, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

export function usePalette(): Palette {
  return useTheme().palette;
}
