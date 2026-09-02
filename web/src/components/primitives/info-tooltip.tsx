import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Self-contained provider: nothing in the app wraps a `TooltipProvider` at the root (checked
// src/app/layout.tsx and src/app/providers.tsx), so every Radix `Tooltip.Root` needs one in its
// own ancestry or it throws "must be used within TooltipProvider". `TooltipProvider`'s
// `delayDuration` already defaults to 0, so nesting one per icon costs nothing behaviourally.
export function InfoTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="How to read this data">
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
