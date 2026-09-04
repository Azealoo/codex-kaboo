import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { useState } from "react";

/** `useQuery` that keeps the last data while the arguments change, so range switches dim instead of flashing. */
export function useStableQuery<Q extends FunctionReference<"query">>(
  query: Q,
  args: OptionalRestArgsOrSkip<Q>[0],
): { data: FunctionReturnType<Q> | undefined; isStale: boolean } {
  const result = useQuery(query, ...([args] as OptionalRestArgsOrSkip<Q>));
  const [previous, setPrevious] = useState<FunctionReturnType<Q> | undefined>(undefined);
  if (result !== undefined && result !== previous) setPrevious(result);
  if (result !== undefined) return { data: result, isStale: false };
  return { data: previous, isStale: previous !== undefined };
}
