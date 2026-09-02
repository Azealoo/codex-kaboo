import { ConvexError } from "convex/values";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SectionErrorBoundary } from "./section-error-boundary";

function Throw({ error }: { error: Error }): never {
  throw error;
}

describe("SectionErrorBoundary", () => {
  it("never renders a non-ConvexError's message verbatim, even if it looks safe", () => {
    // Server-supplied data never contains paths, so no leak is proven today — but nothing stops a
    // future bug from throwing an Error whose message does carry one. Match the route-level
    // boundary (app/(app)/error.tsx): a fixed sentence for anything that isn't our own ConvexError.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <SectionErrorBoundary title="Widget could not load">
        <Throw error={new Error("ENOENT: no such file or directory, open '/Users/alice/secret.txt'")} />
      </SectionErrorBoundary>,
    );
    expect(screen.queryByText(/secret\.txt/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ENOENT/)).not.toBeInTheDocument();
    expect(screen.getByText("Something went wrong. Try again, or come back later.")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("still renders our own enumerated ConvexError codes, which are safe because we chose the strings", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <SectionErrorBoundary title="Range could not load">
        <Throw error={new ConvexError({ code: "bad_range" })} />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText("The selected range is invalid.")).toBeInTheDocument();
    spy.mockRestore();
  });
});
