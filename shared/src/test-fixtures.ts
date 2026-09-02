import type { MachineInfo, SessionSummary, SyncBatch, TokenEvent } from "./sync";

const T0 = Date.UTC(2026, 7, 30, 17, 0, 0); // 2026-08-30T17:00:00Z

export function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "0199a1b2-0000-7000-8000-000000000001",
    threadId: "0199a1b2-0000-7000-8000-000000000001",
    startedAt: T0,
    endedAt: T0 + 600_000,
    wallMs: 600_000,
    day: "2026-08-30",
    timezone: "America/Los_Angeles",
    project: "project-a",
    gitBranch: "main",
    originator: "codex-tui",
    source: "cli",
    isSubagent: false,
    model: "gpt-5.6-sol",
    effort: "xhigh",
    cliVersion: "0.150.1",
    turns: 2,
    completedTurns: 2,
    userMessages: 2,
    agentMessages: 3,
    reasoningItems: 5,
    toolCounts: {
      commandRead: 3, commandList: 1, commandSearch: 1, commandOther: 2, fileChange: 1,
      webSearch: 1, imageView: 0, mcpTool: 0, other: 0,
    },
    mcpTools: [],
    skills: [{ key: "openai-docs", count: 1 }],
    linesAdded: 12,
    linesRemoved: 3,
    filesChanged: 1,
    compactions: 0,
    activeMs: 120_000,
    ttft: { count: 2, sumMs: 3000, hist: [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    tokens: { input: 100_000, cachedInput: 80_000, cacheWrite: 0, output: 2_000, reasoning: 800, total: 102_000 },
    responses: 4,
    eventOrigin: "record",
    inProgress: false,
    lineCount: 40,
    generation: 0,
    parseErrors: 0,
    parserVersion: 1,
    summaryHash: "0123456789abcdef0123456789abcdef01234567",
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<TokenEvent> = {}): TokenEvent {
  return {
    sessionId: "0199a1b2-0000-7000-8000-000000000001",
    seq: 10,
    ts: T0 + 5_000,
    day: "2026-08-30",
    hour: 10,
    model: "gpt-5.6-sol",
    effort: "xhigh",
    turnId: "turn-1",
    project: "project-a",
    isSubagent: false,
    origin: "record",
    input: 25_000,
    cachedInput: 20_000,
    cacheWrite: 0,
    output: 500,
    reasoning: 200,
    total: 25_500,
    contextWindow: 272_000,
    ...overrides,
  };
}

export function makeMachine(overrides: Partial<MachineInfo> = {}): MachineInfo {
  return {
    machineId: "4d2f7d0e-2d5c-4c0d-9a9c-8e3f0c9b1a11",
    label: "brisk-otter",
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "24.17.0",
    codexVersion: "0.150.1",
    codexLatestVersion: "0.150.1",
    hostname: null,
    tz: "America/Los_Angeles",
    ...overrides,
  };
}

export function makeBatch(overrides: Partial<SyncBatch> = {}): SyncBatch {
  return {
    schemaVersion: 1,
    parserVersion: 1,
    cliVersion: "0.1.0",
    batchId: "7a0b1c2d-1111-4222-8333-444455556666",
    sentAt: T0 + 900_000,
    machine: makeMachine(),
    sessions: [makeSummary()],
    tokenEvents: [makeEvent()],
    ...overrides,
  };
}
