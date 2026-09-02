import { TOOL_KINDS, type ToolKind } from "@shared/constants";
import { cacheHitRate, ratio } from "@shared/metrics";
import type { BreakdownsResult } from "@convex/lib/types";
import { CATEGORICAL, OTHER_COLOR, type ColorMap } from "./colors";
import { shareSegments, type Segment } from "./chart-data";

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

const SOURCE_COLORS = [CATEGORICAL[1], CATEGORICAL[0], CATEGORICAL[4], CATEGORICAL[3], CATEGORICAL[5]] as const;

export function sourceSegments(bySource: BreakdownsResult["bySource"]): Segment[] {
  return bySource.map((s, i) => ({
    key: s.key,
    label: SOURCE_LABELS[s.key] ?? s.key,
    value: s.tokens,
    share: s.share,
    color: SOURCE_COLORS[i % SOURCE_COLORS.length]!,
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
