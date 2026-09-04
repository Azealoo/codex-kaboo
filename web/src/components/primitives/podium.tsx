import Link from "next/link";
import { cn } from "@/lib/utils";
import { AvatarName } from "./avatar-name";

export type PodiumEntry = {
  rank: 1 | 2 | 3;
  name: string;
  imageUrl: string | null;
  color: string;
  value: string;
  sub?: string;
  href?: string;
};

const HEIGHT: Record<1 | 2 | 3, string> = { 1: "h-24", 2: "h-16", 3: "h-12" };

export function Podium({ entries }: { entries: PodiumEntry[] }) {
  const byRank = new Map(entries.map((e) => [e.rank, e]));
  const order: (1 | 2 | 3)[] = [2, 1, 3];
  return (
    <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
      {order.map((rank) => {
        const e = byRank.get(rank);
        if (!e) return <div key={rank} />;
        const body = (
          <div className="flex flex-col items-center gap-2">
            <AvatarName name={e.name} imageUrl={e.imageUrl} color={e.color} size="lg" hideName />
            <span className="max-w-full truncate text-xs font-medium sm:text-sm">{e.name}</span>
            <span className="text-base font-semibold tabular sm:text-lg">{e.value}</span>
            {e.sub ? <span className="text-xs text-muted-foreground">{e.sub}</span> : null}
            <div
              className={cn(
                "flex w-full items-start justify-center rounded-t-lg bg-accent pt-2 text-sm font-semibold text-accent-foreground",
                HEIGHT[rank],
              )}
            >
              #{rank}
            </div>
          </div>
        );
        return e.href ? (
          <Link key={rank} href={e.href} className="block rounded-lg hover:bg-muted/50">
            {body}
          </Link>
        ) : (
          <div key={rank}>{body}</div>
        );
      })}
    </div>
  );
}
