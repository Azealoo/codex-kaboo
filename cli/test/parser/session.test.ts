import { describe, expect, it } from "vitest";
import { SessionSummary, TokenEvent } from "@codex-kaboo/shared/sync";
import { createReducerState, finalize, reduceLine, type ReducerContext } from "../../src/parser/session";

const TID = "0199a1b2-0000-7000-8000-000000000001";
const T = (s: number): string => new Date(Date.UTC(2026, 7, 30, 17, 0, s)).toISOString();
const SEC = (s: number): number => Math.floor(Date.UTC(2026, 7, 30, 17, 0, s) / 1000);
const line = (type: string, payload: unknown, ts: string, ordinal?: number): string =>
  JSON.stringify(ordinal === undefined ? { timestamp: ts, type, payload } : { timestamp: ts, ordinal, type, payload });

const usage = (input: number, cached: number, output: number, reasoning: number) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output,
  reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const rateLimits = (used: number) => ({
  primary: { used_percent: used, window_minutes: 10080, resets_at: SEC(600) }, secondary: null, plan_type: "pro", limit_id: "weekly",
});
const meta = (extra: Record<string, unknown> = {}) => ({
  id: TID, timestamp: T(0), cwd: "/redacted/project-a", originator: "codex-tui", source: "cli", cli_version: "0.150.1",
  git: { branch: "main", repository_url: "https://example.invalid/r.git", commit_hash: "abc" },
  base_instructions: { text: "SECRET", provenance: { type: "model", model: "gpt-5.6-sol" } }, history_mode: "paginated", ...extra,
});

function ctx(overrides: Partial<ReducerContext> = {}): ReducerContext {
  return { sessionId: TID, threadId: TID, rolloutId: null, fileTimestampMs: Date.UTC(2026, 7, 30, 17), machineZone: "UTC", ...overrides };
}

function run(lines: string[], c = ctx(), opts = { now: Date.UTC(2026, 7, 30, 18), generation: 0 }) {
  const state = createReducerState(c);
  lines.forEach((text, seq) => reduceLine(state, seq, text));
  return finalize(state, opts);
}

const twoTurns = [
  line("session_meta", meta(), T(0), 0),
  line("event_msg", { type: "task_started", turn_id: "t1", started_at: SEC(1), model_context_window: 272000 }, T(1), 1),
  line("turn_context", { turn_id: "t1", model: "gpt-5.6-sol", effort: "xhigh", timezone: "Asia/Tokyo", collaboration_mode: { mode: "default", settings: { developer_instructions: "SECRET" } } }, T(1), 2),
  line("event_msg", { type: "token_count", info: { last_token_usage: usage(1000, 600, 100, 40), model_context_window: 272000 }, rate_limits: rateLimits(10) }, T(2), 3),
  line("event_msg", { type: "token_count", info: { last_token_usage: usage(2000, 1500, 50, 10) }, rate_limits: rateLimits(11) }, T(3), 4),
  line("event_msg", { type: "task_complete", turn_id: "t1", started_at: SEC(1), completed_at: SEC(5), duration_ms: 4000, time_to_first_token_ms: 1200, last_agent_message: "SECRET" }, T(5), 5),
  line("event_msg", { type: "task_started", turn_id: "t2", started_at: SEC(10) }, T(10), 6),
  line("turn_context", { turn_id: "t2", model: "gpt-5.6-luna", effort: "low", timezone: "Asia/Tokyo" }, T(10), 7),
  line("event_msg", { type: "token_count", info: { last_token_usage: usage(500, 0, 20, 0) }, rate_limits: null }, T(11), 8),
  line("event_msg", { type: "task_complete", turn_id: "t2", started_at: SEC(10), completed_at: SEC(13), duration_ms: null, time_to_first_token_ms: null }, T(13), 9),
];

