"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { QuotaGauge } from "@/components/charts/quota-gauge";
import { EmptyState } from "@/components/primitives/empty-state";
import { InfoTooltip } from "@/components/primitives/info-tooltip";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { formatRelative, formatResetsIn } from "@/lib/format";

const STALE_AFTER_MS = 2 * 3_600_000;

export function QuotaCard() {
  const quota = useQuery(api.stats.quota, {});
  const now = useNow();
  if (quota === undefined) return <Skeleton className="h-28 rounded-lg" />;
  return (
    <Card className="gap-2 rounded-lg border-border p-4 shadow-none">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Shared weekly quota</span>
        <InfoTooltip text="The newest rate-limit snapshot reported by any synced machine (primary window, 7 days). All three accounts share it." />
        {quota && now !== null && now - quota.observedAt > STALE_AFTER_MS ? (
          <Badge className="ml-auto rounded-full bg-status-warning/20 text-foreground">Stale</Badge>
        ) : null}
      </div>
      {quota === null ? (
        <EmptyState title="No quota data yet" description="Appears after the first sync from any machine." />
      ) : (
        <>
          <QuotaGauge usedPercent={quota.usedPercent} />
          <div className="text-xs text-muted-foreground">
            <div>
              {now === null ? "Resets soon" : formatResetsIn(quota.resetsAt, now)} · {quota.planType ?? "unknown plan"}
            </div>
            <div>
              as of {now === null ? "—" : formatRelative(quota.observedAt, now)} · {quota.machine.label} ({quota.user.name})
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
