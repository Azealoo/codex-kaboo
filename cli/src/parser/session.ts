import {
  MAX_KEYED_ENTRIES_PER_SESSION, MAX_STRING_LENGTH, OTHER_KEY, PARSER_VERSION,
} from "@codex-kaboo/shared/constants";
import { addTokens, emptyTokens, emptyToolCounts, emptyTtft, mergeKeyCounts, ttftBucketIndex } from "@codex-kaboo/shared/metrics";
import type {
  KeyCount, RateLimitSnapshot, SessionSummary, TokenEvent, TokenEventOrigin, ToolCounts, Ttft,
} from "@codex-kaboo/shared/sync";
import { parseJsonLine } from "../core/jsonl-reader";
import { summaryHashOf } from "../util/hash";
import {
  asRecord, classifyParsedCmdType, clipString, detectSkills, isSubagentSource, mcpKeyFromFunctionName, projectOf, sourceOf, toCount,
} from "./classify";
import { countDiffLines, countLines } from "./diff";
import { dayHour, isValidZone, parseLineTimestamp, resolveZone, secondsToMs } from "./time";

export interface ReducerContext {
  sessionId: string;
  threadId: string;
  rolloutId: string | null;
  fileTimestampMs: number | null;
  machineZone?: string;
}

interface TurnInfo {
  model?: string;
  effort?: string;
  mode?: string;
}

interface PendingEvent {
  seq: number;
  ts: number;
  origin: TokenEventOrigin;
  turnId?: string;
  model?: string; // explicit model on the line (token_usage_record only)
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  contextWindow?: number;
}

export interface ReducerState {
  ctx: ReducerContext;
  metaSeen: boolean;
  threadId: string;
  startedAt: number | null;
  project: string;
  gitBranch?: string;
  originator: string;
  source: string;
  isSubagent: boolean;
  parentThreadId?: string;
  cliVersion?: string;
  fallbackModel?: string;
  timezone?: string;
  turns: Map<string, TurnInfo>;
  currentTurnId?: string;
  openTurn: boolean;
  lastModel?: string;
  lastEffort?: string;
  contextWindow?: number;
  counts: {
    turns: number;
    completedTurns: number;
    userMessages: number;
    agentMessages: number;
    reasoningItems: number;
    legacyUserMessages: number;
    legacyAgentMessages: number;
    compactedLines: number;
    contextCompactionItems: number;
    linesAdded: number;
    linesRemoved: number;
    filesChanged: number;
    activeMs: number;
    lineCount: number;
    parseErrors: number;
  };
  toolCounts: ToolCounts;
  mcpTools: Map<string, number>; // from McpToolCall items
  mcpFallback: Map<string, number>; // from response_item/function_call names
  skills: Map<string, number>;
  ttft: Ttft;
  tokenCountEvents: PendingEvent[];
  usageRecordEvents: PendingEvent[];
  hasUsageRecords: boolean;
  firstTs: number | null;
  lastTs: number | null;
  rateLimit: RateLimitSnapshot | null;
  unknownTypes: Map<string, number>;
  itemTypes: Map<string, number>;
}

export interface FinalizeOptions {
  now: number;
  generation: number;
}

export interface ParsedSession {
  summary: SessionSummary;
  events: TokenEvent[];
  rateLimit: RateLimitSnapshot | null;
  diagnostics: {
    unknownTypes: Record<string, number>;
    itemTypes: Record<string, number>;
    mcpFallbackUsed: boolean;
    zone: string | undefined;
  };
}

export function createReducerState(ctx: ReducerContext): ReducerState {
  return {
    ctx,
    metaSeen: false,
    threadId: ctx.threadId,
    startedAt: null,
    project: "(unknown)",
    originator: "unknown",
    source: "unknown",
    isSubagent: false,
    turns: new Map(),
    openTurn: false,
    counts: {
      turns: 0, completedTurns: 0, userMessages: 0, agentMessages: 0, reasoningItems: 0,
      legacyUserMessages: 0, legacyAgentMessages: 0, compactedLines: 0, contextCompactionItems: 0,
      linesAdded: 0, linesRemoved: 0, filesChanged: 0, activeMs: 0, lineCount: 0, parseErrors: 0,
    },
    toolCounts: emptyToolCounts(),
    mcpTools: new Map(),
    mcpFallback: new Map(),
    skills: new Map(),
    ttft: emptyTtft(),
    tokenCountEvents: [],
    usageRecordEvents: [],
    hasUsageRecords: false,
    firstTs: null,
    lastTs: null,
    rateLimit: null,
    unknownTypes: new Map(),
    itemTypes: new Map(),
  };
}