describe("reducer: sessions, turns and token events", () => {
  it("builds a valid summary and per-response events joined by turn id", () => {
    const parsed = run(twoTurns);
    const s = parsed.summary;
    expect(SessionSummary.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({
      sessionId: TID, threadId: TID, project: "project-a", gitBranch: "main", originator: "codex-tui", source: "cli",
      isSubagent: false, cliVersion: "0.150.1", model: "gpt-5.6-luna", effort: "low", timezone: "Asia/Tokyo",
      turns: 2, completedTurns: 2, activeMs: 7000, responses: 3, lineCount: 10, parseErrors: 0, parserVersion: 1,
      inProgress: false, generation: 0, compactions: 0,
    });
    expect(s.startedAt).toBe(Date.UTC(2026, 7, 30, 17, 0, 0));
    expect(s.endedAt).toBe(Date.UTC(2026, 7, 30, 17, 0, 13));
    expect(s.wallMs).toBe(13000);
    expect(s.day).toBe("2026-08-31"); // 17:00Z = 02:00 next day in Tokyo
    expect(s.tokens).toEqual({ input: 3500, cachedInput: 2100, cacheWrite: 0, output: 170, reasoning: 50, total: 3670 });
    expect(s.ttft).toEqual({ count: 1, sumMs: 1200, hist: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(s.summaryHash).toMatch(/^[0-9a-f]{40}$/);
    expect(parsed.events.every((e) => TokenEvent.safeParse(e).success)).toBe(true);
    expect(parsed.events.map((e) => [e.seq, e.model, e.effort, e.turnId, e.hour, e.day, e.total])).toEqual([
      [3, "gpt-5.6-sol", "xhigh", "t1", 2, "2026-08-31", 1100],
      [4, "gpt-5.6-sol", "xhigh", "t1", 2, "2026-08-31", 2050],
      [8, "gpt-5.6-luna", "low", "t2", 2, "2026-08-31", 520],
    ]);
    expect(parsed.events[0]).toMatchObject({ sessionId: TID, project: "project-a", isSubagent: false, contextWindow: 272000, input: 1000, cachedInput: 600, output: 100, reasoning: 40 });
    expect(parsed.rateLimit).toEqual({ observedAt: Date.UTC(2026, 7, 30, 17, 0, 3), usedPercent: 11, windowMinutes: 10080, resetsAt: SEC(600) * 1000, planType: "pro", limitId: "weekly" });
    expect(parsed.diagnostics.zone).toBe("Asia/Tokyo");
    expect(JSON.stringify(parsed)).not.toContain("SECRET");
    expect(JSON.stringify(parsed)).not.toContain("/redacted");
  });
  it("keeps the hash stable across generation but not across token changes", () => {
    const a = run(twoTurns);
    const b = run(twoTurns, ctx(), { now: Date.UTC(2026, 7, 30, 18), generation: 5 });
    expect(b.summary.inProgress).toBe(false); // both turns completed; `inProgress` is structural — file mtime is never consulted
    expect(b.summary.generation).toBe(5);
    expect(b.summary.summaryHash).toBe(a.summary.summaryHash);
    const c = run([...twoTurns, line("event_msg", { type: "token_count", info: { last_token_usage: usage(1, 0, 1, 0) }, rate_limits: null }, T(14), 10)]);
    expect(c.summary.summaryHash).not.toBe(a.summary.summaryHash);
  });
  it("skips all-zero and null usage, counts parse errors and unknown types", () => {
    const parsed = run([
      line("session_meta", meta(), T(0), 0),
      "{this is not json",
      line("event_msg", { type: "token_count", info: { last_token_usage: usage(0, 0, 0, 0) }, rate_limits: null }, T(1), 2),
      line("event_msg", { type: "token_count", info: null, rate_limits: null }, T(2), 3),
      line("world_state", { anything: "SECRET" }, T(3), 4),
      line("event_msg", { type: "thread_settings_applied" }, T(4), 5),
    ]);
    expect(parsed.summary.parseErrors).toBe(1);
    expect(parsed.summary.lineCount).toBe(6);
    expect(parsed.events).toEqual([]);
    expect(parsed.summary.responses).toBe(0);
    expect(parsed.diagnostics.unknownTypes).toEqual({ world_state: 1, "event_msg/thread_settings_applied": 1 });
    expect(parsed.summary.model).toBe("gpt-5.6-sol"); // provenance fallback
  });
  it("prefers token_usage_record events over token_count when present", () => {
    const parsed = run([
      line("session_meta", meta(), T(0), 0),
      line("event_msg", { type: "task_started", turn_id: "t1", started_at: SEC(1) }, T(1), 1),
      line("turn_context", { turn_id: "t1", model: "gpt-5.6-sol", effort: "medium", timezone: "UTC" }, T(1), 2),
      line("event_msg", { type: "token_count", info: { last_token_usage: usage(1000, 0, 10, 0) }, rate_limits: null }, T(2), 3),
      line("token_usage_record", { turn_id: "t1", usage: usage(1000, 0, 10, 0) }, T(2), 4),
    ]);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ seq: 4, model: "gpt-5.6-sol", effort: "medium", total: 1010 });
  });
  it("handles sub-agent metadata, missing zones and open turns", () => {
    const parsed = run(
      [
        line("session_meta", meta({ source: { subagent: { other: "guardian" } }, parent_thread_id: "0199a1b2-0000-7000-8000-00000000ffff", git: undefined, base_instructions: { text: "x", provenance: { type: "custom" } } }), T(0)),
        line("event_msg", { type: "task_started", turn_id: "t1", started_at: SEC(1) }, T(1)),
        line("event_msg", { type: "token_count", info: { last_token_usage: usage(100, 50, 10, 5) }, rate_limits: null }, T(2)),
      ],
      ctx({ machineZone: "America/Los_Angeles" }),
    );
    expect(parsed.summary).toMatchObject({ source: "subagent:guardian", isSubagent: true, parentThreadId: "0199a1b2-0000-7000-8000-00000000ffff", model: "(unknown)", inProgress: true, timezone: "America/Los_Angeles", day: "2026-08-30" });
    expect(parsed.summary.gitBranch).toBeUndefined();
    expect(parsed.events[0]).toMatchObject({ model: "(unknown)", isSubagent: true, hour: 10, day: "2026-08-30" });
    expect(parsed.events[0]?.effort).toBeUndefined();
  });
  it("falls back to the first line timestamp, then the filename timestamp, for startedAt", () => {
    const noMeta = run([line("event_msg", { type: "task_started", turn_id: "t1", started_at: SEC(7) }, T(7))]);
    expect(noMeta.summary.startedAt).toBe(Date.UTC(2026, 7, 30, 17, 0, 7));
    const empty = run([]);
    expect(empty.summary.startedAt).toBe(Date.UTC(2026, 7, 30, 17));
    expect(empty.summary.wallMs).toBe(0);
    expect(empty.summary.project).toBe("(unknown)");
    expect(SessionSummary.safeParse(empty.summary).success).toBe(true);
  });
});
