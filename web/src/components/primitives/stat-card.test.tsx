import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeltaPill } from "./delta-pill";
import { InlineError } from "./inline-error";
import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("renders label, formatted value and a positive delta pill", () => {
    render(
      <StatCard
        label="Total tokens"
        value={1_234_567}
        kind="tokens"
        change={0.25}
        goodDirection="up"
      />,
    );
    expect(screen.getByText("Total tokens")).toBeInTheDocument();
    expect(screen.getByText("1.2M")).toBeInTheDocument();
    const pill = screen.getByLabelText("+25.0% vs previous period, better");
    expect(pill).toHaveAttribute("data-tone", "up");
    expect(pill).toHaveAttribute("data-good", "true");
  });
  it("lets a long badge wrap instead of overflowing a narrow card", () => {
    // The user page lays these out 7-across, so "Estimated cost" wraps to two lines and the
    // "API list price" badge — `shrink-0 whitespace-nowrap overflow-hidden` by Badge's own
    // variants — was pushed past the card edge and clipped to "API list pri". jsdom does no
    // layout, so the guarantee has to be asserted as the layout contract that prevents it:
    // the row may wrap, and the label may shrink rather than holding the badge out of bounds.
    render(<StatCard label="Estimated cost" value={20.59} badge="API list price" />);
    const badge = screen.getByText("API list price");
    expect(badge.parentElement?.className).toContain("flex-wrap");
    expect(screen.getByText("Estimated cost").className).toContain("min-w-0");
  });
  it("hides the delta when change is null and shows an em dash for null values", () => {
    render(
      <StatCard
        label="Cache hit rate"
        value={null}
        kind="percent"
        change={null}
        goodDirection="up"
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/vs previous/)).not.toBeInTheDocument();
  });
});

describe("DeltaPill", () => {
  it("marks a drop in a lower-is-better metric as good", () => {
    render(<DeltaPill change={-0.1} goodDirection="down" />);
    const pill = screen.getByLabelText("−10.0% vs previous period, better");
    expect(pill).toHaveAttribute("data-tone", "down");
    expect(pill).toHaveAttribute("data-good", "true");
  });
  it("renders a flat pill for zero", () => {
    render(<DeltaPill change={0} goodDirection="up" />);
    expect(screen.getByLabelText("0.0% vs previous period")).toHaveAttribute("data-tone", "flat");
  });
  it("keeps the arrow but passes no verdict for a neutral metric", () => {
    render(<DeltaPill change={0.2} goodDirection="neutral" />);
    const pill = screen.getByLabelText("+20.0% vs previous period");
    expect(pill).toHaveAttribute("data-tone", "up");
    expect(pill).not.toHaveAttribute("data-good");
    expect(pill).toHaveClass("bg-[#f3f4f6]", "text-[#4b5563]");
  });
});

describe("InlineError", () => {
  it("renders the message as an alert", () => {
    render(<InlineError message="Network request failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Network request failed");
  });
  it("renders nothing when there is no message", () => {
    const { container } = render(<InlineError message={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
