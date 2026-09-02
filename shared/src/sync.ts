import { z } from "zod";
import {
  MAX_EVENTS_PER_REQUEST,
  MAX_KEYED_ENTRIES_PER_SESSION,
  MAX_SESSIONS_PER_REQUEST,
  MAX_STRING_LENGTH,
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  TTFT_BUCKET_COUNT,
} from "./constants";
import { isValidDay } from "./days";

export const shortString = z.string().max(MAX_STRING_LENGTH);
export const nonEmptyString = z.string().min(1).max(MAX_STRING_LENGTH);
export const count = z.int().min(0);
export const timestampMs = z.int().min(MIN_TIMESTAMP_MS).max(MAX_TIMESTAMP_MS);
export const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidDay, { message: "invalid calendar day" });
export const hourOfDay = z.int().min(0).max(23);

/** The subset of token fields the three invariants below constrain (`cacheWrite` is not one of them). */
type TokenFields = { input: number; cachedInput: number; output: number; reasoning: number; total: number };

/**
 * The parser's three token invariants: `cachedInput ⊆ input`, `reasoning ⊆ output` and
 * `total = input + output`. A row that breaks one is not unusual data, it is a parse bug, and it
 * corrupts silently: an over-large `cachedInput` renders a >100 % cache-hit rate and an inflated
 * `total` inflates every headline and leaderboard rank while cost — computed from `input`/`output`
 * — stays plausible, so nothing on the dashboard looks wrong. Rejecting the batch with a 400 that
 * names the field surfaces the bug instead; the CLI's documented 400 handling marks only that FILE
 * broken and keeps syncing the rest, so one bad file cannot block a machine's sync.
 */
function addTokenInvariantIssues(t: TokenFields, ctx: z.core.$RefinementCtx<TokenFields>): void {
  if (t.cachedInput > t.input) {
    ctx.addIssue({
      code: "custom",
      input: t.cachedInput,
      path: ["cachedInput"],
      message: `cachedInput (${t.cachedInput}) exceeds input (${t.input})`,
    });
  }
  if (t.reasoning > t.output) {
    ctx.addIssue({
      code: "custom",
      input: t.reasoning,
      path: ["reasoning"],
      message: `reasoning (${t.reasoning}) exceeds output (${t.output})`,
    });
  }
  if (t.total !== t.input + t.output) {
    ctx.addIssue({
      code: "custom",
      input: t.total,
      path: ["total"],
      message: `total (${t.total}) is not input + output (${t.input + t.output})`,
    });
  }
}

export const TokenCounts = z
  .object({
    input: count,
    cachedInput: count,
    cacheWrite: count,
    output: count,
    reasoning: count,
    total: count,
  })
  .superRefine(addTokenInvariantIssues);
export type Tokens = z.infer<typeof TokenCounts>;

export const ToolCounts = z.object({
  commandRead: count,
  commandList: count,
  commandSearch: count,
  commandOther: count,
  fileChange: count,
  webSearch: count,
  imageView: count,
  mcpTool: count,
  other: count,
});
export type ToolCounts = z.infer<typeof ToolCounts>;

export const KeyCount = z.object({ key: nonEmptyString, count });
export type KeyCount = z.infer<typeof KeyCount>;

export const Ttft = z.object({
  count,
  sumMs: count,
  hist: z.array(count).length(TTFT_BUCKET_COUNT),
});
export type Ttft = z.infer<typeof Ttft>;

/**
 * Which of Codex's two token-usage mechanisms produced a row: `token_count` event_msg lines
 * (`count`) or `token_usage_record` lines (`record`). A file that emits both is parsed as
 * `record`-only, but an earlier parse of the same file — truncated before its first
 * `token_usage_record` — will already have shipped `count` events that the server has to retract.
 * Carrying the mechanism on the wire is what makes that retraction expressible; see
 * `SessionSummary.eventOrigin`.
 */
export const TokenEventOrigin = z.enum(["count", "record"]);
export type TokenEventOrigin = z.infer<typeof TokenEventOrigin>;

