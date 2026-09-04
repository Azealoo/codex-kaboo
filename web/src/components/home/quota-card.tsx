"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { QuotaGauge } from "@/components/charts/quota-gauge";
import { QuotaSparkline } from "@/components/charts/quota-sparkline";
import { EmptyState } from "@/components/primitives/empty-state";
import { InfoTooltip } from "@/components/primitives/info-tooltip";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { formatRelative, formatResetsIn } from "@/lib/format";
import { historySince, usedDelta } from "@/lib/quota-history";

const STALE_AFTER_MS = 2 * 3_600_000;
const HISTORY_DAYS = 7;
const DAY_MS = 86_400_000;

function deltaText(delta: number): string {
  const pts = Math.abs(delta).toFixed(0);
  if (delta > 0.5) return `+${pts} pts since yesterday`;
  if (delta < -0.5) return `−${pts} pts since yesterday (reset)`;
  return "flat since yesterday";
}

export function QuotaCard() {
  const quota = useQuery(api.stats.quota, {});
  const now = useNow();
  // Hour-floored `sinceMs` keeps this subscription's args (and so its cache key) stable within
  // the hour; `untilMs` is left open so a reading that lands mid-hour appears immediately.
  const since = now === null ? null : historySince(now, HISTORY_DAYS);
  const history = useQuery(api.stats.quotaHistory, since === null ? "skip" : { sinceMs: since });
  if (quota === undefined)
    return <Skeleton className="col-span-2 h-28 rounded-lg lg:col-span-3 xl:col-span-1" />;
  const delta = history ? usedDelta(history.points, DAY_MS) : null;
  return (
    <Card className="col-span-2 gap-2 rounded-lg border-border p-4 shadow-none lg:col-span-3 xl:col-span-1">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Shared weekly quota</span>
        <InfoTooltip text="The newest rate-limit snapshot reported by any synced machine (primary window, 7 days). All three accounts share it. The line below is the last 7 days of readings; a sharp drop is the weekly reset." />
        {/* receivedAt, not observedAt: this is the second time that distinction has been missed.
            observedAt is the reporting machine's own clock, which we cannot vouch for — a fast RTC
            can report a future observedAt, which would make this comparison negative and never
            stale. receivedAt is when OUR server saw it, so it is the only clock comparable to the
            viewer's `now`. */}
        {quota && now !== null && now - quota.receivedAt > STALE_AFTER_MS ? (
          <Badge className="ml-auto rounded-full bg-status-warning/20 text-foreground">Stale</Badge>
        ) : null}
      </div>
      {quota === null ? (
        <EmptyState
          title="No quota data yet"
          description="Appears after the first sync from any machine."
        />
      ) : (
        <>
          <QuotaGauge usedPercent={quota.usedPercent} />
          <div className="text-xs text-muted-foreground">
            <div>
              {now === null ? "Resets soon" : formatResetsIn(quota.resetsAt, now)} ·{" "}
              {quota.planType ?? "unknown plan"}
            </div>
            <div>
              {/* receivedAt here too, for the same reason as the badge above: both answer "how
                  fresh is this number?", and only the server clock can answer that comparably
                  against the viewer's `now`. */}
              as of {now === null ? "—" : formatRelative(quota.receivedAt, now)} ·{" "}
              {quota.machine.label} ({quota.user.name})
            </div>
          </div>
          {history && now !== null && since !== null && history.points.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-border pt-2">
              <QuotaSparkline points={history.points} from={since} to={now} days={HISTORY_DAYS} />
              <p className="text-[11px] text-muted-foreground">
                Last {HISTORY_DAYS} days · {history.points.length} readings
                {delta ? ` · ${deltaText(delta.delta)}` : ""}
              </p>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
