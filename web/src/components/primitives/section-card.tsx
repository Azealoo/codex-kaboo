import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./info-tooltip";

export function SectionCard({
  title,
  description,
  help,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  help?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("gap-3 rounded-xl border-border p-4 shadow-none", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            {title}
            {help ? <InfoTooltip text={help} /> : null}
          </h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}
