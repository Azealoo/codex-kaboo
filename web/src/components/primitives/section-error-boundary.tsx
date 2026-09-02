"use client";

import { ConvexError } from "convex/values";
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

type Props = { title?: string; children: ReactNode };
type State = { error: Error | null };

function describeError(error: Error): string {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string } | string;
    const code = typeof data === "string" ? data : data.code;
    if (code === "bad_range") return "The selected range is invalid.";
    if (code === "unauthenticated" || code === "user_not_registered") return "Your session expired. Reload the page.";
    if (code === "forbidden") return "You are not allowed to do that.";
    return `Request failed (${code ?? "unknown"}).`;
  }
  // Match the route-level boundary (app/(app)/error.tsx): never render `error.message`/`error.stack`
  // verbatim. This page is shared by three people, and a non-ConvexError (a bug, not our own thrown
  // data) could carry a stack frame, a file path, or another internal detail. The ConvexError codes
  // above are safe because we chose those strings ourselves.
  return "Something went wrong. Try again, or come back later.";
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("section error", error);
  }

  render() {
    if (this.state.error) {
      return (
        <EmptyState
          title={this.props.title ?? "This section could not load"}
          description={describeError(this.state.error)}
          action={
            <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
              Retry
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
