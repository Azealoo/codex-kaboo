"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { useQueryState } from "nuqs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ShellSkeleton } from "@/components/layout/app-gate";
import { useCurrentUserId } from "@/components/layout/current-user";
import { EmptyState } from "@/components/primitives/empty-state";
import { SegmentedControl } from "@/components/primitives/segmented-control";
import { OverviewTab } from "@/components/user/overview-tab";
import { UserHeader } from "@/components/user/user-header";
import { useUserColors } from "@/hooks/use-entity-colors";
import { useRange } from "@/hooks/use-range";
import { colorFor } from "@/lib/colors";
import type { ResolvedRange } from "@/lib/range";
import { TABS, tabParser, type Tab } from "@/lib/search-params";

const TAB_OPTIONS = TABS.map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) }));

function TabBody({ tab, range, userId, isMe, today }: { tab: Tab; range: ResolvedRange; userId: Id<"users">; isMe: boolean; today: string }) {
  switch (tab) {
    case "overview":
      return <OverviewTab range={range} userId={userId} isMe={isMe} today={today} />;
    default:
      return <EmptyState title="Coming up" description="This tab is added in the next tasks." />;
  }
}

export default function UserPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId as Id<"users">;
  const me = useCurrentUserId();
  const users = useQuery(api.users.list, {});
  const colors = useUserColors();
  const { resolved, today } = useRange();
  const [tab, setTab] = useQueryState("tab", tabParser);
  if (users === undefined || resolved === null || today === null) return <ShellSkeleton />;
  const user = users.find((u) => u.userId === userId);
  if (!user) return <EmptyState title="User not found" description="This user has not signed in to the dashboard." />;
  const isMe = userId === me;
  return (
    <div className="flex flex-col gap-4">
      <UserHeader user={user} isMe={isMe} color={colorFor(colors, userId)} />
      <SegmentedControl ariaLabel="Tab" options={TAB_OPTIONS} value={tab} onChange={(t) => void setTab(t)} size="default" className="self-start" />
      <TabBody tab={tab} range={resolved} userId={userId} isMe={isMe} today={today} />
    </div>
  );
}
