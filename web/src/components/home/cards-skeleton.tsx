import { Skeleton } from "@/components/ui/skeleton";

export function CardsSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div
      className={className ?? "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5"}
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-28 rounded-lg" />
      ))}
    </div>
  );
}
