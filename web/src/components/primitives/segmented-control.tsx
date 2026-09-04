"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "sm",
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      aria-label={ariaLabel}
      size={size}
      className={cn(
        "max-w-full overflow-x-auto rounded-lg border border-border bg-muted p-0.5 [scrollbar-width:none]",
        className,
      )}
      onValueChange={(next) => {
        // Radix emits "" when the active item is clicked again; a segmented control is never empty.
        if (next && next !== value) onChange(next as T);
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="shrink-0 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-none"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
