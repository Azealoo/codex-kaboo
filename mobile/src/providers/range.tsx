import { useQuery } from "convex/react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import { PRESETS, resolveRange, type Preset, type ResolvedRange } from "@shared/range";
import { useToday } from "@/hooks/use-today";

type RangeValue = {
  preset: Preset;
  setPreset: (p: Preset) => void;
  resolved: ResolvedRange | null;
  today: string;
};

const RangeContext = createContext<RangeValue | null>(null);

/** The app-wide date range (the web's `?range=` pill), resolved exactly like the dashboard does. */
export function RangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPreset] = useState<Preset>("30D");
  const today = useToday();
  const bounds = useQuery(api.stats.bounds, {});
  const resolved = useMemo(
    () =>
      resolveRange(
        { range: preset, from: null, to: null },
        today,
        preset === "ALL" ? (bounds ?? null) : bounds,
      ),
    [preset, today, bounds],
  );
  const value = useMemo(() => ({ preset, setPreset, resolved, today }), [preset, resolved, today]);
  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

export function useRange(): RangeValue {
  const ctx = useContext(RangeContext);
  if (ctx === null) throw new Error("useRange must be used inside <RangeProvider>");
  return ctx;
}

export { PRESETS };
