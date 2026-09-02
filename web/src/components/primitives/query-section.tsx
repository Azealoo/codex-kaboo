"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SectionCard } from "./section-card";

export function QuerySection<T>({
  title,
  info,
  description,
  actions,
  data,
  isStale,
  bodyClassName,
  skeletonClassName = "h-48",
  children,
}: {
  title: string;
  info?: string;
  /** A plain string, or one derived from the loaded data. */
  description?: string | ((data: T) => string);
  actions?: ReactNode;
  data: T | undefined;
  isStale: boolean;
  bodyClassName?: string;
  skeletonClassName?: string;
  children: (data: T) => ReactNode;
}) {
  const resolvedDescription =
    typeof description === "function"
      ? data === undefined
        ? undefined
        : description(data)
      : description;
  return (
    <SectionCard
      title={title}
      description={resolvedDescription}
      help={info}
      actions={actions}
      bodyClassName={cn(bodyClassName, isStale && "opacity-60 transition-opacity")}
    >
      {data === undefined ? <Skeleton className={skeletonClassName} /> : children(data)}
    </SectionCard>
  );
}
