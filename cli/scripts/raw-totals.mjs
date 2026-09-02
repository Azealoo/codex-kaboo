#!/usr/bin/env node
// Usage: node cli/scripts/raw-totals.mjs [<codex-home>]
// Independent cross-check for the real-data smoke test. Mirrors the reducer's precedence rule
// (Task 15): if a file has any recognisable `token_usage_record` line, its usages are the totals and
// every `token_count` line in that file is ignored; otherwise the totals come from `token_count`
// `info.last_token_usage`. Null and all-zero usages are skipped either way, as is the trailing
// partial line. Prints session ids and numbers only — never text or paths.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const home = process.argv[2] ?? path.join(os.homedir(), ".codex");
const RE =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})(?:_([0-9a-f-]{36}))?\.jsonl(\.zst)?$/i;
const files = [];
function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (RE.test(entry.name)) files.push(full);
  }
}
for (const sub of ["sessions", "archived_sessions"]) walk(path.join(home, sub));

// Mirrors parseLineTimestamp (cli/src/parser/time.ts): a line only carries a usable timestamp if
// it is a non-negative finite number or a string Date.parse can read. pendingEventFrom discards
// any event whose line timestamp doesn't parse, regardless of type.
function lineTimestampParses(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return true;
  if (typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)))
    return true;
  return false;
}

const out = {};
for (const file of files) {
  const m = RE.exec(path.basename(file));
  const sessionId = (m[2] ? `${m[1]}_${m[2]}` : m[1]).toLowerCase();
  let buffer = fs.readFileSync(file);
  if (m[3]) {
    if (typeof zlib.zstdDecompressSync !== "function") continue;
    buffer = zlib.zstdDecompressSync(buffer);
  }
  const text = buffer.toString("utf8");
  const lines = text.split("\n");
  lines.pop(); // "" after a trailing newline, or the unterminated partial line
  const empty = () => ({
    input: 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    events: 0,
  });
  const fromTokenCount = empty();
  const fromUsageRecord = empty();
  let hasUsageRecords = false;
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    let usage;
    let isUsageRecord = false;
    if (obj.type === "token_usage_record") {
      const payload = obj.payload ?? {};
      usage =
        payload.usage ??
        payload.info?.last_token_usage ??
        (typeof payload.input_tokens === "number" ? payload : null);
      if (!usage) continue; // unrecognised shape: the reducer ignores it and keeps the token_count events
      isUsageRecord = true;
    } else if (obj.type === "event_msg" && obj.payload?.type === "token_count") {
      usage = obj.payload.info?.last_token_usage;
      if (!usage) continue;
    } else {
      continue;
    }
    const values = [
      usage.input_tokens,
      usage.cached_input_tokens,
      usage.cache_write_input_tokens,
      usage.output_tokens,
      usage.reasoning_output_tokens,
    ].map((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0));
    // A record only counts — of either kind — once it is proven non-degenerate: non-zero (checked
    // here, before anything below reads or sets hasUsageRecords) AND its own line timestamp
    // parses. This mirrors pendingEventFrom (cli/src/parser/session.ts:228-247), which is called
    // identically for both token_count (session.ts:303-304) and token_usage_record (session.ts:333)
    // and returns null — dropping the event entirely, for either kind — whenever `ts === null`. A
    // token_usage_record additionally only switches this file to usage-record mode once it clears
    // both checks, matching handleUsageRecord (session.ts:325-341): an all-zero or
    // unparseable-timestamp usage record must never flip hasUsageRecords or suppress a file's real
    // token_count totals; an unparseable-timestamp token_count line must be dropped too, exactly
    // like the reducer drops it, not silently counted here.
    if (values.every((v) => v === 0)) continue;
    if (!lineTimestampParses(obj.timestamp)) continue;
    if (isUsageRecord) hasUsageRecords = true;
    const totals = isUsageRecord ? fromUsageRecord : fromTokenCount;
    totals.input += values[0];
    totals.cachedInput += values[1];
    totals.cacheWrite += values[2];
    totals.output += values[3];
    totals.reasoning += values[4];
    totals.events += 1;
  }
  out[sessionId] = { ...(hasUsageRecords ? fromUsageRecord : fromTokenCount), lines: lines.length };
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
