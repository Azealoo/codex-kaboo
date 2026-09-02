import { describe, expect, it } from "vitest";
import { SessionSummary, TokenEvent } from "@codex-kaboo/shared/sync";
import { discoverRolloutFiles, type DiscoveredFile } from "../src/core/discover";
import { zstdSupported } from "../src/core/jsonl-reader";
import { parseRolloutFile } from "../src/core/parse-file";
import { FIXTURE_HOME, FX } from "./fixture-ids";

const NOW = Date.UTC(2026, 8, 1, 12);

async function files(): Promise<Map<string, DiscoveredFile>> {
  const result = await discoverRolloutFiles([FIXTURE_HOME]);
  return new Map(result.files.map((f) => [f.sessionId, f]));
}

async function parse(sessionId: string) {
  const file = (await files()).get(sessionId);
  if (!file) throw new Error(`fixture ${sessionId} not found`);
  return parseRolloutFile(file, { machineId: "machine-1", machineZone: "UTC", now: NOW, generation: 0 });
}

describe("fixtures", () => {
  it("discovers every fixture file", async () => {
    const all = await files();
    const expected = [FX.paginatedCli, FX.execCompaction, FX.legacySubagent, FX.paginatedSmall, FX.partial, FX.corrupt, FX.future, `${FX.corrupt}_${FX.forkedRollout}`];
    if (zstdSupported()) expected.push(FX.zst);
    for (const id of expected) expect(all.has(id), id).toBe(true);
  });
  it("parses the small paginated CLI session (smoke reference)", async () => {
    const { parsed, read } = await parse(FX.paginatedSmall);
    expect(read).toMatchObject({ lines: 159, partial: false });
    const s = parsed.summary;
    expect(SessionSummary.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({
      sessionId: FX.paginatedSmall, threadId: FX.paginatedSmall, project: "project-a", source: "cli", originator: "codex-tui",
      isSubagent: false, model: "gpt-5.6-sol", effort: "xhigh", cliVersion: "0.150.1", turns: 1, completedTurns: 1,
      userMessages: 1, agentMessages: 4, reasoningItems: 26, filesChanged: 1, linesAdded: 4, linesRemoved: 0,
      compactions: 0, activeMs: 258435, responses: 23, lineCount: 159, parseErrors: 0, wallMs: 739002,
      skills: [{ key: "skill-1", count: 1 }], mcpTools: [],
    });
    expect(s.gitBranch).toBeDefined();
    expect(s.toolCounts).toEqual({ commandRead: 1, commandList: 1, commandSearch: 2, commandOther: 6, fileChange: 1, webSearch: 11, imageView: 0, mcpTool: 0, other: 0 });
    expect(s.tokens).toEqual({ input: 1437354, cachedInput: 1344768, cacheWrite: 0, output: 6554, reasoning: 3999, total: 1443908 });
    expect(s.ttft).toMatchObject({ count: 1, sumMs: 4200 });
    expect(parsed.events).toHaveLength(23);
    expect(parsed.events.every((e) => TokenEvent.safeParse(e).success && e.model === "gpt-5.6-sol" && e.effort === "xhigh")).toBe(true);
    expect(parsed.rateLimit).not.toBeNull();
    expect(parsed.rateLimit?.windowMinutes).toBe(10080);
  });
  it("parses the large paginated CLI session with file changes, images and skills", async () => {
    const { parsed } = await parse(FX.paginatedCli);
    const s = parsed.summary;
    expect(s).toMatchObject({
      turns: 2, completedTurns: 2, userMessages: 1, agentMessages: 8, reasoningItems: 144, filesChanged: 60,
      linesAdded: 5287, linesRemoved: 269, compactions: 0, activeMs: 2785597, responses: 127, lineCount: 805, wallMs: 2900244,
      skills: [{ key: "skill-1", count: 3 }], source: "cli", originator: "codex-tui",
    });
    expect(s.gitBranch).toBeUndefined();
    expect(s.toolCounts).toEqual({ commandRead: 13, commandList: 0, commandSearch: 3, commandOther: 51, fileChange: 40, webSearch: 2, imageView: 4, mcpTool: 0, other: 0 });
    expect(s.tokens).toMatchObject({ input: 15813051, cachedInput: 15555200, output: 117860, reasoning: 20997 });
    expect(s.ttft).toMatchObject({ count: 2, sumMs: 14647 });
  });
  it("parses the exec session with two compactions", async () => {
    const { parsed } = await parse(FX.execCompaction);
    const s = parsed.summary;
    expect(s).toMatchObject({
      source: "exec", originator: "codex_exec", turns: 1, completedTurns: 1, userMessages: 1, agentMessages: 9, reasoningItems: 100,
      compactions: 2, activeMs: 1371829, responses: 86, lineCount: 575, skills: [], filesChanged: 0,
    });
    expect(s.toolCounts).toMatchObject({ commandRead: 195, commandList: 5, commandSearch: 14, commandOther: 6, webSearch: 0 });
    expect(s.tokens).toMatchObject({ input: 9504671, cachedInput: 8902144, output: 49444, reasoning: 19688 });
    expect(s.ttft).toMatchObject({ count: 1, sumMs: 6911 });
  });
  it("parses the legacy sub-agent file (no ordinals, event_msg messages)", async () => {
    const { parsed } = await parse(FX.legacySubagent);
    const s = parsed.summary;
    expect(s).toMatchObject({
      sessionId: FX.legacySubagent, parentThreadId: FX.parent, isSubagent: true, source: "subagent:guardian", originator: "codex_exec",
      model: "codex-auto-review", effort: "low", turns: 1, completedTurns: 1, userMessages: 1, agentMessages: 1, responses: 1,
      lineCount: 13, activeMs: 6033, wallMs: 790007,
    });
    expect(s.tokens).toEqual({ input: 7600, cachedInput: 4864, cacheWrite: 0, output: 273, reasoning: 215, total: 7873 });
    expect(s.ttft).toMatchObject({ count: 1, sumMs: 5040 });
    expect(parsed.events[0]).toMatchObject({ isSubagent: true, model: "codex-auto-review", effort: "low" });
  });
  it("ignores a trailing partial line and counts a corrupt line", async () => {
    const partial = await parse(FX.partial);
    expect(partial.read).toMatchObject({ lines: 4, partial: true });
    expect(partial.parsed.summary).toMatchObject({ responses: 1, turns: 1, completedTurns: 0, inProgress: true, lineCount: 4, parseErrors: 0 });
    expect(partial.parsed.rateLimit?.usedPercent).toBe(42.5);
    const corrupt = await parse(FX.corrupt);
    expect(corrupt.parsed.summary).toMatchObject({ lineCount: 6, parseErrors: 1, responses: 1, turns: 1, completedTurns: 1, activeMs: 1500, model: "gpt-5.6-luna", timezone: "Asia/Tokyo" });
    expect(corrupt.parsed.summary.ttft).toMatchObject({ count: 1, sumMs: 700 });
  });
  it("tolerates future wire types and prefers token_usage_record", async () => {
    const { parsed } = await parse(FX.future);
    expect(parsed.summary).toMatchObject({ source: "vscode", model: "gpt-5.7-future", responses: 1, mcpTools: [{ key: "context7/query-docs", count: 1 }] });
    expect(parsed.summary.toolCounts).toMatchObject({ mcpTool: 1, other: 1 });
    expect(parsed.summary.tokens).toMatchObject({ input: 300, cachedInput: 100, output: 20, reasoning: 5, total: 320 });
    // This file really carries both: token_count 1008 at seq 4, then token_usage_record 320 at
    // seq 5. A parse truncated at seq 4 ships the count row, so the wire has to say which
    // mechanism each row came from for the server to retract it later.
    expect(parsed.summary.eventOrigin).toBe("record");
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ seq: 5, origin: "record", machineId: "machine-1", source: "vscode", total: 320 });
    expect(parsed.diagnostics.unknownTypes).toMatchObject({ world_state: 1, inter_agent_communication: 1 });
    expect(parsed.diagnostics.mcpFallbackUsed).toBe(false);
  });
  it("derives the session id of a forked rollout from the filename", async () => {
    const forked = await parse(`${FX.corrupt}_${FX.forkedRollout}`);
    expect(forked.parsed.summary.sessionId).toBe(`${FX.corrupt}_${FX.forkedRollout}`);
    expect(forked.parsed.summary.threadId).toBe(FX.corrupt);
    expect(forked.parsed.events[0]?.sessionId).toBe(`${FX.corrupt}_${FX.forkedRollout}`);
  });
  it.skipIf(!zstdSupported())("parses the zstd-compressed archived session", async () => {
    const { parsed, read } = await parse(FX.zst);
    expect(read.tail).toBe("");
    expect(parsed.summary).toMatchObject({ sessionId: FX.zst, source: "exec", responses: 1, lineCount: 4 });
  });
});
