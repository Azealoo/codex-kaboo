import { OTHER_KEY, TOOL_KINDS, type ToolKind } from "@shared/constants";
import { cacheHitRate, ratio } from "@shared/metrics";
import type { BreakdownsResult } from "@convex/lib/types";
import { CATEGORICAL, OTHER_COLOR, assignSlots, colorFor, type ColorMap } from "./colors";
import { foldTopN, shareSegments, type Segment } from "./chart-data";

export const TOOL_LABELS: Record<ToolKind, string> = {
  commandRead: "Read files",
  commandList: "List files",
  commandSearch: "Search",
  commandOther: "Other commands",
  fileChange: "File changes",
  webSearch: "Web search",
  imageView: "Image view",
  mcpTool: "MCP tools",
  other: "Other",
};

const TOOL_COLORS: Record<ToolKind, string> = {
  commandRead: CATEGORICAL[1],
  commandList: CATEGORICAL[3],
  commandSearch: CATEGORICAL[4],
  commandOther: CATEGORICAL[5],
  fileChange: CATEGORICAL[0],
  webSearch: CATEGORICAL[2],
  imageView: CATEGORICAL[7],
  mcpTool: CATEGORICAL[6],
  other: OTHER_COLOR,
};

export function toolSegments(byTool: BreakdownsResult["byTool"]): Segment[] {
  const byKey = new Map(byTool.map((t) => [t.key, t]));
  return TOOL_KINDS.filter((k) => byKey.has(k)).map((k) => {
    const t = byKey.get(k)!;
    return { key: k, label: TOOL_LABELS[k], value: t.count, share: t.share, color: TOOL_COLORS[k] };
  });
}

export function modelSegments(byModel: BreakdownsResult["byModel"], colors: ColorMap): Segment[] {
  return shareSegments(
    byModel.map((m) => ({ key: m.key, value: m.tokens.total })),
    colors,
  );
}

/** Display names for `bySource` keys and session sources; unknown keys render verbatim. */
export const SOURCE_LABELS: Record<string, string> = {
  cli: "CLI",
  exec: "Exec",
  vscode: "VS Code",
  mcp: "MCP",
  subagent: "Sub-agent",
};

/** Fixed slots for the sources Codex can emit, so a source's colour never depends on the range. */
const SOURCE_ORDER = ["cli", "exec", "vscode", "mcp", "custom", "internal"] as const;

/** Known sources hold their slot whether or not they appear; `subagent:<kind>` and any future
 *  source follow, alphabetically, so a colour shifts only when the set of unknown sources changes. */
export function sourceColorMap(keys: readonly string[]): Map<string, string> {
  const known = new Set<string>(SOURCE_ORDER);
  const extras = [...new Set(keys)].filter((k) => !known.has(k)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return assignSlots([...SOURCE_ORDER, ...extras]);
}

export function sourceSegments(bySource: BreakdownsResult["bySource"], topN = 8): Segment[] {
  const colors = sourceColorMap(bySource.map((s) => s.key));
  const folded = foldTopN(bySource.map((s) => ({ key: s.key, value: s.tokens })), topN);
  const total = folded.reduce((acc, i) => acc + i.value, 0);
  return folded.map((i) => ({
    key: i.key,
    label: i.key === OTHER_KEY ? "Other" : (SOURCE_LABELS[i.key] ?? i.key),
    value: i.value,
    share: total > 0 ? i.value / total : 0,
    color: i.key === OTHER_KEY ? OTHER_COLOR : colorFor(colors, i.key),
  }));
}

export type ModelTableRow = {
  model: string;
  tokens: number;
  share: number;
  responses: number;
  cacheHitRate: number | null;
  costUsd: number | null;
  usdPerMTok: number | null;
};

/** The one row shape behind every per-model table (Home → Models and the user Efficiency tab). */
export function modelTableRows(byModel: BreakdownsResult["byModel"]): ModelTableRow[] {
  return byModel.map((m) => ({
    model: m.key,
    tokens: m.tokens.total,
    share: m.share,
    responses: m.responses,
    cacheHitRate: cacheHitRate(m.tokens),
    costUsd: m.costUsd,
    usdPerMTok: m.costUsd === null ? null : ratio(m.costUsd * 1e6, m.tokens.total),
  }));
}
