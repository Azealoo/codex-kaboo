import { TTFT_BUCKETS_MS, TTFT_BUCKET_COUNT } from "./constants";
import type { KeyCount, Tokens, ToolCounts, Ttft } from "./sync";

export interface ModelPrice {
  inputUsdPerMTok: number;
  cachedInputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export interface CostBreakdown {
  total: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

export function costOf(tokens: Tokens, price: ModelPrice): CostBreakdown {
  const uncachedInput = Math.max(0, tokens.input - tokens.cachedInput);
  const reasoningTokens = Math.min(tokens.reasoning, tokens.output);
  const plainOutput = Math.max(0, tokens.output - reasoningTokens);
  const input = (uncachedInput / 1e6) * price.inputUsdPerMTok;
  const cached = (tokens.cachedInput / 1e6) * price.cachedInputUsdPerMTok;
  const output = (plainOutput / 1e6) * price.outputUsdPerMTok;
  const reasoning = (reasoningTokens / 1e6) * price.outputUsdPerMTok;
  return { total: input + cached + output + reasoning, input, cached, output, reasoning };
}

export function cacheSavings(tokens: Tokens, price: ModelPrice): number {
  return (tokens.cachedInput / 1e6) * (price.inputUsdPerMTok - price.cachedInputUsdPerMTok);
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function cacheHitRate(tokens: Tokens): number | null {
  return ratio(tokens.cachedInput, tokens.input);
}

export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

export function emptyTokens(): Tokens {
  return { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };
}

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    total: a.total + b.total,
  };
}

export function emptyToolCounts(): ToolCounts {
  return {
    commandRead: 0,
    commandList: 0,
    commandSearch: 0,
    commandOther: 0,
    fileChange: 0,
    webSearch: 0,
    imageView: 0,
    mcpTool: 0,
    other: 0,
  };
}

export function addToolCounts(a: ToolCounts, b: ToolCounts): ToolCounts {
  return {
    commandRead: a.commandRead + b.commandRead,
    commandList: a.commandList + b.commandList,
    commandSearch: a.commandSearch + b.commandSearch,
    commandOther: a.commandOther + b.commandOther,
    fileChange: a.fileChange + b.fileChange,
    webSearch: a.webSearch + b.webSearch,
    imageView: a.imageView + b.imageView,
    mcpTool: a.mcpTool + b.mcpTool,
    other: a.other + b.other,
  };
}

export function emptyTtft(): Ttft {
  return { count: 0, sumMs: 0, hist: new Array<number>(TTFT_BUCKET_COUNT).fill(0) };
}

export function addTtft(a: Ttft, b: Ttft): Ttft {
  const hist = new Array<number>(TTFT_BUCKET_COUNT).fill(0);
  for (let i = 0; i < TTFT_BUCKET_COUNT; i++) hist[i] = (a.hist[i] ?? 0) + (b.hist[i] ?? 0);
  return { count: a.count + b.count, sumMs: a.sumMs + b.sumMs, hist };
}

/** Index of the first bucket whose upper bound is ≥ ms (last bucket is open-ended). */
export function ttftBucketIndex(ms: number): number {
  for (let i = 0; i < TTFT_BUCKET_COUNT; i++) {
    if (ms <= (TTFT_BUCKETS_MS[i] ?? Number.POSITIVE_INFINITY)) return i;
  }
  return TTFT_BUCKET_COUNT - 1;
}

export function ttftMean(t: Ttft): number | null {
  return t.count > 0 ? t.sumMs / t.count : null;
}

/** Approximate median: linear interpolation inside the bucket holding the (count/2)-th sample. */
export function ttftMedianApprox(t: Ttft): number | null {
  if (t.count <= 0) return null;
  const target = t.count / 2;
  let cumulative = 0;
  for (let i = 0; i < TTFT_BUCKET_COUNT; i++) {
    const n = t.hist[i] ?? 0;
    if (n === 0) continue;
    if (cumulative + n >= target) {
      const lower = i === 0 ? 0 : (TTFT_BUCKETS_MS[i - 1] ?? 0);
      const upper = i === TTFT_BUCKET_COUNT - 1 ? 120_000 : (TTFT_BUCKETS_MS[i] ?? 0);
      const fraction = (target - cumulative) / n;
      return lower + (upper - lower) * fraction;
    }
    cumulative += n;
  }
  return null;
}

export function sortByKey<T extends { key: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Sum by key, keep the top `cap − 1` by count (ties by key), fold the rest into `otherKey`, sort by key. */
export function mergeKeyCounts(lists: KeyCount[][], cap: number, otherKey: string): KeyCount[] {
  if (cap <= 0) return [];
  const sums = new Map<string, number>();
  for (const list of lists) {
    for (const { key, count } of list) sums.set(key, (sums.get(key) ?? 0) + count);
  }
  const ranked = [...sums.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (ranked.length <= cap) return sortByKey(ranked);
  const kept = ranked.slice(0, cap - 1);
  const rest = ranked.slice(cap - 1).reduce((acc, x) => acc + x.count, 0);
  return sortByKey([...kept, { key: otherKey, count: rest }]);
}
