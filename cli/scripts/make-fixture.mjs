#!/usr/bin/env node
// Usage: node cli/scripts/make-fixture.mjs <input.jsonl> <output.jsonl> --uuid <uuid> [--parent <uuid>]
// Rewrites a real Codex rollout into a synthetic fixture: numbers and structure kept, every string
// redacted by key. Review the output (grep for /Users, /home, http, C:\\) before committing it.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const [input, output] = args;
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const uuid = opt("--uuid");
const parentUuid = opt("--parent") ?? "0199f1c0-0000-7000-8000-0000000000a0";
if (!input || !output || !uuid) {
  console.error(
    "usage: make-fixture.mjs <input.jsonl> <output.jsonl> --uuid <uuid> [--parent <uuid>]",
  );
  process.exit(2);
}
if (!fs.existsSync(input)) {
  console.error(`make-fixture: source rollout not found: ${input}`);
  console.error(
    "Substitute any real rollout of the same shape (see the table in Task 17 Step 4: same history_mode/originator and roughly the same size), keep the synthetic UUID, then re-verify every pinned number against the regenerated fixture.",
  );
  process.exit(1);
}

const KNOWN_TYPES = new Set([
  "session_meta",
  "turn_context",
  "event_msg",
  "response_item",
  "compacted",
  "token_usage_record",
]);
const KEEP = new Set([
  "type",
  "turn_id",
  "call_id",
  "model",
  "effort",
  "originator",
  "cli_version",
  "history_mode",
  "model_provider",
  "thread_source",
  "timezone",
  "mode",
  "kind",
  "status",
  "role",
  "phase",
  "plan_type",
  "limit_id",
  "limit_name",
  "branch",
  "server",
  "tool",
  "timestamp",
  "current_date",
  "approval_policy",
  "rate_limit_reached_type",
  "collaboration_mode_kind",
  "multi_agent_version",
  "other",
  "window_id",
  "first_window_id",
  "previous_window_id",
  "window_number",
  "reasoning_effort",
  "exit_code",
  "duration",
]);
// `name` is deliberately absent from KEEP: it is decided by the enclosing key below — kept on a
// payload/item (`response_item`/`function_call` names drive MCP detection), redacted inside
// `parsed_cmd[]`, where it is a real file basename (spec privacy trap).
const PATH_KEYS = new Set(["path", "move_path", "workspace_roots", "writable_roots"]);
const SKILL_RE = /(?:^|[\\/])([^\\/\s"']+)[\\/]SKILL\.md\b/i;
const pathIds = new Map();
// Real skill directory name -> synthetic "skill-N", assigned in order of first appearance in the
// file. Shared by redactPath and redactCommandText so the same real name always maps to the same
// synthetic one, wherever in the file it is seen — the real name (e.g. a user's actual tool/skill
// name) must never survive into a committed fixture; only the SKILL.md structure matters for
// skill-detection tests, not the name itself.
const skillIds = new Map();
let originalId = null;
let originalSessionId = null;

function synthSkillName(real) {
  if (!skillIds.has(real)) skillIds.set(real, `skill-${skillIds.size + 1}`);
  return skillIds.get(real);
}

function redactPath(value) {
  const m = SKILL_RE.exec(value);
  if (m) return `/redacted/skills/${synthSkillName(m[1])}/SKILL.md`;
  if (!pathIds.has(value)) pathIds.set(value, pathIds.size + 1);
  return `/redacted/${pathIds.get(value)}`;
}

function redactCommandText(value) {
  const m = SKILL_RE.exec(value);
  return m ? `cat /redacted/skills/${synthSkillName(m[1])}/SKILL.md` : "redacted";
}

function countLines(content) {
  if (content.length === 0) return 0;
  const parts = content.split("\n").length;
  return content.endsWith("\n") ? parts - 1 : parts;
}

function synthDiff(diff) {
  const hunks = [];
  let current = null;
  for (const raw of diff.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("@@")) {
      current = { added: 0, removed: 0 };
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith("\\")) continue;
    if (line.startsWith("+")) current.added += 1;
    else if (line.startsWith("-")) current.removed += 1;
  }
  return hunks
    .map(
      (h) =>
        `@@ -1,${h.removed} +1,${h.added} @@\n${"+x\n".repeat(h.added)}${"-x\n".repeat(h.removed)}`,
    )
    .join("");
}

function redactString(key, value, parent) {
  if (key === "cwd") return "/redacted/project-a";
  if (PATH_KEYS.has(key)) return redactPath(value);
  if (key === "cmd" || key === "command") return redactCommandText(value);
  if (key === "name") return parent === "parsed_cmd" ? "<r>" : value;
  if (key === "id") return value === originalId ? uuid : value;
  if (key === "session_id") return value === originalId ? uuid : parentUuid;
  if (key === "parent_thread_id") return parentUuid;
  if (key === "unified_diff") return synthDiff(value);
  if (key === "content") return "x\n".repeat(countLines(value));
  if (key === "source" || key === "subagent") return value; // enum-like
  if (KEEP.has(key)) return value;
  return `<r:${value.length}>`;
}

/** `parent` is the key of the enclosing object (or array), so `parsed_cmd[].name` is distinguishable. */
function redact(value, key, parent) {
  if (typeof value === "string") return redactString(key, value, parent);
  if (Array.isArray(value)) return value.map((v) => redact(v, key, parent));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const newKey = key === "changes" ? redactPath(k) : k;
      out[newKey] = redact(v, k, key);
    }
    return out;
  }
  return value; // numbers, booleans, null
}

const text = fs.readFileSync(input, "utf8");
const endsWithNewline = text.endsWith("\n");
const lines = text.split("\n");
if (endsWithNewline) lines.pop();
for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    if (obj.type === "session_meta") {
      originalId = obj.payload?.id ?? null;
      originalSessionId = obj.payload?.session_id ?? null;
    }
  } catch {
    // corrupt lines are copied verbatim below only if they contain no letters
  }
}
if (originalSessionId === null) originalSessionId = originalId;

const outLines = lines.map((line) => {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return "{corrupt line}";
  }
  if (!KNOWN_TYPES.has(obj.type)) return JSON.stringify({ ...obj, payload: { redacted: true } });
  return JSON.stringify(redact(obj, "", ""));
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, outLines.join("\n") + (endsWithNewline ? "\n" : ""));
console.log(`${output}: ${outLines.length} lines, ${pathIds.size} distinct paths redacted`);
