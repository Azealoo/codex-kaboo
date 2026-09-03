/**
 * The live tokens-per-second strip: samples in, a bucketed window out. Pure — no clock, no disk —
 * so every rule below is testable, and the same function runs in the CLI's `card` command and in
 * the menu bar renderer.
 *
 * Output tokens only. Input and cached tokens arrive in one lump at request time, so counting them
 * would draw a spike whose height says how big the context was, not how fast the model is going —
 * the number nobody watching a menu bar wants.
 */
import { TPS_ACTIVE_MS, TPS_BUCKET_MS, TPS_WINDOW_MS } from "@codex-kaboo/shared/constants";

/** One model response's output, as the sampler saw it. */
export interface TpsSample {
  ts: number;
  output: number;
  model: string;
  sessionId: string;
}

export interface TpsBucket {
  startMs: number;
  output: number;
  /** Non-empty models only, by output desc then key — the order a stacked bar should draw them. */
  byModel: { key: string; output: number }[];
}

export interface TpsWindow {
  from: number;
  to: number;
  bucketMs: number;
  buckets: TpsBucket[]; // oldest first, zero-filled: exactly ceil(windowMs / bucketMs) entries
  /**
   * Rate over the most recent COMPLETE bucket. The bucket containing `now` is still filling, so
   * reading it would report a rate that falls to near zero every time the window ticks over and
   * then jumps back — a number that flickers rather than one that is wrong, but useless either way.
   * The cost is that `currentTps` lags reality by up to one bucket, which is the honest trade.
   */
  currentTps: number;
  /** Window total ÷ window seconds — the card's "3m avg". */
  averageTps: number;
  /** Fastest single bucket in the window; what a chart's axis should be scaled to. */
  peakTps: number;
  totalOutput: number;
  models: string[]; // every model with output in the window, by output desc then key
  activeSessions: number;
}

export interface BucketOptions {
  windowMs?: number;
  bucketMs?: number;
  /** A session counts as active while it has produced output within this long. */
  activeMs?: number;
}

/** Drops samples older than `retainMs`. Kept separate so the sampler can trim without bucketing. */
export function trimSamples(samples: TpsSample[], now: number, retainMs: number): TpsSample[] {
  const cutoff = now - retainMs;
  return samples.filter((s) => s.ts > cutoff);
}

function cmpKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Buckets `samples` into the window ending at `now`.
 *
 * Bucket boundaries are absolute (`floor(ts / bucketMs)`), not relative to `now`, so a sample does
 * not migrate between buckets as the window slides — the chart shifts left, it does not reshuffle.
 */
export function bucketize(samples: TpsSample[], now: number, opts: BucketOptions = {}): TpsWindow {
  const bucketMs = opts.bucketMs ?? TPS_BUCKET_MS;
  const windowMs = opts.windowMs ?? TPS_WINDOW_MS;
  const activeMs = opts.activeMs ?? TPS_ACTIVE_MS;
  const count = Math.max(1, Math.ceil(windowMs / bucketMs));
  // The newest bucket is the one holding `now`; the window is the `count` buckets ending with it.
  const newestStart = Math.floor(now / bucketMs) * bucketMs;
  const from = newestStart - (count - 1) * bucketMs;
  const to = newestStart + bucketMs;

  const totals = new Array<number>(count).fill(0);
  const perModel = Array.from({ length: count }, () => new Map<string, number>());
  const windowModels = new Map<string, number>();
  const activeSessions = new Set<string>();
  let totalOutput = 0;

  for (const sample of samples) {
    if (sample.output > 0 && sample.ts > now - activeMs) activeSessions.add(sample.sessionId);
    if (sample.ts < from || sample.ts >= to) continue;
    const index = Math.floor((sample.ts - from) / bucketMs);
    const slot = perModel[index];
    if (slot === undefined) continue;
    totals[index] = (totals[index] ?? 0) + sample.output;
    slot.set(sample.model, (slot.get(sample.model) ?? 0) + sample.output);
    windowModels.set(sample.model, (windowModels.get(sample.model) ?? 0) + sample.output);
    totalOutput += sample.output;
  }

  const byOutputDesc = (a: { key: string; output: number }, b: { key: string; output: number }) =>
    b.output - a.output || cmpKey(a.key, b.key);

  const buckets: TpsBucket[] = totals.map((output, index) => ({
    startMs: from + index * bucketMs,
    output,
    byModel: [...(perModel[index] ?? new Map<string, number>())]
      .map(([key, value]) => ({ key, output: value }))
      .filter((entry) => entry.output > 0)
      .sort(byOutputDesc),
  }));

  const bucketSeconds = bucketMs / 1000;
  // `count - 2` is the last complete bucket; with a one-bucket window there is none, so 0.
  const currentOutput = count >= 2 ? (totals[count - 2] ?? 0) : 0;
  const peak = totals.reduce((max, value) => Math.max(max, value), 0);

  return {
    from,
    to,
    bucketMs,
    buckets,
    currentTps: currentOutput / bucketSeconds,
    averageTps: totalOutput / (windowMs / 1000),
    peakTps: peak / bucketSeconds,
    totalOutput,
    models: [...windowModels]
      .map(([key, output]) => ({ key, output }))
      .sort(byOutputDesc)
      .map((entry) => entry.key),
    activeSessions: activeSessions.size,
  };
}

/**
 * A round number at or above `value`, on the 1 / 2 / 5 ladder, for a chart's axis. Never below
 * `floor` (default 20), so an idle chart has a stable axis instead of one that rescales on every
 * stray token.
 */
export function niceMax(value: number, floor = 20): number {
  const target = Math.max(value, floor);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= target) return candidate;
  }
  return 10 * magnitude;
}
