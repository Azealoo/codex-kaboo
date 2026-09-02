import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricStatCard } from "./metric-stat-card";

describe("MetricStatCard", () => {
  it("uses the metric definition for label, formatting and polarity", () => {
    render(<MetricStatCard metricKey="ttftP50Ms" metric={{ current: 1500, previous: 2000, change: -0.25 }} />);
    expect(screen.getByText("TTFT median")).toBeInTheDocument();
    expect(screen.getByText("1s")).toBeInTheDocument();
    expect(screen.getByLabelText("−25.0% vs previous period, better")).toBeInTheDocument();
  });
  it("hides the delta when there is no previous period", () => {
    render(<MetricStatCard metricKey="totalTokens" metric={{ current: 5_000_000, previous: null, change: null }} />);
    expect(screen.getByText("5M")).toBeInTheDocument();
    expect(screen.queryByText(/vs previous/)).not.toBeInTheDocument();
  });
});
