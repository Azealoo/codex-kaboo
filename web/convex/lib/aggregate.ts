import type { Id } from "../_generated/dataModel";
import {
  MAX_ROLLUP_ENTRIES,
  OTHER_KEY,
  ROLLUP_VERSION,
  TOOL_KINDS,
} from "../../../shared/src/constants";
import { addTokens, addTtft, emptyTokens, emptyTtft } from "../../../shared/src/metrics";
import type { KeyCount, Tokens, ToolCounts, Ttft } from "../../../shared/src/sync";

export type RollupModel = { key: string; effort?: string; tokens: Tokens; responses: number };
export type RollupKeyCount = { key: string; count: number };
export type RollupSkill = { key: string; count: number; sessions: number };
export type RollupProject = {
  key: string;
  tokens: number;
  responses: number;
  sessions: number;
  userMessages: number;
  linesAdded: number;
  linesRemoved: number;
};
export type RollupTokensSessions = { key: string; tokens: number; sessions: number };

export type RollupBody = {
  tokens: Tokens;
  responses: number;
  subagentTokens: Tokens;
  sessions: number;
  subagentSessions: number;
  turns: number;
  userMessages: number;
  agentMessages: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  compactions: number;
  activeMs: number;
  wallMs: number;
  ttft: Ttft;
  byHour: number[];
  byModel: RollupModel[];
  byTool: RollupKeyCount[];
  byMcpTool: RollupKeyCount[];
  bySkill: RollupSkill[];
  byProject: RollupProject[];
  byMachine: RollupTokensSessions[];
  bySource: RollupTokensSessions[];
};

/** A `dailyRollups` document without system fields. */
export type Rollup = RollupBody & {
  userId: Id<"users">;
  day: string;
  version: number;
  computedAt: number;
};

/** Subset of a tokenEvents document the rollup needs (a `Doc<"tokenEvents">` is assignable). */
export type EventInput = {
  hour: number;
  model: string;
  effort?: string;
  project: string;
  isSubagent: boolean;
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
};

