// web/convex/lib/types.ts
import type { Id } from "../_generated/dataModel";
import type { KeyCount, Tokens, ToolCounts } from "../../../shared/src/sync";

export type Metric = { current: number | null; previous: number | null; change: number | null };
export type Range = { from: string; to: string };

// The key union is owned by `shared/src/metric-defs.ts` (with the labels the UIs render) so that
// `stats.summary`, the web dashboard and the mobile app can never disagree about the set.
export type { MetricKey } from "../../../shared/src/metric-defs";
import type { MetricKey } from "../../../shared/src/metric-defs";

export type CostByKind = { input: number; cached: number; output: number; reasoning: number };

export type SummaryResult = {
  range: Range;
  previousRange: Range | null;
  tokens: Tokens;
  previousTokens: Tokens | null;
  metrics: Record<MetricKey, Metric>; // `current` is null exactly when the metric is an undefined
  // rate (zero denominator); counts and sums are never null
  costByKind: CostByKind;
  cacheSavingsUsd: number;
  unpricedModels: string[]; // models with tokens in range but no price row
  /**
   * Days in range whose stored rollup was computed under an older ROLLUP_VERSION. Rollups are only
   * recomputed for days a sync touches, so after a version bump every quiet day keeps the previous
   * version's numbers — and the read path served them as current, which is how the session-basis
   * `byMachine`/`bySource` bug would have survived its own fix on any day nothing re-synced.
   * `rollups:rebuildAll` is the repair; this is the only thing that says it is needed.
   */
  staleRollupDays: number;
};

export type UserRef = { userId: Id<"users">; name: string; imageUrl: string | null };

export type LeaderboardRow = UserRef & {
  tokens: Tokens;
  costUsd: number;
  unpriced: boolean;
  sessions: number;
  turns: number;
  messages: number;
  userMessages: number;
  linesAdded: number;
  linesRemoved: number;
  tokensPerLine: number | null;
  cacheHitRate: number | null;
  activeMs: number;
  rank: number; // 1-based by tokens.total desc, ties by name asc
  previousRank: number | null; // null when no previous data / previous disabled
  previousTokens: number | null;
  change: number | null; // percentChange(tokens.total, previousTokens)
};
export type LeaderboardResult = {
  range: Range;
  previousRange: Range | null;
  rows: LeaderboardRow[];
};

export type TrendPoint = {
  bucket: string; // bucket start day
  total: number; // tokens.total
  tokens: Tokens;
  costUsd: number;
  activeMs: number;
  sessions: number;
  byUser: { key: string; tokens: number; costUsd: number; activeMs: number }[]; // key = userId
  byModel: { key: string; tokens: number }[];
};
export type TrendsResult = {
  bucket: "day" | "week" | "month";
  points: TrendPoint[]; // one per bucket in range, zero-filled, ascending
  users: UserRef[]; // every user that appears in `points`
  models: string[]; // every model that appears, by total tokens desc
  peak: { bucket: string; total: number } | null;
  unpricedModels: string[]; // models with tokens in range but no price row: every
  // `costUsd` above understates spend by their share
};

export type ModelRow = {
  key: string;
  effort: string | null;
  tokens: Tokens;
  responses: number;
  costUsd: number | null;
  share: number;
};
export type BreakdownsResult = {
  totalTokens: number;
  byModel: ModelRow[]; // key = model, effort null (folded over efforts)
  byModelEffort: ModelRow[]; // key = model, effort set (raw rollup grain)
  byEffort: { key: string; tokens: number; responses: number; share: number }[]; // key = effort or "(none)"
  byTool: { key: string; count: number; share: number }[]; // fixed ToolKind keys, all 9 present
  byMcpTool: { key: string; count: number }[];
  bySkill: { key: string; count: number; sessions: number }[];
  byProject: {
    key: string;
    tokens: number;
    responses: number;
    sessions: number;
    userMessages: number;
    linesAdded: number;
    linesRemoved: number;
    share: number;
  }[];
  byMachine: { key: string; label: string; tokens: number; sessions: number; share: number }[]; // key = machineId
  bySource: { key: string; tokens: number; sessions: number; share: number }[];
  byHour: number[]; // 24 entries, total tokens
  toolCalls: number; // Σ byTool.count
};