/**
 * The single choke point for every counting map the reducer keeps — `unknownTypes`, `itemTypes`,
 * `skills`, `mcpTools`, `mcpFallback`. Keys are clipped and the map is bounded HERE rather than at
 * each call site: an unclipped key reached `sync.log` verbatim via the diagnostics DEBUG line (the
 * file a user pastes into a bug report), and an unbounded map let a pathological file grow it
 * without limit. Past the bound, a new key folds into OTHER_KEY, which is reserved rather than
 * counted as an ordinary entry so the map never exceeds MAX_KEYED_ENTRIES_PER_SESSION — the same
 * keep-(cap - 1)-and-fold shape the rollup's `capEntries` uses, and within the wire's own cap on
 * `mcpTools` / `skills`, so `mergeKeyCounts` never has to fold again and cannot emit two
 * `(other)` rows.
 */
export function bump(map: Map<string, number>, key: string): void {
  const clipped = key.length > MAX_STRING_LENGTH ? key.slice(0, MAX_STRING_LENGTH) : key;
  const target =
    map.has(clipped) || map.size < MAX_KEYED_ENTRIES_PER_SESSION - 1 ? clipped : OTHER_KEY;
  map.set(target, (map.get(target) ?? 0) + 1);
}

/** Feed one raw line (already `\n`-terminated in the file). Parse failures are counted and skipped. */
export function reduceLine(state: ReducerState, seq: number, text: string): void {
  state.counts.lineCount += 1;
  const parsed = asRecord(parseJsonLine(text));
  if (parsed === null) {
    state.counts.parseErrors += 1;
    return;
  }
  reduce(state, seq, parsed);
}

export function reduce(state: ReducerState, seq: number, line: Record<string, unknown>): void {
  const ts = parseLineTimestamp(line.timestamp);
  if (ts !== null) {
    if (state.firstTs === null || ts < state.firstTs) state.firstTs = ts;
    if (state.lastTs === null || ts > state.lastTs) state.lastTs = ts;
  }
  const payload = asRecord(line.payload) ?? {};
  switch (line.type) {
    case "session_meta":
      handleSessionMeta(state, payload, ts);
      break;
    case "turn_context":
      handleTurnContext(state, payload);
      break;
    case "event_msg":
      handleEventMsg(state, seq, payload, ts);
      break;
    case "token_usage_record":
      handleUsageRecord(state, seq, payload, ts);
      break;
    case "response_item":
      handleResponseItem(state, payload);
      break;
    case "compacted":
      state.counts.compactedLines += 1;
      break;
    default:
      bump(state.unknownTypes, typeof line.type === "string" ? line.type : "(non-string type)");
  }
}

function handleSessionMeta(state: ReducerState, payload: Record<string, unknown>, lineTs: number | null): void {
  state.metaSeen = true;
  const id = clipString(payload.id);
  if (id) state.threadId = id;
  state.startedAt = parseLineTimestamp(payload.timestamp) ?? lineTs ?? state.startedAt;
  state.project = projectOf(payload.cwd);
  const branch = clipString(asRecord(payload.git)?.branch);
  if (branch) state.gitBranch = branch;
  state.originator = clipString(payload.originator) ?? "unknown";
  state.source = sourceOf(payload.source);
  const parent = clipString(payload.parent_thread_id);
  if (parent) state.parentThreadId = parent;
  state.isSubagent = isSubagentSource(state.source) || parent !== undefined;
  const cliVersion = clipString(payload.cli_version);
  if (cliVersion) state.cliVersion = cliVersion;
  const model = clipString(asRecord(asRecord(payload.base_instructions)?.provenance)?.model);
  if (model) state.fallbackModel = model;
}

function handleTurnContext(state: ReducerState, payload: Record<string, unknown>): void {
  const turnId = clipString(payload.turn_id);
  const model = clipString(payload.model);
  const effort = clipString(payload.effort);
  const mode = clipString(asRecord(payload.collaboration_mode)?.mode);
  if (turnId) {
    const info: TurnInfo = {};
    if (model) info.model = model;
    if (effort) info.effort = effort;
    if (mode) info.mode = mode;
    state.turns.set(turnId, info);
  }
  if (model) state.lastModel = model;
  if (effort) state.lastEffort = effort;
  if (state.timezone === undefined) {
    const zone = clipString(payload.timezone);
    if (zone && isValidZone(zone)) state.timezone = zone;
  }
}

