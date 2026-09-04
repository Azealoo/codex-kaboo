"use client";

import type { Id } from "@convex/_generated/dataModel";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import { SessionsTable } from "./sessions-table";

export function SessionsTab({ userId }: { userId: Id<"users"> }) {
  return (
    <SectionErrorBoundary title="Sessions could not load">
      <SessionsTable userId={userId} />
    </SectionErrorBoundary>
  );
}