/** Subset of a sessions document the rollup needs (a `Doc<"sessions">` is assignable). */
export type SessionInput = {
  machineId: string;
  project: string;
  source: string;
  isSubagent: boolean;
  turns: number;
  userMessages: number;
  agentMessages: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  compactions: number;
  activeMs: number;
  wallMs: number;
  ttft: Ttft;
  toolCounts: ToolCounts;
  mcpTools: KeyCount[];
  skills: KeyCount[];
  tokens: Tokens;
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Code-unit ordering by key, then effort — locale independent, hence byte-identical recomputes. */
export function compareEntries(
  a: { key: string; effort?: string },
  b: { key: string; effort?: string },
): number {
  return cmp(a.key, b.key) || cmp(a.effort ?? "", b.effort ?? "");
}

/**
 * Sorts entries by key and enforces MAX_ROLLUP_ENTRIES: when there are more, the highest-ranked
 * `MAX_ROLLUP_ENTRIES - 1` stay and the remainder is folded into one `OTHER_KEY` entry.
 */
export function capEntries<T extends { key: string; effort?: string }>(
  entries: T[],
  rank: (entry: T) => number,
  fold: (rest: T[]) => T,
): T[] {
  const sorted = [...entries].sort(compareEntries);
  if (sorted.length <= MAX_ROLLUP_ENTRIES) return sorted;
  const byRank = [...sorted].sort((a, b) => rank(b) - rank(a) || compareEntries(a, b));
  const keep = byRank.slice(0, MAX_ROLLUP_ENTRIES - 1);
  const rest = byRank.slice(MAX_ROLLUP_ENTRIES - 1);
  return [...keep, fold(rest)].sort(compareEntries);
}

export function emptyRollupBody(): RollupBody {
  return {
    tokens: emptyTokens(),
    responses: 0,
    subagentTokens: emptyTokens(),
    sessions: 0,
    subagentSessions: 0,
    turns: 0,
    userMessages: 0,
    agentMessages: 0,
    linesAdded: 0,
    linesRemoved: 0,
    filesChanged: 0,
    compactions: 0,
    activeMs: 0,
    wallMs: 0,
    ttft: emptyTtft(),
    byHour: new Array<number>(24).fill(0),
    byModel: [],
    byTool: TOOL_KINDS.map((key) => ({ key, count: 0 })).sort(compareEntries),
    byMcpTool: [],
    bySkill: [],
    byProject: [],
    byMachine: [],
    bySource: [],
  };
}

function eventTokens(event: EventInput): Tokens {
  return {
    input: event.input,
    cachedInput: event.cachedInput,
    cacheWrite: event.cacheWrite,
    output: event.output,
    reasoning: event.reasoning,
    total: event.total,
  };
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}

const foldModels = (rest: RollupModel[]): RollupModel => ({
  key: OTHER_KEY,
  tokens: rest.reduce((acc, m) => addTokens(acc, m.tokens), emptyTokens()),
  responses: sum(rest, (m) => m.responses),
});
const foldKeyCounts = (rest: RollupKeyCount[]): RollupKeyCount => ({
  key: OTHER_KEY,
  count: sum(rest, (e) => e.count),
});
const foldSkills = (rest: RollupSkill[]): RollupSkill => ({
  key: OTHER_KEY,
  count: sum(rest, (s) => s.count),
  sessions: sum(rest, (s) => s.sessions),
});
const foldProjects = (rest: RollupProject[]): RollupProject => ({
  key: OTHER_KEY,
  tokens: sum(rest, (p) => p.tokens),
  responses: sum(rest, (p) => p.responses),
  sessions: sum(rest, (p) => p.sessions),
  userMessages: sum(rest, (p) => p.userMessages),
  linesAdded: sum(rest, (p) => p.linesAdded),
  linesRemoved: sum(rest, (p) => p.linesRemoved),
});
const foldTokensSessions = (rest: RollupTokensSessions[]): RollupTokensSessions => ({
  key: OTHER_KEY,
  tokens: sum(rest, (e) => e.tokens),
  sessions: sum(rest, (e) => e.sessions),
});

/** Accumulates scalar counters and keyed maps; `finish()` turns the maps into capped sorted arrays. */
export class Collector {
  readonly body = emptyRollupBody();
  private readonly models = new Map<string, RollupModel>();
  private readonly tools = new Map<string, number>(TOOL_KINDS.map((kind) => [kind, 0]));
  private readonly mcpTools = new Map<string, number>();
  private readonly skills = new Map<string, RollupSkill>();
  private readonly projects = new Map<string, RollupProject>();
  private readonly machines = new Map<string, RollupTokensSessions>();
  private readonly sources = new Map<string, RollupTokensSessions>();

  addHour(hour: number, total: number): void {
    const index = Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 0;
    this.body.byHour[index] = (this.body.byHour[index] ?? 0) + total;
  }

  addModel(key: string, effort: string | undefined, tokens: Tokens, responses: number): void {
    const mapKey = JSON.stringify([key, effort ?? null]);
    const entry = this.models.get(mapKey) ?? {
      key,
      ...(effort !== undefined ? { effort } : {}),
      tokens: emptyTokens(),
      responses: 0,
    };
    entry.tokens = addTokens(entry.tokens, tokens);
    entry.responses += responses;
    this.models.set(mapKey, entry);
  }

  addTool(key: string, count: number): void {
    this.tools.set(key, (this.tools.get(key) ?? 0) + count);
  }

  addMcpTool(key: string, count: number): void {
    this.mcpTools.set(key, (this.mcpTools.get(key) ?? 0) + count);
  }

  addSkill(key: string, count: number, sessions: number): void {
    const entry = this.skills.get(key) ?? { key, count: 0, sessions: 0 };
    entry.count += count;
    entry.sessions += sessions;
    this.skills.set(key, entry);
  }

  addProject(key: string, delta: Partial<Omit<RollupProject, "key">>): void {
    const entry = this.projects.get(key) ?? {
      key,
      tokens: 0,
      responses: 0,
      sessions: 0,
      userMessages: 0,
      linesAdded: 0,
      linesRemoved: 0,
    };
    entry.tokens += delta.tokens ?? 0;
    entry.responses += delta.responses ?? 0;
    entry.sessions += delta.sessions ?? 0;
    entry.userMessages += delta.userMessages ?? 0;
    entry.linesAdded += delta.linesAdded ?? 0;
    entry.linesRemoved += delta.linesRemoved ?? 0;
    this.projects.set(key, entry);
  }

  addMachine(key: string, tokens: number, sessions: number): void {
    const entry = this.machines.get(key) ?? { key, tokens: 0, sessions: 0 };
    entry.tokens += tokens;
    entry.sessions += sessions;
    this.machines.set(key, entry);
  }

  addSource(key: string, tokens: number, sessions: number): void {
    const entry = this.sources.get(key) ?? { key, tokens: 0, sessions: 0 };
    entry.tokens += tokens;
    entry.sessions += sessions;
    this.sources.set(key, entry);
  }

  finish(): RollupBody {
    const body = this.body;
    body.byModel = capEntries([...this.models.values()], (m) => m.tokens.total, foldModels);
    body.byTool = [...this.tools].map(([key, count]) => ({ key, count })).sort(compareEntries);
    body.byMcpTool = capEntries(
      [...this.mcpTools].map(([key, count]) => ({ key, count })),
      (e) => e.count,
      foldKeyCounts,
    );
    body.bySkill = capEntries([...this.skills.values()], (s) => s.count, foldSkills);
    body.byProject = capEntries([...this.projects.values()], (p) => p.tokens, foldProjects);
    body.byMachine = capEntries([...this.machines.values()], (m) => m.tokens, foldTokensSessions);
    body.bySource = capEntries([...this.sources.values()], (s) => s.tokens, foldTokensSessions);
    return body;
  }
}

/** Pure, deterministic rollup of one (user, day): same inputs in any order → identical output. */
export function computeDayRollup(
  userId: Id<"users">,
  day: string,
  events: EventInput[],
  sessions: SessionInput[],
  computedAt: number,
): Rollup {
  const c = new Collector();
  const body = c.body;

  for (const event of events) {
    const tokens = eventTokens(event);
    body.tokens = addTokens(body.tokens, tokens);
    if (event.isSubagent) body.subagentTokens = addTokens(body.subagentTokens, tokens);
    body.responses += 1;
    c.addHour(event.hour, tokens.total);
    c.addModel(event.model, event.effort, tokens, 1);
    c.addProject(event.project, { tokens: tokens.total, responses: 1 });
  }

  for (const session of sessions) {
    // Both run BEFORE the sub-agent guard so a sub-agent's tokens still count — "sessions, turns
    // and messages exclude sub-agent threads; token totals and cost include them" (spec) — but the
    // session count passed is 0 for them, so these two rows use the same session convention as
    // `byProject` and `body.sessions`, which sit beside them on the same page.
    const sessionCount = session.isSubagent ? 0 : 1;
    c.addMachine(session.machineId, session.tokens.total, sessionCount);
    c.addSource(session.source, session.tokens.total, sessionCount);
    if (session.isSubagent) {
      body.subagentSessions += 1;
      continue;
    }
    body.sessions += 1;
    body.turns += session.turns;
    body.userMessages += session.userMessages;
    body.agentMessages += session.agentMessages;
    body.linesAdded += session.linesAdded;
    body.linesRemoved += session.linesRemoved;
    body.filesChanged += session.filesChanged;
    body.compactions += session.compactions;
    body.activeMs += session.activeMs;
    body.wallMs += session.wallMs;
    body.ttft = addTtft(body.ttft, session.ttft);
    for (const kind of TOOL_KINDS) c.addTool(kind, session.toolCounts[kind]);
    for (const entry of session.mcpTools) c.addMcpTool(entry.key, entry.count);
    for (const entry of session.skills) c.addSkill(entry.key, entry.count, 1);
    c.addProject(session.project, {
      sessions: 1,
      userMessages: session.userMessages,
      linesAdded: session.linesAdded,
      linesRemoved: session.linesRemoved,
    });
  }

  return { userId, day, version: ROLLUP_VERSION, computedAt, ...c.finish() };
}

/** A fold of several rollups (any users, any days). */
export type Aggregate = RollupBody & { days: number; activeDays: number };

/** A rollup body tagged with its calendar day (a `Doc<"dailyRollups">` and a `Rollup` both are). */
export type DayRollup = RollupBody & { day: string };

export function emptyAggregate(): Aggregate {
  return { ...emptyRollupBody(), days: 0, activeDays: 0 };
}

/**
 * Sums every counter, merges keyed arrays by key (and effort) and re-applies the 100-entry cap.
 * `days` counts the folded documents; `activeDays` counts the distinct calendar days that carry
 * data, so two users' rollups for the same day count as one active day.
 */
export function mergeRollups(rollups: DayRollup[]): Aggregate {
  const c = new Collector();
  const body = c.body;
  let days = 0;
  const activeDayKeys = new Set<string>();
  for (const r of rollups) {
    days += 1;
    if (r.tokens.total > 0 || r.sessions > 0) activeDayKeys.add(r.day);
    body.tokens = addTokens(body.tokens, r.tokens);
    body.subagentTokens = addTokens(body.subagentTokens, r.subagentTokens);
    body.responses += r.responses;
    body.sessions += r.sessions;
    body.subagentSessions += r.subagentSessions;
    body.turns += r.turns;
    body.userMessages += r.userMessages;
    body.agentMessages += r.agentMessages;
    body.linesAdded += r.linesAdded;
    body.linesRemoved += r.linesRemoved;
    body.filesChanged += r.filesChanged;
    body.compactions += r.compactions;
    body.activeMs += r.activeMs;
    body.wallMs += r.wallMs;
    body.ttft = addTtft(body.ttft, r.ttft);
    for (let hour = 0; hour < 24; hour++) c.addHour(hour, r.byHour[hour] ?? 0);
    for (const m of r.byModel) c.addModel(m.key, m.effort, m.tokens, m.responses);
    for (const t of r.byTool) c.addTool(t.key, t.count);
    for (const t of r.byMcpTool) c.addMcpTool(t.key, t.count);
    for (const s of r.bySkill) c.addSkill(s.key, s.count, s.sessions);
    for (const p of r.byProject) c.addProject(p.key, p);
    for (const m of r.byMachine) c.addMachine(m.key, m.tokens, m.sessions);
    for (const s of r.bySource) c.addSource(s.key, s.tokens, s.sessions);
  }
  return { ...c.finish(), days, activeDays: activeDayKeys.size };
}
