/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { MachineInfo, SessionSummary, SyncBatch, TokenEvent } from "../../shared/src/sync";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { computeDayRollup, type EventInput, type SessionInput } from "./lib/aggregate";
import { sha256Hex, tokenPrefix } from "./lib/hash";
import schema from "./schema";

// Every module under convex/ (tests included; convex-test only loads what a function reference needs).
export const modules = import.meta.glob("./**/*.*s");

export function setup() {
  return convexTest(schema, modules);
}
export type Harness = ReturnType<typeof setup>;

export const IDENTITIES = {
  alice: {
    subject: "user_alice",
    tokenIdentifier: "https://clerk.example|user_alice",
    name: "Alice",
    email: "alice@example.com",
  },
  bob: {
    subject: "user_bob",
    tokenIdentifier: "https://clerk.example|user_bob",
    name: "Bob",
    email: "bob@example.com",
  },
} as const;
export type Who = keyof typeof IDENTITIES;

/** A harness acting as the given Clerk identity. */
export function withUser(t: Harness, who: Who) {
  return t.withIdentity(IDENTITIES[who]);
}

export async function registerUser(t: Harness, who: Who): Promise<Id<"users">> {
  return await withUser(t, who).mutation(api.users.ensure, {});
}

export const RAW_TOKENS = {
  alice: "ck_alice0000000000000000000000000000000000000",
  bob: "ck_bob000000000000000000000000000000000000000",
} as const;

/** Inserts a sync token row for `raw` (the server only ever sees its sha256). */
export async function createToken(
  t: Harness,
  userId: Id<"users">,
  raw: string,
  name = "test",
): Promise<Id<"syncTokens">> {
  const tokenHash = await sha256Hex(raw);
  return await t.run(async (ctx) =>
    ctx.db.insert("syncTokens", {
      userId,
      tokenHash,
      prefix: tokenPrefix(raw),
      name,
      createdAt: 1_756_000_000_000,
    }),
  );
}

export async function userWithToken(t: Harness, who: Who) {
  const userId = await registerUser(t, who);
  const raw = RAW_TOKENS[who];
  const tokenId = await createToken(t, userId, raw);
  return { userId, raw, tokenId };
}

/** 2026-08-31T09:00:00Z */
export const T0 = Date.UTC(2026, 7, 31, 9, 0, 0);

export const ZERO_TOOLS = {
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

export function makeMachine(overrides: Partial<MachineInfo> = {}): MachineInfo {
  return {
    machineId: "machine-1",
    label: "brisk-otter",
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "24.17.0",
    codexVersion: "0.150.1",
    codexLatestVersion: "0.150.1",
    hostname: null,
    tz: "UTC",
    ...overrides,
  };
}

export function makeSession(
  overrides: Partial<SessionSummary> & { sessionId: string },
): SessionSummary {
  return {
    threadId: overrides.sessionId,
    startedAt: T0,
    endedAt: T0 + 3_600_000,
    wallMs: 3_600_000,
    day: "2026-08-31",
    timezone: "UTC",
    project: "project-a",
    originator: "codex-tui",
    source: "cli",
    isSubagent: false,
    model: "gpt-5.6-sol",
    effort: "medium",
    cliVersion: "0.150.1",
    turns: 2,
    completedTurns: 2,
    userMessages: 2,
    agentMessages: 2,
    reasoningItems: 1,
    toolCounts: { ...ZERO_TOOLS, commandRead: 3 },
    mcpTools: [],
    skills: [],
    linesAdded: 10,
    linesRemoved: 2,
    filesChanged: 1,
    compactions: 0,
    activeMs: 600_000,
    ttft: { count: 2, sumMs: 1500, hist: [0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    tokens: { input: 1000, cachedInput: 400, cacheWrite: 0, output: 200, reasoning: 50, total: 1200 },
    responses: 2,
    eventOrigin: "record",
    inProgress: false,
    lineCount: 40,
    generation: 0,
    parseErrors: 0,
    parserVersion: 1,
    summaryHash: "a".repeat(40),
    ...overrides,
  };
}

export function makeEvent(
  overrides: Partial<TokenEvent> & { sessionId: string; seq: number },
): TokenEvent {
  return {
    ts: T0 + 60_000,
    day: "2026-08-31",
    hour: 9,
    model: "gpt-5.6-sol",
    effort: "medium",
    project: "project-a",
    source: "cli",
    isSubagent: false,
    origin: "record",
    input: 500,
    cachedInput: 200,
    cacheWrite: 0,
    output: 100,
    reasoning: 25,
    total: 600,
    ...overrides,
  };
}

export function makeBatch(overrides: Partial<SyncBatch> = {}): SyncBatch {
  return {
    schemaVersion: 1,
    parserVersion: 1,
    cliVersion: "0.1.0-test",
    batchId: "batch-1",
    sentAt: T0 + 3_600_000,
    machine: makeMachine(),
    sessions: [],
    tokenEvents: [],
    ...overrides,
  };
}

/** POSTs to /api/v1/sync; `raw === null` sends no Authorization header; a string body is sent verbatim. */
export async function postSync(t: Harness, raw: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (raw !== null) headers.authorization = `Bearer ${raw}`;
  const response = await t.fetch("/api/v1/sync", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await response.json();
  return { status: response.status, json, headers: response.headers };
}

export async function getRollup(t: Harness, userId: Id<"users">, day: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("dailyRollups")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
      .unique(),
  );
}

/** Inserts a rollup computed from raw inputs, bypassing ingest (for stats tests). */
export async function seedRollup(
  t: Harness,
  userId: Id<"users">,
  day: string,
  events: EventInput[],
  sessions: SessionInput[],
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("dailyRollups", computeDayRollup(userId, day, events, sessions, T0));
  });
}