function pendingEventFrom(
  state: ReducerState,
  seq: number,
  ts: number | null,
  usage: Record<string, unknown>,
  info: Record<string, unknown> | null,
  origin: TokenEventOrigin,
): PendingEvent | null {
  if (ts === null) return null;
  const input = toCount(usage.input_tokens);
  const cachedInput = toCount(usage.cached_input_tokens);
  const cacheWrite = toCount(usage.cache_write_input_tokens);
  const output = toCount(usage.output_tokens);
  const reasoning = toCount(usage.reasoning_output_tokens);
  if (input + cachedInput + cacheWrite + output + reasoning === 0) return null;
  const contextWindow = toCount(info?.model_context_window) || state.contextWindow;
  const event: PendingEvent = { seq, ts, origin, input, cachedInput, cacheWrite, output, reasoning };
  if (state.currentTurnId) event.turnId = state.currentTurnId;
  if (contextWindow) event.contextWindow = contextWindow;
  return event;
}

function considerRateLimit(state: ReducerState, rateLimits: Record<string, unknown>, ts: number): void {
  const primary = asRecord(rateLimits.primary);
  if (primary === null) return;
  const used = primary.used_percent;
  if (typeof used !== "number" || !Number.isFinite(used)) return;
  const snapshot: RateLimitSnapshot = {
    observedAt: ts,
    usedPercent: Math.max(0, used),
    windowMinutes: toCount(primary.window_minutes),
  };
  const resetsAt = secondsToMs(primary.resets_at);
  if (resetsAt !== null) snapshot.resetsAt = resetsAt;
  const planType = clipString(rateLimits.plan_type);
  if (planType) snapshot.planType = planType;
  const limitId = clipString(rateLimits.limit_id);
  if (limitId) snapshot.limitId = limitId;
  if (state.rateLimit === null || snapshot.observedAt >= state.rateLimit.observedAt) state.rateLimit = snapshot;
}

function handleEventMsg(state: ReducerState, seq: number, payload: Record<string, unknown>, ts: number | null): void {
  const c = state.counts;
  switch (payload.type) {
    case "task_started": {
      c.turns += 1;
      const turnId = clipString(payload.turn_id);
      if (turnId) state.currentTurnId = turnId;
      state.openTurn = true;
      const contextWindow = toCount(payload.model_context_window);
      if (contextWindow > 0) state.contextWindow = contextWindow;
      break;
    }
    case "task_complete": {
      c.completedTurns += 1;
      state.openTurn = false;
      const duration = payload.duration_ms;
      if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
        c.activeMs += Math.round(duration);
      } else {
        const started = secondsToMs(payload.started_at);
        const completed = secondsToMs(payload.completed_at);
        if (started !== null && completed !== null && completed >= started) c.activeMs += completed - started;
      }
      const ttft = payload.time_to_first_token_ms;
      if (typeof ttft === "number" && Number.isFinite(ttft) && ttft >= 0) {
        state.ttft.count += 1;
        state.ttft.sumMs += Math.round(ttft);
        const idx = ttftBucketIndex(ttft);
        state.ttft.hist[idx] = (state.ttft.hist[idx] ?? 0) + 1;
      }
      break;
    }
    case "token_count": {
      const info = asRecord(payload.info);
      const usage = asRecord(info?.last_token_usage);
      if (usage !== null) {
        const event = pendingEventFrom(state, seq, ts, usage, info, "count");
        if (event) state.tokenCountEvents.push(event);
      }
      const rateLimits = asRecord(payload.rate_limits);
      if (rateLimits !== null && ts !== null) considerRateLimit(state, rateLimits, ts);
      break;
    }
    case "item_completed":
      handleItemCompleted(state, payload);
      break;
    case "user_message":
      c.legacyUserMessages += 1;
      break;
    case "agent_message":
      c.legacyAgentMessages += 1;
      break;
    default:
      bump(state.unknownTypes, `event_msg/${typeof payload.type === "string" ? payload.type : "(none)"}`);
  }
}

