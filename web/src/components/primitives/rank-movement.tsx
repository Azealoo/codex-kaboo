import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function RankMovement({
  rank,
  previousRank,
}: {
  rank: number;
  previousRank: number | null;
}) {
  if (previousRank === null) {
    return <span className="text-xs text-muted-foreground">new</span>;
  }
  const delta = previousRank - rank;
  if (delta === 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
        aria-label="No rank change"
      >
        <Minus className="size-3" aria-hidden="true" />
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular",
        up ? "text-delta-up-fg" : "text-delta-down-fg",
      )}
      aria-label={up ? `Up ${delta} places` : `Down ${-delta} places`}
    >
      {up ? (
        <ArrowUp className="size-3" aria-hidden="true" />
      ) : (
        <ArrowDown className="size-3" aria-hidden="true" />
      )}
      {Math.abs(delta)}
    </span>
  );
}
