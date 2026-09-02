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
  // Raw-rollout privacy traps (spec): parsed_cmd[].cmd/.name are real shell text / file basenames;
  // git.commit_hash is a real commit hash. None of these three collides with any field name in
  // shared/src/sync.ts's TokenCounts, ToolCounts, KeyCount, Ttft, SessionSummary, TokenEvent,
  // RateLimitSnapshot, MachineInfo or SyncBatch — the only schemas `report.batches` can contain —
  // so adding them cannot flag a legitimate, allow-listed field.
  "cmd", "name", "commit_hash",
]);
const home = os.homedir();

// A small denylist of generic account names that must NOT trip the username check on their own
// (avoids flooding an audit with false positives for anyone whose OS account is a common word);
// every other username at least 3 characters long is checked as a bare word below.
const COMMON_WORDS = new Set([
  "user", "users", "admin", "administrator", "test", "guest", "demo", "root", "home", "main",
  "default", "local", "public", "shared", "team", "dev", "prod", "staging", "system", "owner",
]);
let osUsername = "";
try {
  osUsername = os.userInfo().username ?? "";
} catch {
  osUsername = ""; // some sandboxed/uid-less environments throw here; just skip this one check
}
const usernameRe =
  osUsername.length >= 3 && !COMMON_WORDS.has(osUsername.toLowerCase())
    ? new RegExp(`(^|[^A-Za-z0-9])${osUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`, "i")
    : null;
const URL_RE = /https?:\/\//i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
const POSIX_ABS_RE = /^\/(Users|home|etc|opt|root|var|tmp|private)\//;
const WINDOWS_ABS_RE = /^[A-Za-z]:[\\/]/;

// `project`, `gitBranch`, the machine `label`, and the `key` of an `mcpTools`/`skills` entry are
// uploaded BY DESIGN (spec: project folder name, git branch, machine label, MCP/skill names) and
// very commonly contain the operator's own handle (a folder like "alice-notes", a branch like
// "alice/feature-x") — that is expected, not a leak. This allow-list exempts only the VALUES at
// these trail keys from the username check specifically; every other check (paths, URLs, emails,
// forbidden keys) still applies to them, and object KEYS and every other field's values still get
// the full username check.
const USERNAME_EXEMPT_TRAIL_RE = /(?:\.project|\.gitBranch|\.label|\.(?:mcpTools|skills)\[\d+\]\.key)$/;

/** Short leak-category label for a leaky string, or null. Callers must never echo the string itself. */
function leakKind(str, usernameExempt) {
  if (str.includes(home) || /(^|[\\/])(Users|home)[\\/]/.test(str)) return "path-like string";
  if (POSIX_ABS_RE.test(str)) return "absolute path";
  if (WINDOWS_ABS_RE.test(str)) return "Windows-style path";
  if (URL_RE.test(str)) return "URL";
  if (EMAIL_RE.test(str)) return "email address";
  if (!usernameExempt && usernameRe && usernameRe.test(str)) return "OS username";
  return null;
}

function scan(value, trail) {
  if (typeof value === "string") {
    const kind = leakKind(value, USERNAME_EXEMPT_TRAIL_RE.test(trail));
    if (kind) problems.push(`${kind} at ${trail}`);
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
      // A real path/URL/email/username can also show up as an object KEY, not just a value (e.g. a
      // dynamic-keyed map some future field introduces) — check it too (keys are never exempt from
      // the username check, unlike the specific values above), but never fold the leaky key itself
      // into a message or into the trail used for whatever is nested under it.
      const keyKind = leakKind(key, false);
      if (keyKind) problems.push(`${keyKind} used as an object key under ${trail}`);
      scan(v, `${trail}.${keyKind ? "<redacted-key>" : key}`);
    }
  }
}

const batches = report.batches ?? [];
// A dry run of a steady-state machine (nothing changed since the last sync) legitimately carries a
// single machine-only heartbeat batch and no session data — that heartbeat is exactly what a real
// run would still POST, so it is the payload worth auditing, not an error. Only a report with no
// payload at all means the run found nothing to look at.
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

// Steady state: the report carries only the heartbeat, so there is nothing to reconcile against the
// raw logs — every session in `raw` was uploaded on an earlier run and is deliberately absent here.
// Say so loudly (the privacy scan above still ran over the heartbeat) instead of flagging every
// already-synced session as missing, which would make a steady-state machine unauditable.
const heartbeatOnly = batches.length > 0 && sessions.size === 0 && eventCounts.size === 0;
if (heartbeatOnly) {
  const rawCount = Object.keys(raw).length;
  console.log(`heartbeat-only dry run: ${batches.length} machine-only batch(es), no session data.`);
  console.log(`totals reconciliation SKIPPED (${rawCount} session(s) in the raw logs, all already synced).`);
  console.log("re-run with a fresh CODEX_KABOO_HOME to force a full re-parse and reconcile them.");
}

const rows = [];
for (const [sessionId, expected] of (heartbeatOnly ? [] : Object.entries(raw))) {
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
console.log(
  heartbeatOnly
    ? "PASS: no text, paths or forbidden keys in the heartbeat (totals not reconciled — see above)"
    : "PASS: no text, paths or forbidden keys; totals match the raw logs",
);
