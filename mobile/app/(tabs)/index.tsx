import { useState } from "react";
import { View } from "react-native";
import { Breakdowns } from "@/components/breakdowns";
import { Leaderboard } from "@/components/leaderboard";
import {
  CostStructureCard,
  EFFICIENCY_CARD_KEYS,
  MetricCards,
  QuotaCard,
  VOLUME_CARD_KEYS,
} from "@/components/overview-cards";
import { Screen } from "@/components/screen";
import { TeamTrends } from "@/components/trend-section";
import { Muted, SegmentedControl, Skeleton } from "@/components/ui";
import { useRange } from "@/providers/range";

const VIEWS = [
  { value: "volume", label: "Volume" },
  { value: "efficiency", label: "Efficiency" },
] as const;

export default function Insights() {
  const { resolved } = useRange();
  const [view, setView] = useState<"volume" | "efficiency">("volume");
  if (resolved === null)
    return (
      <Screen>
        <Skeleton height={120} />
        <Skeleton height={240} />
      </Screen>
    );
  return (
    <Screen>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Muted>
          {resolved.label} · {resolved.days} day{resolved.days === 1 ? "" : "s"}
        </Muted>
        <SegmentedControl label="View" options={VIEWS} value={view} onChange={setView} />
      </View>
      <MetricCards
        range={resolved}
        keys={view === "volume" ? VOLUME_CARD_KEYS : EFFICIENCY_CARD_KEYS}
      />
      {view === "volume" ? <QuotaCard /> : <CostStructureCard range={resolved} />}
      <Leaderboard range={resolved} />
      <TeamTrends range={resolved} />
      <Breakdowns range={resolved} />
    </Screen>
  );
}
