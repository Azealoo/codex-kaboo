/**
 * The wire contract for `GET /api/v1/summary` — the read endpoint the menu bar card is built on,
 * and the only one authed by a sync token rather than a Clerk session.
 *
 * The card renders four fixed ranges (its Day / Week / Month / All tabs) rather than an arbitrary
 * one, so the whole card is a single request: four range summaries plus one quota envelope. The
 * ranges are deliberately the SAME four the dashboard already offers as presets — 1D, 7D, 30D and
 * ALL — so a number on the card and the same number on My Page are the same number, which is the
 * entire reason the card reads from the server instead of computing its own totals locally.
 *
 * Raw values only: both sides of this wire are TypeScript importing `./format`, so a metric is
 * never sent twice (once as a number, once pre-formatted) the way a polyglot producer would have
 * to.
 */
import { z } from "zod";
import { MAX_QUERY_RANGE_DAYS } from "./constants";
import { addDays, compareDays, previousPeriod } from "./days";
import { TokenCounts, count, dayString, nonEmptyString, shortString, timestampMs } from "./sync";

/** The card's tabs, in the order they are drawn. */
export const SUMMARY_RANGE_KEYS = ["day", "week", "month", "all"] as const;
export type SummaryRangeKey = (typeof SUMMARY_RANGE_KEYS)[number];

/**
 * Length of each fixed range, in days, inclusive of today. These mirror `web/src/lib/range.ts`'s
 * `1D` / `7D` / `30D` presets; `summary.ranges.test.ts` in web pins them to it, because the card
 * showing "Week: 1.2M" beside a dashboard showing 1.4M for its own "Last 7 days" would be a bug
 * nobody could see from either side alone.
 */
export const SUMMARY_RANGE_DAYS: Record<Exclude<SummaryRangeKey, "all">, number> = {
  day: 1,
  week: 7,
  month: 30,
};

export const DayRange = z.object({ from: dayString, to: dayString });
export type DayRange = z.infer<typeof DayRange>;

/** First and last day that carry data, from `dailyRollups`; both null when there is none. */
export type DayBounds = { firstDay: string | null; lastDay: string | null };

export const RangeSummary = z.object({
  range: DayRange,
  previousRange: DayRange.nullable(), // null for `all`, which has nothing before it
  tokens: TokenCounts,
  costUsd: z.number(),
  /**
   * Models with tokens in range but no price row. `costUsd` understates spend by their share, so
   * the card draws a qualifier next to the cost rather than presenting a silently low number as
   * exact — the same contract `stats.summary` gives the dashboard.
   */
  unpricedModels: z.array(nonEmptyString),
  sessions: count,
  /** Change in `tokens.total` against `previousRange`; null when there is no comparable base. */
  changePercent: z.number().nullable(),
  topModel: nonEmptyString.nullable(),
});
export type RangeSummary = z.infer<typeof RangeSummary>;

/**
 * A quota reading and where it came from. The envelope exists so the card can say *why* a row is
 * blank instead of hiding the row: the same shape carries the server's account-wide value, the
 * machine-local `state.json` snapshot the card paints before the network answers, and "nothing has
 * reported a limit yet".
 */
export const QuotaSource = z.enum(["server", "local", "none"]);
export type QuotaSource = z.infer<typeof QuotaSource>;

export const QuotaValue = z.object({
  usedPercent: z.number().min(0),
  windowMinutes: count,
  resetsAt: timestampMs.nullable(),
  planType: shortString.nullable(),
  limitId: shortString.nullable(),
  observedAt: timestampMs,
  /**
   * When the SERVER stored this reading. Null for a locally-sourced envelope, which has never been
   * near a server clock. Staleness is judged on this whenever it is present, because `observedAt`
   * is a client's own reading of a log line and one machine with a fast RTC would otherwise report
   * itself perpetually fresh.
   */
  receivedAt: timestampMs.nullable(),
  /** The machine whose sync carried the reading; null for a local envelope, which is this one. */
  machine: z.object({ machineId: nonEmptyString, label: nonEmptyString }).nullable(),
});
export type QuotaValue = z.infer<typeof QuotaValue>;

export const QuotaEnvelope = z.object({
  value: QuotaValue.nullable(),
  source: QuotaSource, // "none" exactly when `value` is null
  fetchedAt: timestampMs,
  stale: z.boolean(),
});
export type QuotaEnvelope = z.infer<typeof QuotaEnvelope>;

