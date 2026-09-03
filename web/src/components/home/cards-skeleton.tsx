import { Skeleton } from "@/components/ui/skeleton";

export function CardsSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div className={className ?? "grid gap-4 md:grid-cols-2 xl:grid-cols-5"} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-28 rounded-lg" />
      ))}
    </div>
  );
}
