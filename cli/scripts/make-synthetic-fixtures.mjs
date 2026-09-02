#!/usr/bin/env node
// Writes the hand-made fixture sessions (partial trailing line, corrupt line, future types, forked
// filename, zstd-compressed archive) under cli/test/fixtures/codex-home. Deterministic; safe to re-run.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../test/fixtures/codex-home", import.meta.url));
const B1 = "0199f1c0-0000-7000-8000-0000000000b1"; // partial trailing line
const B2 = "0199f1c0-0000-7000-8000-0000000000b2"; // corrupt line (also the forked thread)
const B3 = "0199f1c0-0000-7000-8000-0000000000b3"; // future wire types
const B4 = "0199f1c0-0000-7000-8000-0000000000b4"; // zstd archive
const C1 = "0199f1c0-0000-7000-8000-0000000000c1"; // rollout id of the fork

const at = (y, mo, d, h, mi, s, ms = 0) => Date.UTC(y, mo - 1, d, h, mi, s, ms);
const iso = (t) => new Date(t).toISOString();
const line = (t, type, payload, ordinal) =>
  JSON.stringify(ordinal === undefined ? { timestamp: iso(t), type, payload } : { timestamp: iso(t), ordinal, type, payload });
const usage = (input, cached, output, reasoning) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output,
  reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const meta = (t, id, extra = {}) => ({
  id, timestamp: iso(t), cwd: "/redacted/project-c", originator: "codex-tui", source: "cli", cli_version: "0.150.1",
  history_mode: "paginated", git: { branch: "main" },
  base_instructions: { text: "<r:10>", provenance: { type: "model", model: "gpt-5.6-sol" } }, ...extra,
});
const rateLimits = (used, t) => ({
  primary: { used_percent: used, window_minutes: 10080, resets_at: Math.floor(t / 1000) + 86400 }, secondary: null,
  plan_type: "pro", limit_id: "weekly",
});

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`${rel}: ${Buffer.byteLength(content)} bytes`);
}

// 1. Partial trailing line: four complete lines, then an unterminated fifth line.
{
  const t0 = at(2026, 8, 30, 20, 0, 0);
  const lines = [
    line(t0, "session_meta", meta(t0, B1), 0),
    line(t0 + 1000, "event_msg", { type: "task_started", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1, model_context_window: 272000 }, 1),
    line(t0 + 1500, "turn_context", { turn_id: "t1", model: "gpt-5.6-sol", effort: "medium", timezone: "UTC", collaboration_mode: { mode: "default" } }, 2),
    line(t0 + 2000, "event_msg", { type: "token_count", info: { last_token_usage: usage(1200, 1000, 30, 10), model_context_window: 272000 }, rate_limits: rateLimits(42.5, t0) }, 3),
  ];
  write(`sessions/2026/08/30/rollout-2026-08-30T20-00-00-${B1}.jsonl`, `${lines.join("\n")}\n{"timestamp":"${iso(t0 + 3000)}","ordinal":4,"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50`);
}

// 2. Corrupt line in the middle (counted, skipped) — reused for the forked file.
const corruptLines = (id, t0) => [
  line(t0, "session_meta", meta(t0, id), 0),
  line(t0 + 1000, "event_msg", { type: "task_started", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1 }, 1),
  line(t0 + 1500, "turn_context", { turn_id: "t1", model: "gpt-5.6-luna", effort: "low", timezone: "Asia/Tokyo" }, 2),
  "{not json at all",
  line(t0 + 2000, "event_msg", { type: "token_count", info: { last_token_usage: usage(100, 40, 10, 5) }, rate_limits: rateLimits(50, t0) }, 4),
  line(t0 + 3000, "event_msg", { type: "task_complete", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1, completed_at: Math.floor(t0 / 1000) + 3, duration_ms: 1500, time_to_first_token_ms: 700 }, 5),
];
write(`sessions/2026/08/30/rollout-2026-08-30T21-00-00-${B2}.jsonl`, `${corruptLines(B2, at(2026, 8, 30, 21, 0, 0)).join("\n")}\n`);
write(`sessions/2026/08/31/rollout-2026-08-31T09-00-00-${B2}_${C1}.jsonl`, `${corruptLines(B2, at(2026, 8, 31, 9, 0, 0)).join("\n")}\n`);

// 3. Future wire types: world_state, token_usage_record (wins over token_count), McpToolCall, unknown item and type.
{
  const t0 = at(2026, 8, 30, 22, 0, 0);
  const lines = [
    line(t0, "session_meta", meta(t0, B3, { source: "vscode", originator: "codex-vscode" }), 0),
    line(t0 + 500, "world_state", { redacted: true }, 1),
    line(t0 + 1000, "event_msg", { type: "task_started", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1 }, 2),
    line(t0 + 1500, "turn_context", { turn_id: "t1", model: "gpt-5.7-future", effort: "high", timezone: "Europe/Berlin" }, 3),
    line(t0 + 2000, "event_msg", { type: "token_count", info: { last_token_usage: usage(999, 0, 9, 0) }, rate_limits: null }, 4),
    line(t0 + 2000, "token_usage_record", { turn_id: "t1", usage: usage(300, 100, 20, 5) }, 5),
    line(t0 + 2500, "event_msg", { type: "item_completed", item: { type: "McpToolCall", id: "m1", server: "context7", tool: "query-docs", arguments: { redacted: true } } }, 6),
    line(t0 + 2600, "event_msg", { type: "item_completed", item: { type: "Plan", id: "p1", text: "<r:5>" } }, 7),
    line(t0 + 2700, "response_item", { type: "function_call", name: "mcp__github__list_issues", arguments: "{}", call_id: "c1" }, 8),
    line(t0 + 2800, "inter_agent_communication", { redacted: true }, 9),
    line(t0 + 3000, "event_msg", { type: "task_complete", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1, completed_at: Math.floor(t0 / 1000) + 3, duration_ms: 2000, time_to_first_token_ms: 400 }, 10),
  ];
  write(`sessions/2026/08/30/rollout-2026-08-30T22-00-00-${B3}.jsonl`, `${lines.join("\n")}\n`);
}

// 4. zstd-compressed archived session (only when this Node has zstd; Node >= 22.15).
{
  const t0 = at(2026, 7, 1, 8, 0, 0);
  const lines = [
    line(t0, "session_meta", meta(t0, B4, { originator: "codex_exec", source: "exec" }), 0),
    line(t0 + 1000, "event_msg", { type: "task_started", turn_id: "t1", started_at: Math.floor(t0 / 1000) + 1 }, 1),
    line(t0 + 1500, "turn_context", { turn_id: "t1", model: "gpt-5.6-sol", effort: "xhigh", timezone: "UTC" }, 2),
    line(t0 + 2000, "event_msg", { type: "token_count", info: { last_token_usage: usage(10, 0, 1, 0) }, rate_limits: null }, 3),
  ];
  if (typeof zlib.zstdCompressSync === "function") {
    write(`archived_sessions/2026/07/01/rollout-2026-07-01T08-00-00-${B4}.jsonl.zst`, zlib.zstdCompressSync(Buffer.from(`${lines.join("\n")}\n`)));
  } else {
    console.warn("zstd not available in this Node; skipped the .zst fixture");
  }
}