function handleUsageRecord(state: ReducerState, seq: number, payload: Record<string, unknown>, ts: number | null): void {
  const info = asRecord(payload.info);
  const usage =
    asRecord(payload.usage) ?? asRecord(info?.last_token_usage) ?? (typeof payload.input_tokens === "number" ? payload : null);
  if (usage === null) {
    bump(state.unknownTypes, "token_usage_record/unrecognised");
    return;
  }
  const event = pendingEventFrom(state, seq, ts, usage, info, "record");
  if (event === null) return; // degenerate (all-zero or unparseable ts) — must not suppress token_count events
  state.hasUsageRecords = true;
  const turnId = clipString(payload.turn_id);
  if (turnId) event.turnId = turnId;
  const model = clipString(payload.model);
  if (model) event.model = model;
  state.usageRecordEvents.push(event);
}

function handleItemCompleted(state: ReducerState, payload: Record<string, unknown>): void {
  const item = asRecord(payload.item);
  if (item === null) {
    state.toolCounts.other += 1;
    return;
  }
  const type = typeof item.type === "string" ? item.type : "(none)";
  bump(state.itemTypes, type);
  const c = state.counts;
  switch (type) {
    case "UserMessage":
      c.userMessages += 1;
      break;
    case "AgentMessage":
      c.agentMessages += 1;
      break;
    case "Reasoning":
      c.reasoningItems += 1;
      break;
    case "CommandExecution":
      handleCommandExecution(state, item);
      break;
    case "FileChange":
      handleFileChange(state, item);
      break;
    case "Extension":
      if (item.kind === "web.search") state.toolCounts.webSearch += 1;
      else state.toolCounts.other += 1;
      break;
    case "WebSearch":
      state.toolCounts.webSearch += 1;
      break;
    case "ImageView":
      state.toolCounts.imageView += 1;
      break;
    case "McpToolCall": {
      state.toolCounts.mcpTool += 1;
      const server = clipString(item.server, 120) ?? "unknown";
      const tool = clipString(item.tool, 120) ?? "unknown";
      bump(state.mcpTools, `${server}/${tool}`);
      break;
    }
    case "ContextCompaction":
      c.contextCompactionItems += 1;
      break;
    default:
      state.toolCounts.other += 1;
  }
}

/** Counts parsed_cmd kinds and detects skills; the command text itself is matched, never stored. */
function handleCommandExecution(state: ReducerState, item: Record<string, unknown>): void {
  const parsed = Array.isArray(item.parsed_cmd) ? item.parsed_cmd : [];
  if (parsed.length === 0) state.toolCounts.commandOther += 1;
  const haystack: unknown[] = [];
  for (const entry of parsed) {
    const record = asRecord(entry);
    state.toolCounts[classifyParsedCmdType(record?.type)] += 1;
    if (record !== null) haystack.push(record.path, record.cmd);
  }
  if (Array.isArray(item.command)) haystack.push(...item.command);
  for (const skill of detectSkills(haystack)) bump(state.skills, skill);
}

function handleFileChange(state: ReducerState, item: Record<string, unknown>): void {
  state.toolCounts.fileChange += 1;
  const changes = asRecord(item.changes) ?? {};
  const c = state.counts;
  c.filesChanged += Object.keys(changes).length;
  for (const change of Object.values(changes)) {
    const record = asRecord(change);
    if (record === null) continue;
    if (record.type === "update") {
      const { added, removed } = countDiffLines(typeof record.unified_diff === "string" ? record.unified_diff : "");
      c.linesAdded += added;
      c.linesRemoved += removed;
    } else if (record.type === "add") {
      c.linesAdded += countLines(typeof record.content === "string" ? record.content : "");
    } else if (record.type === "delete") {
      c.linesRemoved += countLines(typeof record.content === "string" ? record.content : "");
    }
  }
}

/** Only `function_call` names are inspected (MCP fallback); arguments/outputs are never read. */
function handleResponseItem(state: ReducerState, payload: Record<string, unknown>): void {
  if (payload.type !== "function_call") return;
  const key = mcpKeyFromFunctionName(payload.name);
  if (key !== null) bump(state.mcpFallback, key);
}

function mapToKeyCounts(map: Map<string, number>): KeyCount[] {
  return [...map.entries()].map(([key, count]) => ({ key, count }));
}

