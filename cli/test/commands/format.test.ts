import { describe, expect, it } from "vitest";
import { formatSyncReport } from "../../src/commands/format";
import type { SyncReport } from "../../src/commands/sync";

const report: SyncReport = {
  ok: false,
  exitCode: 1,
  dryRun: true,
  loggedIn: true,
  durationMs: 42,
  homes: [{ path: "/h/.codex", exists: true, files: 2 }],
  files: [
    {
      sessionId: "a",
      name: "rollout-a.jsonl",
      action: "parsed",
      newEvents: 3,
      summaryChanged: true,
    },
    {
      sessionId: "b",
      name: "rollout-b.jsonl",
      action: "unchanged",
      newEvents: 0,
      summaryChanged: false,
    },
    {
      sessionId: "c",
      name: "rollout-c.jsonl",
      action: "error",
      reason: "boom",
      newEvents: 0,
      summaryChanged: false,
    },
  ],
  uploads: { sessions: 1, events: 3, requests: 1 },
  accepted: null,
  conflicts: null,
  heartbeat: false,
  latestCliVersion: null,
  rateLimit: null,
  warnings: ["careful"],
  errors: ["boom"],
};

describe("formatSyncReport", () => {
  it("lists per-file actions, warnings, errors and the dry-run notice", () => {
    const lines = formatSyncReport(report);
    expect(lines[0]).toContain("/h/.codex (2 rollout files)");
    expect(lines).toContain("parsed    rollout-a.jsonl (+3 events, summary)");
    expect(lines).toContain("error     rollout-c.jsonl — boom");
    expect(lines.some((l) => l.startsWith("warning: careful"))).toBe(true);
    expect(lines.some((l) => l.startsWith("error: boom"))).toBe(true);
    expect(lines.some((l) => l.includes("dry run"))).toBe(true);
    expect(lines.some((l) => l.startsWith("sync failed:"))).toBe(true);
    const quiet = formatSyncReport({
      ...report,
      dryRun: false,
      ok: true,
      exitCode: 0,
      errors: [],
      warnings: [],
      files: [],
    });
    expect(quiet.some((l) => l.includes("dry run"))).toBe(false);
  });
});
