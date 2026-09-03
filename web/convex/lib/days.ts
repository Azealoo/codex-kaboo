import { ConvexError } from "convex/values";
import { MAX_QUERY_RANGE_DAYS } from "../../../shared/src/constants";
import { compareDays, daysBetween, isValidDay, previousPeriod } from "../../../shared/src/days";
import type { Range } from "./types";

/** Inclusive day range validation shared by every stats query. */
export function assertRange(from: string, to: string): Range {
  if (
    !isValidDay(from) ||
    !isValidDay(to) ||
    compareDays(from, to) > 0 ||
    daysBetween(from, to) > MAX_QUERY_RANGE_DAYS
  ) {
    throw new ConvexError({ code: "bad_range", from, to });
  }
  return { from, to };
}

/** `previous` defaults to true; the UI passes false for the ALL preset. */
export function resolvePeriods(
  from: string,
  to: string,
  previous: boolean | undefined,
): { range: Range; previousRange: Range | null } {
  const range = assertRange(from, to);
  return { range, previousRange: previous === false ? null : previousPeriod(from, to) };
}
