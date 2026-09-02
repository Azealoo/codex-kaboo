/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function AvatarName({
  name,
  imageUrl,
  color,
  size = "sm",
  hideName = false,
}: {
  name: string;
  imageUrl: string | null;
  color?: string;
  size?: "sm" | "lg";
  hideName?: boolean;
}) {
  const dim = size === "lg" ? "size-12 text-base" : "size-6 text-[10px]";
  const ring = color ? { boxShadow: `0 0 0 2px ${color}` } : undefined;
  return (
    <span className="inline-flex items-center gap-2">
      {imageUrl ? (
        <img src={imageUrl} alt="" className={cn("rounded-full object-cover", dim)} style={ring} />
      ) : (
        <span
          className={cn("inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground", dim)}
          style={ring}
          aria-hidden="true"
        >
          {initials(name) || "?"}
        </span>
      )}
      {hideName ? <span className="sr-only">{name}</span> : <span className="truncate text-sm">{name}</span>}
    </span>
  );
}
