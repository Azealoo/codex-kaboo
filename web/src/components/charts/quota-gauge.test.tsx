import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuotaGauge } from "./quota-gauge";

describe("QuotaGauge", () => {
  it("labels the value and colors the arc by threshold", () => {
    const { container } = render(<QuotaGauge usedPercent={42.4} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="gauge-fill"]')).toHaveAttribute("stroke", "#0ca30c");
    expect(screen.getByRole("img", { name: "Weekly quota used: 42%" })).toBeInTheDocument();
  });
  it("turns red at 85% and caps the arc at 100", () => {
    const { container } = render(<QuotaGauge usedPercent={130} />);
    const fill = container.querySelector('[data-testid="gauge-fill"]');
    expect(fill).toHaveAttribute("stroke", "#d03b3b");
    expect(fill).toHaveAttribute("stroke-dasharray", "100 100");
  });

  // Spec: green < 60%, amber 60–85%, red ≥ 85%. Exercise the exact boundary values, since
  // off-by-one errors live there — and colour is never the only channel, so the numeric
  // label must render alongside the colour band at every boundary.
  it.each([
    [0, "#0ca30c", "0%"],
    [60, "#fab219", "60%"],
    [85, "#d03b3b", "85%"],
    [100, "#d03b3b", "100%"],
  ])("at usedPercent=%d picks %s and renders the %s label", (usedPercent, color, label) => {
    const { container } = render(<QuotaGauge usedPercent={usedPercent} />);
    expect(container.querySelector('[data-testid="gauge-fill"]')).toHaveAttribute("stroke", color);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
