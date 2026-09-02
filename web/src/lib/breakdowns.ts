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

/** Display names for the fixed, non-interpolated `bySource`/session source keys. */
export const SOURCE_LABELS: Record<string, string> = {
  cli: "CLI",
  exec: "Exec",
  vscode: "VS Code",
  mcp: "MCP",
};

/**
 * The single entry point for turning a source key into a display string — used by both the
 * Breakdown tab's Sources table/chart and the user page's Sessions tab, so the two never disagree
 * on the same key again. `sourceOf` (cli/src/parser/classify.ts) always returns `subagent:<kind>`
 * for a sub-agent, never a bare `subagent`, so that shape is matched directly rather than through
 * `SOURCE_LABELS` (which cannot express the interpolated `<kind>` anyway — there is deliberately no
 * `subagent` entry in that table: no producer emits the bare key, and this prefix check would
 * shadow it even if one did). `isSubagent` exists for session rows, which carry their own boolean
 * alongside `source`; breakdown rows have only a key, so it defaults to `false` — safe, because a
 * real sub-agent key already starts with `subagent:` and is caught by the branch above first.
 */
export function sourceLabel(source: string, isSubagent = false): string {
  if (source.startsWith("subagent:")) {
    const kind = source.slice("subagent:".length);
    return kind ? `Sub-agent · ${kind}` : "Sub-agent";
  }
  if (isSubagent) return "Sub-agent";
  return SOURCE_LABELS[source] ?? source;
}

/** Fixed slots for the sources Codex can emit, so a source's colour never depends on the range. */
const SOURCE_ORDER = ["cli", "exec", "vscode", "mcp", "custom", "internal"] as const;

/** Slots go to the sources actually present: the known ones in `SOURCE_ORDER`, then `subagent:<kind>`
 *  and any future source alphabetically. Absent known sources are NOT reserved a slot — reserving all
 *  six would push a third sub-agent kind past the eight-colour palette and onto `OTHER_COLOR`, which
 *  is the fold bucket's colour, reintroducing the collision this function exists to prevent. */
export function sourceColorMap(keys: readonly string[]): Map<string, string> {
  const known = new Set<string>(SOURCE_ORDER);
  const present = new Set(keys);
  const inOrder = SOURCE_ORDER.filter((k) => present.has(k));
  const extras = [...present].filter((k) => !known.has(k)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return assignSlots([...inOrder, ...extras]);
}

export function sourceSegments(bySource: BreakdownsResult["bySource"], topN = 8): Segment[] {
  const folded = foldTopN(bySource.map((s) => ({ key: s.key, value: s.tokens })), topN);
  // Colour only the survivors: at most `topN` keys, so every one gets a real palette slot and
  // `OTHER_COLOR` stays unique to the fold bucket.
  const colors = sourceColorMap(folded.filter((i) => i.key !== OTHER_KEY).map((i) => i.key));
  const total = folded.reduce((acc, i) => acc + i.value, 0);
  return folded.map((i) => ({
    key: i.key,
    label: i.key === OTHER_KEY ? "Other" : sourceLabel(i.key),
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
