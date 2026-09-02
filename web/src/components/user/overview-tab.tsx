"use client";

import type { Id } from "@convex/_generated/dataModel";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import type { ResolvedRange } from "@/lib/range";
import { ActivityCard } from "./activity-card";
import { DataSyncCard } from "./data-sync-card";
import { OverviewStats } from "./overview-stats";
import { TokenTrendCard } from "./token-trend-card";

export function OverviewTab({
  range,
  userId,
  isMe,
  today,
}: {
  range: ResolvedRange;
  userId: Id<"users">;
  isMe: boolean;
  today: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SectionErrorBoundary title="Stats could not load">
        <OverviewStats range={range} userId={userId} />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Activity could not load">
        <ActivityCard userId={userId} today={today} />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Trend could not load">
        <TokenTrendCard range={range} userId={userId} />
      </SectionErrorBoundary>
      <SectionErrorBoundary title="Data Sync could not load">
        <DataSyncCard userId={userId} isMe={isMe} />
      </SectionErrorBoundary>
    </div>
  );
}
