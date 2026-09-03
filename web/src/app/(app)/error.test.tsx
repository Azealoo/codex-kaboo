import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AppError from "./error";

// Next.js mounts error.tsx itself on a thrown error; that mounting isn't unit-testable here.
// This only checks the component's own contract: a fixed message, and `reset` wired to the button.
describe("app error boundary", () => {
  it("shows a fixed human message and never renders the raw error text", () => {
    const error = Object.assign(
      new Error('ConvexError: {"code":"range_too_large","userId":"secret-id"}'),
      {
        digest: "abc123",
      },
    );
    render(<AppError error={error} reset={() => {}} />);
    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
    expect(screen.queryByText(/range_too_large/)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret-id/)).not.toBeInTheDocument();
  });

  it("calls reset when Try again is clicked", async () => {
    const reset = vi.fn();
    render(<AppError error={new Error("boom")} reset={reset} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
