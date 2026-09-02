#!/usr/bin/env node
// Usage: node cli/scripts/check-dry-run.mjs <dry-run.json> <raw-totals.json>
// Privacy and totals audit of `codex-kaboo sync --dry-run --json --codex-home ~/.codex`.
import fs from "node:fs";
import os from "node:os";

const [dryPath, rawPath] = process.argv.slice(2);
if (!dryPath || !rawPath) {
  console.error("usage: check-dry-run.mjs <dry-run.json> <raw-totals.json>");
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(dryPath, "utf8"));
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const problems = [];
const FORBIDDEN_KEYS = new Set([
  "command", "cwd", "path", "stdout", "stderr", "aggregated_output", "formatted_output", "unified_diff", "content",
  "message", "text", "query", "results", "arguments", "raw_content", "summary_text", "developer_instructions",
  "last_agent_message", "repository_url", "replacement_history",
]);
const home = os.homedir();

function scan(value, trail) {
  if (typeof value === "string") {
    if (value.includes(home) || /(^|[\\/])(Users|home)[\\/]/.test(value)) problems.push(`path-like string at ${trail}`);
    if (value.length > 256) problems.push(`string longer than 256 chars at ${trail}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scan(v, `${trail}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) problems.push(`forbidden key "${key}" at ${trail}`);
      scan(v, `${trail}.${key}`);
    }
  }
}

const batches = report.batches ?? [];
if (batches.length === 0) problems.push("no batches in the dry-run report (is the codex home right?)");
batches.forEach((batch, i) => scan(batch, `batches[${i}]`));
for (const batch of batches) {
  if (batch.machine.hostname !== null && batch.machine.hostname !== undefined) problems.push("machine.hostname is set (only expected after `login --hostname`)");
}

const sessions = new Map();
for (const batch of batches) for (const s of batch.sessions) sessions.set(s.sessionId, s);
const eventCounts = new Map();
for (const batch of batches) {
  for (const e of batch.tokenEvents) {
    eventCounts.set(e.sessionId, (eventCounts.get(e.sessionId) ?? 0) + 1);
    if (e.total !== e.input + e.output) problems.push(`event ${e.sessionId}#${e.seq}: total != input + output`);
    if (!sessions.has(e.sessionId)) problems.push(`event ${e.sessionId}#${e.seq}: no session summary in the batches`);
  }
}

const rows = [];
for (const [sessionId, expected] of Object.entries(raw)) {
  const s = sessions.get(sessionId);
  if (!s) {
    problems.push(`session ${sessionId} missing from the dry run`);
    continue;
  }
  const got = { input: s.tokens.input, cachedInput: s.tokens.cachedInput, cacheWrite: s.tokens.cacheWrite, output: s.tokens.output, reasoning: s.tokens.reasoning, events: s.responses, lines: s.lineCount };
  for (const key of Object.keys(got)) {
    if (got[key] !== expected[key]) problems.push(`${sessionId}: ${key} ${got[key]} != raw ${expected[key]}`);
  }
  if ((eventCounts.get(sessionId) ?? 0) !== expected.events) problems.push(`${sessionId}: ${eventCounts.get(sessionId) ?? 0} events shipped != raw ${expected.events}`);
  rows.push({ session: `…${sessionId.slice(-4)}`, lines: s.lineCount, events: s.responses, input: s.tokens.input, cached: s.tokens.cachedInput, output: s.tokens.output, model: s.model, project: s.project, subagent: s.isSubagent });
}
for (const sessionId of sessions.keys()) if (!raw[sessionId]) problems.push(`session ${sessionId} is not in the raw totals`);

console.table(rows);
const totalEvents = [...eventCounts.values()].reduce((a, b) => a + b, 0);
console.log(`${sessions.size} sessions, ${totalEvents} token events, ${batches.length} request(s)`);
if (problems.length > 0) {
  console.error("FAIL");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("PASS: no text, paths or forbidden keys; totals match the raw logs");
