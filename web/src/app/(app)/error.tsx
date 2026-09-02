"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/primitives/empty-state";
import { Button } from "@/components/ui/button";

/**
 * Route-group backstop for `(app)/**`: catches anything a page-level query throws (e.g.
 * `stats.summary`'s `ConvexError({code:"range_too_large"})`) that no section-level
 * `SectionErrorBoundary` already contains. This page is shared by three people, so never render
 * `error.message` or `error.stack` verbatim — a ConvexError payload can carry field values. Show
 * a fixed sentence; surface only `error.digest`, which identifies the error without describing it.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("route error", error);
  }, [error]);
  return (
    <EmptyState
      title="This page could not load"
      description={
        error.digest
          ? `Something went wrong. If it keeps happening, share this reference: ${error.digest}`
          : "Something went wrong. Try again, or come back later."
      }
      action={
        <Button variant="outline" size="sm" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
