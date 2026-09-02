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
});
