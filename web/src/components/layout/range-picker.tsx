"use client";

import { CalendarIcon, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRange } from "@/hooks/use-range";
import { localDay } from "@/hooks/use-today";
import { formatDay } from "@/lib/format";
import { PRESETS, isCustom, presetLabel, type Preset } from "@/lib/range";
import { cn } from "@/lib/utils";

function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function RangePicker() {
  const { params, resolved, today, setPreset, setCustom } = useRange();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const custom = isCustom(params);
  const label = resolved?.label ?? (custom ? "Custom range" : presetLabel(params.range));
  const todayDate = today ? dayToDate(today) : undefined;
  const canApply = draft?.from !== undefined && draft?.to !== undefined;

  const choosePreset = (preset: Preset) => {
    setPreset(preset);
    setOpen(false);
  };

  const apply = () => {
    if (!draft?.from || !draft.to) return;
    setCustom(localDay(draft.from), localDay(draft.to));
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDraft(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full font-medium" aria-label="Change date range">
          <CalendarIcon className="size-3.5" aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex">
          <ul role="listbox" aria-label="Presets" className="w-44 border-r border-border p-1">
            {PRESETS.map((preset) => {
              const selected = !custom && params.range === preset;
              return (
                <li key={preset}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => choosePreset(preset)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                      selected && "font-semibold",
                    )}
                  >
                    {presetLabel(preset)}
                    {selected ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-2 p-2">
            <p className="px-1 text-xs font-medium text-muted-foreground">Custom range (up to 400 days)</p>
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={todayDate}
              disabled={todayDate ? { after: todayDate } : undefined}
            />
            <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">
                {draft?.from ? formatDay(localDay(draft.from)) : "Pick a start day"}
                {draft?.to ? ` – ${formatDay(localDay(draft.to))}` : ""}
              </span>
              <Button size="sm" disabled={!canApply} onClick={apply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
