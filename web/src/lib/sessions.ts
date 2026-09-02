import { SOURCE_LABELS } from "./breakdowns";

export function sourceLabel(source: string, isSubagent: boolean): string {
  if (source.startsWith("subagent:")) {
    const kind = source.slice("subagent:".length);
    return kind ? `Sub-agent · ${kind}` : "Sub-agent";
  }
  if (isSubagent) return "Sub-agent";
  return SOURCE_LABELS[source] ?? source;
}