export function finalize(state: ReducerState, opts: FinalizeOptions): ParsedSession {
  const c = state.counts;
  const zone = resolveZone(state.timezone, state.ctx.machineZone);
  const startedAt = state.startedAt ?? state.firstTs ?? state.ctx.fileTimestampMs ?? opts.now;
  const endedAt = Math.max(startedAt, state.lastTs ?? startedAt);
  // Whole-file choice, re-decided from scratch on every parse. It rides the summary as
  // `eventOrigin` because a PREVIOUS parse of a still-growing file may have taken the other branch
  // and already shipped its events; the server uses the flip to `record` to retract them.
  const eventOrigin: TokenEventOrigin = state.hasUsageRecords ? "record" : "count";
  const pending = state.hasUsageRecords ? state.usageRecordEvents : state.tokenCountEvents;
  const events: TokenEvent[] = [...pending]
    .sort((a, b) => a.seq - b.seq)
    .map((ev) => {
      const turn = ev.turnId ? state.turns.get(ev.turnId) : undefined;
      const { day, hour } = dayHour(ev.ts, zone);
      const event: TokenEvent = {
        sessionId: state.ctx.sessionId,
        seq: ev.seq,
        ts: ev.ts,
        day,
        hour,
        model: ev.model ?? turn?.model ?? state.lastModel ?? state.fallbackModel ?? "(unknown)",
        project: state.project,
        source: state.source,
        isSubagent: state.isSubagent,
        origin: ev.origin,
        input: ev.input,
        cachedInput: ev.cachedInput,
        cacheWrite: ev.cacheWrite,
        output: ev.output,
        reasoning: ev.reasoning,
        total: ev.input + ev.output,
      };
      const effort = turn?.effort ?? state.lastEffort;
      if (effort) event.effort = effort;
      if (ev.turnId) event.turnId = ev.turnId;
      if (ev.contextWindow) event.contextWindow = ev.contextWindow;
      return event;
    });
  const tokens = events.reduce((acc, e) => addTokens(acc, e), emptyTokens());
  const mcpFallbackUsed = state.mcpTools.size === 0 && state.mcpFallback.size > 0;
  const mcpSource = mcpFallbackUsed ? state.mcpFallback : state.mcpTools;
  const toolCounts: ToolCounts = { ...state.toolCounts };
  if (mcpFallbackUsed) toolCounts.mcpTool = [...state.mcpFallback.values()].reduce((a, b) => a + b, 0);
  const base: Omit<SessionSummary, "summaryHash"> = {
    sessionId: state.ctx.sessionId,
    threadId: state.threadId,
    startedAt,
    endedAt,
    wallMs: endedAt - startedAt,
    day: dayHour(startedAt, zone).day,
    project: state.project,
    originator: state.originator,
    source: state.source,
    isSubagent: state.isSubagent,
    model: state.lastModel ?? state.fallbackModel ?? "(unknown)",
    turns: c.turns,
    completedTurns: c.completedTurns,
    userMessages: c.userMessages > 0 ? c.userMessages : c.legacyUserMessages,
    agentMessages: c.agentMessages > 0 ? c.agentMessages : c.legacyAgentMessages,
    reasoningItems: c.reasoningItems,
    toolCounts,
    mcpTools: mergeKeyCounts([mapToKeyCounts(mcpSource)], MAX_KEYED_ENTRIES_PER_SESSION, OTHER_KEY),
    skills: mergeKeyCounts([mapToKeyCounts(state.skills)], MAX_KEYED_ENTRIES_PER_SESSION, OTHER_KEY),
    linesAdded: c.linesAdded,
    linesRemoved: c.linesRemoved,
    filesChanged: c.filesChanged,
    compactions: Math.max(c.compactedLines, c.contextCompactionItems),
    activeMs: c.activeMs,
    ttft: { count: state.ttft.count, sumMs: state.ttft.sumMs, hist: [...state.ttft.hist] },
    tokens,
    responses: events.length,
    eventOrigin,
    inProgress: state.openTurn, // structural only: a started turn without completion
    lineCount: c.lineCount,
    generation: opts.generation,
    parseErrors: c.parseErrors,
    parserVersion: PARSER_VERSION,
  };
  if (state.parentThreadId) base.parentThreadId = state.parentThreadId;
  if (zone) base.timezone = zone;
  if (state.gitBranch) base.gitBranch = state.gitBranch;
  if (state.lastEffort) base.effort = state.lastEffort;
  if (state.cliVersion) base.cliVersion = state.cliVersion;
  const summary: SessionSummary = { ...base, summaryHash: summaryHashOf(base) };
  return {
    summary,
    events,
    rateLimit: state.rateLimit,
    diagnostics: {
      unknownTypes: Object.fromEntries(state.unknownTypes),
      itemTypes: Object.fromEntries(state.itemTypes),
      mcpFallbackUsed,
      zone,
    },
  };
}
