import type { SessionRow } from "@convex/lib/types";
import { sourceLabel } from "@/components/breakdowns";

/** Same matching rule as the web's session filter: every term must appear somewhere in the row. */
export function filterSessions(rows: SessionRow[], query: string): SessionRow[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((s) => {
    const text = [
      s.project,
      s.gitBranch ?? "",
      s.model,
      s.effort ?? "",
      sourceLabel(s.source, s.isSubagent),
      s.source,
      s.machineLabel,
      s.userName,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((t) => text.includes(t));
  });
}
