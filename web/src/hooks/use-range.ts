"use client";

import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useQueryStates } from "nuqs";
import { useCallback, useMemo } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { BoundsResult } from "@convex/lib/types";
import { isCustom, resolveRange, type Preset, type RangeParams, type ResolvedRange } from "@/lib/range";
import { rangeHref, rangeParsers } from "@/lib/search-params";
import { useToday } from "./use-today";

// `stats.ts` lands in a later Convex task (contracts §9: `stats.bounds | authedQuery |
// { userId? } | BoundsResult`), so `api.stats.bounds` isn't in the generated `api` object yet.
// `makeFunctionReference` builds the identical reference (`{ [functionName]: "stats:bounds" }`,
// the same shape `api.stats.bounds` resolves to once codegen catches up) typed against the
// contract's argument/result types, without inventing the backend function here.
const statsBounds = makeFunctionReference<"query", { userId?: Id<"users"> }, BoundsResult>("stats:bounds");

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
  const bounds = useQuery(statsBounds, needBounds ? {} : "skip");
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
