"use client";

import { useRange } from "@/hooks/use-range";
import { cn } from "@/lib/utils";

/**
 * `resolveRange` substitutes the default preset whenever a `?from`/`?to` pair cannot be honoured —
 * an unparseable day, `from` after `to`, or a span past the 400-day cap. Doing that silently leaves
 * the user reading a range they did not ask for, with the URL still showing the one they did: every
 * number on the page is then an answer to a different question. This says so, next to the numbers.
 */
export function InvalidRangeNotice({ className }: { className?: string }) {
  const { resolved } = useRange();
  if (resolved?.invalidCustom !== true) return null;
  return (
    <p
      role="status"
      className={cn(
        "rounded-xl border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-foreground",
        className,
      )}
    >
      <span className="font-medium">That date range could not be used</span>, so this is{" "}
      {resolved.label.toLowerCase()} instead. Ranges must be real dates, start on or before they
      end, and cover at most 400 days.
    </p>
  );
}
