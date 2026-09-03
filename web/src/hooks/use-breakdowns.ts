"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { BreakdownsResult } from "@convex/lib/types";
import type { ResolvedRange } from "@/lib/range";
import { useStableQuery } from "./use-stable-query";

export function useBreakdowns(
  range: ResolvedRange | null,
  userId?: Id<"users">,
): { data: BreakdownsResult | undefined; isStale: boolean } {
  return useStableQuery(
    api.stats.breakdowns,
    range === null ? "skip" : { from: range.from, to: range.to, userId },
  );
}
