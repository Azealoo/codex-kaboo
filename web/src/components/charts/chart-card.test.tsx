import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Stacked } from "@/lib/chart-data";
import { formatCompact } from "@/lib/format";
import { ChartCard } from "./chart-card";

const stacked: Stacked = {
  series: [
    { key: "s0", label: "Ada", color: "#008300", entity: "u1" },
    { key: "s1", label: "Bob", color: "#2a78d6", entity: "u2" },
  ],
  rows: [
    { x: "2026-09-01", label: "Sep 1", s0: 1000, s1: 500 },
    { x: "2026-09-02", label: "Sep 2", s0: 2000, s1: 0 },
  ],
  peak: { x: "2026-09-02", label: "Sep 2", total: 2000 },
  total: 3500,
};

describe("ChartCard", () => {
  it("shows the peak pill and switches to a table of the same rows", async () => {
    render(
      <ChartCard title="Token usage trend" stacked={stacked} format={formatCompact}>
        <div data-testid="chart" />
      </ChartCard>,
    );
    expect(screen.getByText(/Peak 2K/)).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Table" }));
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Ada" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeInTheDocument();
    expect(screen.getByText("1.5K")).toBeInTheDocument();
  });
  it("renders an empty state when there are no rows", () => {
    render(
      <ChartCard
        title="Empty"
        stacked={{ ...stacked, rows: [], peak: null, total: 0 }}
        format={formatCompact}
      >
        <div data-testid="chart" />
      </ChartCard>,
    );
    expect(screen.getByText("No data in this range")).toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });
  it("keeps a footer visible in both chart and table mode", async () => {
    // The token trend card's "Unpriced: …" caveat must stay visible when the viewer switches to
    // the table — the dollar figures it qualifies are shown there too.
    render(
      <ChartCard
        title="Token trend"
        stacked={stacked}
        format={formatCompact}
        footer={<p>Unpriced: codex-auto-review</p>}
      >
        <div data-testid="chart" />
      </ChartCard>,
    );
    expect(screen.getByText("Unpriced: codex-auto-review")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Table" }));
    expect(screen.getByText("Unpriced: codex-auto-review")).toBeInTheDocument();
  });
});
