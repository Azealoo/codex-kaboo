import { MAX_STRING_LENGTH } from "@codex-kaboo/shared/constants";

export type CommandKind = "commandRead" | "commandList" | "commandSearch" | "commandOther";

export function classifyParsedCmdType(type: unknown): CommandKind {
  switch (type) {
    case "read":
      return "commandRead";
    case "list_files":
      return "commandList";
    case "search":
      return "commandSearch";
    default:
      return "commandOther";
  }
}

/** Parent directory of a SKILL.md path; matches with `/` or `\` separators, case-insensitive. */
export const SKILL_RE = /(?:^|[\\/])([^\\/\s"']+)[\\/]SKILL\.md\b/i;

/** Distinct skill names referenced by any string in `values` (non-strings ignored). Never returns the input. */
export function detectSkills(values: readonly unknown[]): string[] {
  const found = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const re = new RegExp(SKILL_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found].sort();
}

/** Codex built-in function/custom tool names (never counted as MCP). */
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "exec", "shell", "shell_command", "local_shell", "container.exec", "exec_command", "write_stdin",
  "unified_exec", "apply_patch", "update_plan", "view_image", "web_search", "wait", "js_repl",
  "image_generation", "spawn_agent", "send_input", "wait_agent", "close_agent", "list_agents",
  "request_user_input", "codex_review", "read_file", "list_dir", "grep_files",
]);

const MCP_PREFIXED = /^mcp__(.+?)__(.+)$/;
const MCP_BARE = /^([A-Za-z0-9][A-Za-z0-9.-]*)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/;

/** "server/tool" for MCP-looking function names, null for built-ins and everything else. */
export function mcpKeyFromFunctionName(name: unknown): string | null {
  if (typeof name !== "string" || name.length === 0) return null;
  const prefixed = MCP_PREFIXED.exec(name);
  if (prefixed && prefixed[1] && prefixed[2]) return clipString(`${prefixed[1]}/${prefixed[2]}`) ?? null;
  if (BUILTIN_TOOL_NAMES.has(name)) return null;
  const bare = MCP_BARE.exec(name);
  if (bare && bare[1] && bare[2]) return clipString(`${bare[1]}/${bare[2]}`) ?? null;
  return null;
}

/** session_meta.source → "cli" | "exec" | "vscode" | … | "subagent:<kind>" | "unknown". */
export function sourceOf(source: unknown): string {
  if (typeof source === "string") return clipString(source) ?? "unknown";
  const record = asRecord(source);
  if (record === null) return "unknown";
  if ("subagent" in record) {
    const sub = record.subagent;
    if (typeof sub === "string" && sub.length > 0) return `subagent:${clipString(sub, 200)}`;
    const subRecord = asRecord(sub);
    const firstKey = subRecord ? Object.keys(subRecord)[0] : undefined;
    if (subRecord && firstKey !== undefined) {
      const inner = subRecord[firstKey];
      const kind = typeof inner === "string" && inner.length > 0 ? inner : firstKey;
      return `subagent:${clipString(kind, 200)}`;
    }
    return "subagent:unknown";
  }
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0]) return clipString(keys[0]) ?? "unknown";
  return "unknown";
}

export function isSubagentSource(source: string): boolean {
  return source.startsWith("subagent:");
}

/** basename(cwd) — the only part of cwd that ever leaves the machine. */
export function projectOf(cwd: unknown): string {
  if (typeof cwd !== "string") return "(unknown)";
  const segments = cwd.split(/[\\/]+/).filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  return last === undefined ? "(unknown)" : (clipString(last) ?? "(unknown)");
}

export function clipString(value: unknown, max: number = MAX_STRING_LENGTH): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export function toCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
