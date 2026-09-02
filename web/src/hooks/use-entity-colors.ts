"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "@convex/_generated/api";
import { modelColorMap, userColorMap, type ColorMap } from "@/lib/colors";

const EMPTY: ColorMap = new Map();

/** Stable user → color slots from the full user list (never from the filtered leaderboard). */
export function useUserColors(): ColorMap {
  const users = useQuery(api.users.list, {});
  return useMemo(() => (users ? userColorMap(users.map((u) => u.userId as string)) : EMPTY), [users]);
}

/** Stable model → color slots from the price registry plus models seen in the current view. */
export function useModelColors(seenModels: readonly string[]): ColorMap {
  const prices = useQuery(api.prices.list, {});
  const seenKey = seenModels.join(" ");
  return useMemo(
    () => modelColorMap(prices ? prices.map((p) => p.model) : [], seenKey === "" ? [] : seenKey.split(" ")),
    [prices, seenKey],
  );
}