export const SessionSummary = z.object({
  sessionId: nonEmptyString, // threadId or `${threadId}_${rolloutId}`
  threadId: nonEmptyString,
  parentThreadId: nonEmptyString.optional(),
  startedAt: timestampMs,
  endedAt: timestampMs,
  wallMs: count,
  day: dayString, // start day in the session's zone
  timezone: shortString.optional(),
  project: nonEmptyString, // basename(cwd) or "(unknown)"
  gitBranch: shortString.optional(),
  originator: shortString,
  source: nonEmptyString, // cli | exec | vscode | mcp | custom | internal | subagent:<kind> | unknown
  isSubagent: z.boolean(),
  model: nonEmptyString, // model of the last turn_context, else base_instructions model, else "(unknown)"
  effort: shortString.optional(), // effort of the last turn_context that had one
  cliVersion: shortString.optional(),
  turns: count,
  completedTurns: count,
  userMessages: count,
  agentMessages: count,
  reasoningItems: count,
  toolCounts: ToolCounts,
  mcpTools: z.array(KeyCount).max(MAX_KEYED_ENTRIES_PER_SESSION), // key = "server/tool"
  skills: z.array(KeyCount).max(MAX_KEYED_ENTRIES_PER_SESSION),
  linesAdded: count,
  linesRemoved: count,
  filesChanged: count,
  compactions: count,
  activeMs: count,
  ttft: Ttft,
  tokens: TokenCounts,
  responses: count, // number of token events
  /**
   * The mechanism this parse chose for the WHOLE file — re-derived from scratch every parse, so it
   * is always the file's current, authoritative answer, and it rides the file's last batch on every
   * parse. `record` here retracts any `count` event the server still holds for this session.
   */
  eventOrigin: TokenEventOrigin,
  inProgress: z.boolean(),
  lineCount: count,
  generation: count,
  parseErrors: count,
  parserVersion: count,
  summaryHash: z.string().regex(/^[0-9a-f]{40}$/), // sha1 of the canonical summary (see §6)
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const TokenEvent = z.object({
  sessionId: nonEmptyString,
  seq: count, // 0-based line index in the rollout file
  ts: timestampMs,
  day: dayString,
  hour: hourOfDay,
  model: nonEmptyString,
  effort: shortString.optional(),
  turnId: shortString.optional(),
  project: nonEmptyString,
  // Denormalised from the run and the session so the day's machine and source token totals can be
  // computed from EVENTS, on the event's own day, like every other token metric on the page.
  machineId: nonEmptyString,
  source: nonEmptyString, // the parent session's source
  isSubagent: z.boolean(),
  origin: TokenEventOrigin, // the line type this row was derived from
  input: count,
  cachedInput: count,
  cacheWrite: count,
  output: count,
  reasoning: count,
  total: count, // always input + output (recomputed by the parser)
  contextWindow: count.optional(),
}).superRefine(addTokenInvariantIssues); // same three invariants as TokenCounts, on flat fields
export type TokenEvent = z.infer<typeof TokenEvent>;

export const RateLimitSnapshot = z.object({
  observedAt: timestampMs, // timestamp of the log line that carried it
  usedPercent: z.number().min(0),
  windowMinutes: count,
  resetsAt: timestampMs.optional(),
  planType: shortString.optional(),
  limitId: shortString.optional(),
});
export type RateLimitSnapshot = z.infer<typeof RateLimitSnapshot>;

export const MachineInfo = z.object({
  machineId: nonEmptyString,
  label: z.string().min(1).max(64),
  platform: nonEmptyString, // process.platform
  arch: shortString.optional(),
  nodeVersion: shortString.optional(),
  codexVersion: shortString.optional(), // installed = newest session_meta.cli_version seen
  codexLatestVersion: shortString.optional(), // from <codex-home>/version.json
  hostname: shortString.nullable().optional(), // only with `login --hostname`
  tz: shortString.optional(),
});
export type MachineInfo = z.infer<typeof MachineInfo>;

export const SyncBatch = z.object({
  schemaVersion: z.literal(1),
  parserVersion: count,
  cliVersion: nonEmptyString,
  batchId: nonEmptyString,
  sentAt: timestampMs,
  machine: MachineInfo,
  sessions: z.array(SessionSummary).max(MAX_SESSIONS_PER_REQUEST),
  tokenEvents: z.array(TokenEvent).max(MAX_EVENTS_PER_REQUEST),
  rateLimit: RateLimitSnapshot.optional(),
});
export type SyncBatch = z.infer<typeof SyncBatch>;

export const UpsertCounts = z.object({ inserted: count, updated: count, unchanged: count });
export type UpsertCounts = z.infer<typeof UpsertCounts>;
export const SyncLimits = z.object({ maxBodyBytes: count, maxSessions: count, maxEvents: count });
export type SyncLimits = z.infer<typeof SyncLimits>;

export const SyncResponse = z.object({
  ok: z.literal(true),
  accepted: z.object({ sessions: UpsertCounts, events: UpsertCounts }),
  conflicts: z.object({ sessions: z.array(z.string()), events: count }),
  serverTime: z.number(),
  latestCliVersion: z.string().nullable(),
  limits: SyncLimits,
});
export type SyncResponse = z.infer<typeof SyncResponse>;

export const ErrorCode = z.enum([
  "unauthorized",
  "token_revoked",
  "payload_too_large",
  "too_many_items",
  "invalid_json",
  "invalid_batch",
  "machine_conflict",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({
  ok: z.literal(false),
  error: z.string(), // an ErrorCode; parsed loosely so new codes never break old CLIs
  message: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  limits: SyncLimits.optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const WhoamiResponse = z.object({
  ok: z.literal(true),
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  token: z.object({ name: z.string(), prefix: z.string() }),
  serverTime: z.number(),
});
export type WhoamiResponse = z.infer<typeof WhoamiResponse>;
