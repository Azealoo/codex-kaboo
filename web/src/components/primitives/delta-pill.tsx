import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatDeltaPercent } from "@/lib/format";
import { deltaTone, type GoodDirection } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export function DeltaPill({
  change,
  goodDirection,
  previousLabel = "vs previous period",
}: {
  change: number | null;
  goodDirection: GoodDirection;
  previousLabel?: string;
}) {
  if (change === null) return null;
  const { tone, good } = deltaTone(change, goodDirection);
  const text = formatDeltaPercent(change);
  const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : Minus;
  const label = `${text} ${previousLabel}${good === null ? "" : good ? ", better" : ", worse"}`;
  return (
    <span
      aria-label={label}
      title={label}
      data-tone={tone}
      data-good={good === null ? undefined : String(good)}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular",
        good === true && "bg-delta-up-bg text-delta-up-fg",
        good === false && "bg-delta-down-bg text-delta-down-fg",
        // Neutral metrics (goodDirection "neutral") and flat changes: gray, arrow unchanged.
        good === null && "bg-[#f3f4f6] text-[#4b5563]",
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {text}
    </span>
  );
}
