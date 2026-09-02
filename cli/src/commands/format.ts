import { summaryLine, type SyncReport } from "./sync";

export function formatSyncReport(report: SyncReport): string[] {
  const lines: string[] = [];
  for (const home of report.homes) lines.push(`codex home: ${home.path} ${home.exists ? `(${home.files} rollout files)` : "(missing)"}`);
  for (const file of report.files) {
    if (file.action === "unchanged" && !report.dryRun) continue;
    const extra = file.action === "error" || file.action === "skipped"
      ? ` — ${file.reason ?? ""}`
      : file.newEvents > 0 || file.summaryChanged
        ? ` (+${file.newEvents} events${file.summaryChanged ? ", summary" : ""})`
        : "";
    lines.push(`${file.action.padEnd(9)} ${file.name}${extra}`);
  }
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  for (const error of report.errors) lines.push(`error: ${error}`);
  lines.push(summaryLine(report));
  if (report.dryRun) lines.push("dry run: nothing was sent and no state was written (use --json to inspect the exact payloads)");
  return lines;
}