export type ActivityHeatmapResult = {
  range: Range;
  days: { day: string; tokens: number; sessions: number; costUsd: number }[]; // only days with data
  activeDays: number;
  maxTokens: number;
  unpricedModels: string[]; // models with tokens in range but no price row: every
  // day's `costUsd` understates spend by their share
};

export type DayHourHeatmapResult = {
  grid: number[][]; // [weekday 0=Mon..6=Sun][hour 0..23] total tokens
  max: number;
  peakHour: number | null;
  peakWeekday: number | null;
  /**
   * Distinct timezones among the machines that contributed to this grid, or 0 when none of them
   * reported one. Hour buckets are stamped in each machine's own zone and summed together here,
   * so above 1 the grid — and "Peak hour" with it — is an average over different clocks rather
   * than a wall-clock hour. The offset is gone by the time the rollup reaches the server, so this
   * cannot be re-projected; the count exists so the UI can say so instead of implying precision.
   */
  zones: number;
};

export type QuotaResult = null | {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
  planType: string | null;
  limitId: string | null;
  observedAt: number;
  receivedAt: number;
  machine: { machineId: string; label: string };
  user: UserRef;
};

export type BoundsResult = { firstDay: string | null; lastDay: string | null };

export type QuotaHistoryPoint = {
  /** When the reading was true: `min(observedAt, receivedAt)` — see `freshness` in stats.ts. */
  t: number;
  usedPercent: number;
  resetsAt: number | null;
  machineId: string;
  label: string;
};
export type QuotaHistoryResult = {
  /** Ascending by `t`, every machine's readings interleaved. */
  points: QuotaHistoryPoint[];
  /** The window actually served, `[sinceMs, …)`, after clamping to the server's maximum. */
  sinceMs: number;
  truncated: boolean;
};

export type SessionRow = {
  _id: Id<"sessions">;
  sessionId: string;
  threadId: string;
  parentThreadId: string | null;
  userId: Id<"users">;
  userName: string;
  machineId: string;
  machineLabel: string;
  startedAt: number;
  endedAt: number;
  wallMs: number;
  day: string;
  timezone: string | null;
  project: string;
  gitBranch: string | null;
  originator: string;
  cliVersion: string | null;
  model: string;
  effort: string | null;
  source: string;
  isSubagent: boolean;
  turns: number;
  completedTurns: number;
  userMessages: number;
  agentMessages: number;
  reasoningItems: number;
  responses: number;
  tokens: Tokens;
  cacheHitRate: number | null;
  costUsd: number | null; // priced with the session's `model`; null when unpriced
  activeMs: number;
  ttftAvgMs: number | null; // mean time to first token over the session's turns
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  compactions: number;
  toolCounts: ToolCounts;
  mcpTools: KeyCount[]; // key = "server/tool"
  skills: KeyCount[];
  inProgress: boolean;
};

export type MachineRow = {
  _id: Id<"machines">;
  machineId: string;
  userId: Id<"users">;
  label: string;
  hostname: string | null;
  platform: string;
  arch: string | null;
  nodeVersion: string | null;
  cliVersion: string;
  codexVersion: string | null;
  codexLatestVersion: string | null;
  tz: string | null;
  firstSeenAt: number;
  lastSyncAt: number;
  lastRateLimit: {
    usedPercent: number;
    windowMinutes: number;
    resetsAt: number | null;
    planType: string | null;
    observedAt: number;
    receivedAt: number;
  } | null;
};

export type SyncTokenRow = {
  _id: Id<"syncTokens">;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};
export type PriceRow = {
  _id: Id<"modelPrices">;
  model: string;
  inputUsdPerMTok: number;
  cachedInputUsdPerMTok: number;
  outputUsdPerMTok: number;
  source: string;
  updatedAt: number;
};
export type MeResult = {
  _id: Id<"users">;
  clerkId: string;
  email: string | null;
  name: string;
  imageUrl: string | null;
  createdAt: number;
  lastSeenAt: number;
};
