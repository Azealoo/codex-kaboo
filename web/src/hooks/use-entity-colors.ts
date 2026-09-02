"use client";

import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useMemo } from "react";
import { api } from "@convex/_generated/api";
import type { PriceRow } from "@convex/lib/types";
import { modelColorMap, userColorMap, type ColorMap } from "@/lib/colors";

// `prices.ts` lands in a later Convex task (contracts §9: `prices.list | authedQuery | {} |
// PriceRow[] sorted by model`), so `api.prices.list` isn't in the generated `api` object yet.
// `makeFunctionReference` builds the identical reference (the same shape `api.prices.list`
// resolves to once codegen catches up) typed against the contract's result type, without
// inventing the backend function here.
const pricesList = makeFunctionReference<"query", Record<string, never>, PriceRow[]>("prices:list");

const EMPTY: ColorMap = new Map();

/** Stable user → color slots from the full user list (never from the filtered leaderboard). */
export function useUserColors(): ColorMap {
  const users = useQuery(api.users.list, {});
  return useMemo(() => (users ? userColorMap(users.map((u) => u.userId as string)) : EMPTY), [users]);
}

/** Stable model → color slots from the price registry plus models seen in the current view. */
export function useModelColors(seenModels: readonly string[]): ColorMap {
  const prices = useQuery(pricesList, {});
  const seenKey = seenModels.join(" ");
  return useMemo(
    () => modelColorMap(prices ? prices.map((p) => p.model) : [], seenKey === "" ? [] : seenKey.split(" ")),
    [prices, seenKey],
  );
}
