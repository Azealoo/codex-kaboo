import { cn } from "@/lib/utils";

/**
 * Daily rollups are recomputed only for the days a sync touches, so after a ROLLUP_VERSION bump a
 * day nothing re-syncs keeps the numbers the previous version computed and renders them beside
 * correct ones — plausible, wrong, and indistinguishable without being told. The repair is
 * `rollups:rebuildAll`, which a human has to remember to run; this is what says it is still owed,
 * on the page showing the affected numbers rather than in a log nobody reads.
 */
export function StaleRollupsNotice({ days, className }: { days: number; className?: string }) {
  if (days <= 0) return null;
  return (
    <p
      role="status"
      className={cn(
        "rounded-xl border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-foreground",
        className,
      )}
    >
      <span className="font-medium">
        {days} {days === 1 ? "day" : "days"} in this range{" "}
        {days === 1 ? "was summarised" : "were summarised"} by an older version of the dashboard
      </span>{" "}
      and may show outdated numbers. Run{" "}
      <code className="font-mono">npx convex run rollups:rebuildAll</code> to recompute them.
    </p>
  );
}
