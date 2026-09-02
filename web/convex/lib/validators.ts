import { v } from "convex/values";

export const tokensValidator = v.object({
  input: v.number(),
  cachedInput: v.number(),
  cacheWrite: v.number(),
  output: v.number(),
  reasoning: v.number(),
  total: v.number(),
});

export const toolCountsValidator = v.object({
  commandRead: v.number(),
  commandList: v.number(),
  commandSearch: v.number(),
  commandOther: v.number(),
  fileChange: v.number(),
  webSearch: v.number(),
  imageView: v.number(),
  mcpTool: v.number(),
  other: v.number(),
});

export const keyCountValidator = v.object({ key: v.string(), count: v.number() });

export const ttftValidator = v.object({
  count: v.number(),
  sumMs: v.number(),
  hist: v.array(v.number()),
});

// Snapshot exactly as the CLI sends it (contracts §3 RateLimitSnapshot).
export const rateLimitSnapshotValidator = v.object({
  observedAt: v.number(),
  usedPercent: v.number(),
  windowMinutes: v.number(),
  resetsAt: v.optional(v.number()),
  planType: v.optional(v.string()),
  limitId: v.optional(v.string()),
});

// Stored on machines.lastRateLimit (contracts §8): the snapshot plus the server receive time.
export const rateLimitValidator = v.object({
  observedAt: v.number(),
  usedPercent: v.number(),
  windowMinutes: v.number(),
  resetsAt: v.optional(v.number()),
  planType: v.optional(v.string()),
  limitId: v.optional(v.string()),
  receivedAt: v.number(),
});

export const machineInfoValidator = v.object({
  machineId: v.string(),
  label: v.string(),
  platform: v.string(),
  arch: v.optional(v.string()),
  nodeVersion: v.optional(v.string()),
  codexVersion: v.optional(v.string()),
  codexLatestVersion: v.optional(v.string()),
  hostname: v.optional(v.union(v.string(), v.null())),
  tz: v.optional(v.string()),
});

// SessionSummary (contracts §3). The sessions table adds userId, machineId and syncedAt.
export const sessionSummaryFields = {
  sessionId: v.string(),
  threadId: v.string(),
  parentThreadId: v.optional(v.string()),
  startedAt: v.number(),
  endedAt: v.number(),
  wallMs: v.number(),
  day: v.string(),
  timezone: v.optional(v.string()),
  project: v.string(),
  gitBranch: v.optional(v.string()),
  originator: v.string(),
  source: v.string(),
  isSubagent: v.boolean(),
  model: v.string(),
  effort: v.optional(v.string()),
  cliVersion: v.optional(v.string()),
  turns: v.number(),
  completedTurns: v.number(),
  userMessages: v.number(),
  agentMessages: v.number(),
  reasoningItems: v.number(),
  toolCounts: toolCountsValidator,
  mcpTools: v.array(keyCountValidator),
  skills: v.array(keyCountValidator),
  linesAdded: v.number(),
  linesRemoved: v.number(),
  filesChanged: v.number(),
  compactions: v.number(),
  activeMs: v.number(),
  ttft: ttftValidator,
  tokens: tokensValidator,
  responses: v.number(),
  inProgress: v.boolean(),
  lineCount: v.number(),
  generation: v.number(),
  parseErrors: v.number(),
  parserVersion: v.number(),
  summaryHash: v.string(),
};

// TokenEvent (contracts §3). The tokenEvents table adds userId.
export const tokenEventFields = {
  sessionId: v.string(),
  seq: v.number(),
  ts: v.number(),
  day: v.string(),
  hour: v.number(),
  model: v.string(),
  effort: v.optional(v.string()),
  turnId: v.optional(v.string()),
  project: v.string(),
  isSubagent: v.boolean(),
  input: v.number(),
  cachedInput: v.number(),
  cacheWrite: v.number(),
  output: v.number(),
  reasoning: v.number(),
  total: v.number(),
  contextWindow: v.optional(v.number()),
};

// dailyRollups sub-aggregates. Every keyed array carries `key` (contracts §8).
export const rollupModelValidator = v.object({
  key: v.string(), // model
  effort: v.optional(v.string()),
  tokens: tokensValidator,
  responses: v.number(),
});
export const rollupSkillValidator = v.object({
  key: v.string(),
  count: v.number(),
  sessions: v.number(),
});
export const rollupProjectValidator = v.object({
  key: v.string(),
  tokens: v.number(),
  responses: v.number(),
  sessions: v.number(),
  userMessages: v.number(),
  linesAdded: v.number(),
  linesRemoved: v.number(),
});
export const rollupTokensSessionsValidator = v.object({
  key: v.string(),
  tokens: v.number(),
  sessions: v.number(),
});

export const dailyRollupFields = {
  userId: v.id("users"),
  day: v.string(),
  version: v.number(),
  computedAt: v.number(),
  tokens: tokensValidator,
  responses: v.number(),
  subagentTokens: tokensValidator,
  sessions: v.number(),
  subagentSessions: v.number(),
  turns: v.number(),
  userMessages: v.number(),
  agentMessages: v.number(),
  linesAdded: v.number(),
  linesRemoved: v.number(),
  filesChanged: v.number(),
  compactions: v.number(),
  activeMs: v.number(),
  wallMs: v.number(),
  ttft: ttftValidator,
  byHour: v.array(v.number()),
  byModel: v.array(rollupModelValidator),
  byTool: v.array(keyCountValidator),
  byMcpTool: v.array(keyCountValidator),
  bySkill: v.array(rollupSkillValidator),
  byProject: v.array(rollupProjectValidator),
  byMachine: v.array(rollupTokensSessionsValidator),
  bySource: v.array(rollupTokensSessionsValidator),
};