export const SummaryResponse = z.object({
  ok: z.literal(true),
  serverTime: timestampMs,
  /** The day the ranges were anchored on — echoed back so a wrong client clock is visible. */
  today: dayString,
  user: z.object({ userId: nonEmptyString, name: z.string() }),
  ranges: z.object({
    day: RangeSummary,
    week: RangeSummary,
    month: RangeSummary,
    all: RangeSummary,
  }),
  quota: QuotaEnvelope,
});
export type SummaryResponse = z.infer<typeof SummaryResponse>;

/**
 * How far past the viewer's own day a machine-local day may legitimately sit.
 *
 * Day buckets are stamped in the reporting machine's zone; the window ends are computed in the
 * reader's zone — the browser's for the dashboard, the menu bar's for the card. UTC-12..UTC+14 is a
 * 26-hour spread, so a teammate can honestly be up to two calendar days ahead. Anything beyond that
 * is a wrong clock, not a timezone, and must not drag either surface forward with it.
 */
const MAX_FUTURE_DAY_LEAD = 2;

/**
 * The latest day a fixed-length window should end on: the reader's `today`, extended to cover a
 * machine whose day is genuinely ahead (see `MAX_FUTURE_DAY_LEAD`).
 *
 * `bounds` is advisory — the dashboard's presets resolve on first render without it rather than
 * blocking on the query the way ALL must, so a missing `lastDay` simply means "no lead known yet"
 * and the window ends at `today`.
 */
export function latestDay(today: string, bounds?: DayBounds | null): string {
  const lastDay = bounds?.lastDay;
  if (lastDay === undefined || lastDay === null) return today;
  if (compareDays(lastDay, today) <= 0) return today;
  const cap = addDays(today, MAX_FUTURE_DAY_LEAD);
  return compareDays(lastDay, cap) > 0 ? cap : lastDay;
}

/**
 * The all-time window for a viewer whose calendar day is `today`.
 *
 * Shared with `web/src/lib/range.ts`, which resolves the dashboard's ALL preset with it. Both ends
 * are clamped against `today` so the range can never invert: `bounds` are machine-local days, and a
 * machine in UTC+14 (or with a fast RTC) can legitimately own the only rollup dated `today + 1`
 * from this viewer, which would otherwise leave `from` after `to` and make every query throw
 * `bad_range`. `to` extends to cover such a day rather than silently dropping it, and the
 * MAX_QUERY_RANGE_DAYS floor is measured from `to` rather than from `today` — measured from
 * `today` it would span one day too many and throw the same error through a different door.
 */
export function allTimeRange(today: string, bounds: DayBounds): DayRange {
  const lastDay = bounds.lastDay ?? today;
  const to = compareDays(lastDay, today) > 0 ? lastDay : today;
  const earliest = addDays(to, -(MAX_QUERY_RANGE_DAYS - 1));
  const firstDay = bounds.firstDay ?? today;
  const cappedFirst = compareDays(firstDay, today) > 0 ? today : firstDay;
  const from = compareDays(cappedFirst, earliest) < 0 ? earliest : cappedFirst;
  return { from, to };
}

export type ResolvedSummaryRange = { range: DayRange; previousRange: DayRange | null };
export type ResolvedSummaryRanges = Record<SummaryRangeKey, ResolvedSummaryRange>;

/**
 * The four ranges the card asks for, resolved against the client's own calendar day.
 *
 * `today` comes from the client because the server runs in UTC and has no idea what day it is
 * where the menu bar is: a card opened at 21:00 in UTC+9 must show that day's tokens, not
 * yesterday's. It is validated as a calendar day by the handler and used for nothing else, so a
 * wrong one costs the caller an off-by-a-day card and nobody else anything.
 */
export function resolveSummaryRanges(today: string, bounds: DayBounds): ResolvedSummaryRanges {
  // The same ceiling the dashboard's fixed presets use, and anchored on `to` rather than `today`
  // for the same reason: extending the end while holding `from` would make a "last 7 days" window
  // eight days long and desync the previous period it is compared against.
  const to = latestDay(today, bounds);
  const fixed = (days: number): ResolvedSummaryRange => {
    const from = addDays(to, -(days - 1));
    return { range: { from, to }, previousRange: previousPeriod(from, to) };
  };
  return {
    day: fixed(SUMMARY_RANGE_DAYS.day),
    week: fixed(SUMMARY_RANGE_DAYS.week),
    month: fixed(SUMMARY_RANGE_DAYS.month),
    // No previous period: "everything before all time" is empty, and a delta against it would be a
    // meaningless −100 %. The dashboard's ALL preset passes `previous: false` for the same reason.
    all: { range: allTimeRange(today, bounds), previousRange: null },
  };
}
