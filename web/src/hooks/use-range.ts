"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useQueryStates } from "nuqs";
import { useCallback, useMemo } from "react";
import { isCustom, resolveRange, type Preset, type RangeParams, type ResolvedRange } from "@/lib/range";
import { rangeHref, rangeParsers } from "@/lib/search-params";
import { useToday } from "./use-today";

export function useRange(): {
  params: RangeParams;
  resolved: ResolvedRange | null;
  today: string | null;
  setPreset: (preset: Preset) => void;
  setCustom: (from: string, to: string) => void;
} {
  const [params, setParams] = useQueryStates(rangeParsers);
  const today = useToday();
  // Exactly the inverse of `resolveRange`'s ALL branch: a half-filled custom range
  // (`?range=ALL&from=<day>` with no `to`) must still fetch bounds, or the page never resolves.
  const needBounds = !isCustom(params) && params.range === "ALL" && today !== null;
  const bounds = useQuery(api.stats.bounds, needBounds ? {} : "skip");
  const resolved = useMemo(
    () => (today === null ? null : resolveRange(params, today, needBounds ? (bounds ?? null) : undefined)),
    [params, today, needBounds, bounds],
  );
  const setPreset = useCallback(
    (preset: Preset) => {
      void setParams({ range: preset, from: null, to: null });
    },
    [setParams],
  );
  const setCustom = useCallback(
    (from: string, to: string) => {
      void setParams({ range: null, from, to });
    },
    [setParams],
  );
  return { params, resolved, today, setPreset, setCustom };
}

/** Builds hrefs that keep the current range and drop page-local params. */
export function useRangeHref(): (pathname: string) => string {
  const [params] = useQueryStates(rangeParsers);
  return useCallback((pathname: string) => rangeHref(pathname, params), [params]);
}
