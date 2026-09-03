"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useQueryStates } from "nuqs";
import { useCallback, useMemo } from "react";
import {
  isCustom,
  resolveRange,
  type Preset,
  type RangeParams,
  type ResolvedRange,
} from "@/lib/range";
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
  // (`?range=ALL&from=<day>` with no `to`) is still an ALL range, not a custom one.
  const isAll = !isCustom(params) && params.range === "ALL";
  // Fetched for every range, not just ALL: the fixed presets need `lastDay` to extend past the
  // viewer's own day for a teammate in a zone ahead. It is two indexed lookups, and Convex keeps
  // one subscription for the whole session.
  const bounds = useQuery(api.stats.bounds, today !== null ? {} : "skip");
  const resolved = useMemo(() => {
    if (today === null) return null;
    // ALL cannot be resolved at all without bounds, so it maps "still loading" to `null` and holds
    // the skeleton. Every other range resolves on the first render and merely refines once bounds
    // land — blocking them too would put an extra round trip in front of every page load.
    return resolveRange(params, today, isAll ? (bounds ?? null) : bounds);
  }, [params, today, isAll, bounds]);
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
