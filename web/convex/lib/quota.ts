/**
 * Which machine's rate-limit reading speaks for the account.
 *
 * The Codex weekly limit is shared, so the gauge is account-wide: whichever machine reported most
 * recently wins, whoever it belongs to. Lifted out of `stats.quota` when the menu bar card became a
 * second reader — the ranking below is subtle enough that two copies of it would drift.
 */
import type { Doc } from "../_generated/dataModel";

export type StoredRateLimit = NonNullable<Doc<"machines">["lastRateLimit"]>;

/** Anything carrying a stored reading; generic so the ranking is testable without a whole `Doc`. */
export type WithRateLimit = { lastRateLimit?: StoredRateLimit };

/** The comparable timestamp the ranking below sorts on. */
function freshness(snapshot: { observedAt: number; receivedAt: number }): number {
  return Math.min(snapshot.observedAt, snapshot.receivedAt);
}

/**
 * The most recently reported reading, or null when no machine has ever sent one.
 *
 * Ranked on `min(observedAt, receivedAt)`, which takes the useful half of each clock.
 *
 * `receivedAt` alone answers "who synced last", not "whose number is newest": a machine that was
 * offline and catches up carries an old reading with the newest arrival time, so it wins and the
 * shared gauge walks backwards past a fresher reading.
 *
 * `observedAt` alone is worse. It is the reporting machine's own clock, which this codebase
 * documents as untrustworthy in two other places (see `quota-card.tsx`): a fast RTC claiming a
 * future observation would outrank every honest machine forever.
 *
 * The `min` bounds an honest machine by its own clock, so a late sync no longer beats a fresh one,
 * and bounds a lying one by when our server actually saw it, so the most it can claim is "I synced
 * most recently" — true, and harmless. Ties fall back to `receivedAt`.
 *
 * Staleness and the "as of" line stay on `receivedAt` in both readers: only the server clock is
 * comparable to the viewer's `now`.
 */
export function freshestRateLimit<T extends WithRateLimit>(
  machines: T[],
): { machine: T; snapshot: StoredRateLimit } | null {
  let best: { machine: T; snapshot: StoredRateLimit } | null = null;
  for (const machine of machines) {
    const snapshot = machine.lastRateLimit;
    if (!snapshot) continue;
    if (
      best === null ||
      freshness(snapshot) > freshness(best.snapshot) ||
      (freshness(snapshot) === freshness(best.snapshot) &&
        snapshot.receivedAt > best.snapshot.receivedAt)
    ) {
      best = { machine, snapshot };
    }
  }
  return best;
}
