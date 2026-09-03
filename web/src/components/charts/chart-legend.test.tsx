import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SeriesDef } from "@/lib/chart-data";
import { ChartLegend } from "./chart-legend";

const series: SeriesDef[] = [
  { key: "s0", label: "Ada", color: "#008300", entity: "u1" },
  { key: "s1", label: "Bob", color: "#2a78d6", entity: "u2" },
  { key: "s2", label: "Cara", color: "#eb6834", entity: "u3" },
];

describe("ChartLegend", () => {
  it("renders one entry per series with its assigned color", () => {
    render(<ChartLegend series={series} />);
    const list = screen.getByRole("list", { name: "Legend" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(series.length);
    items.forEach((item, i) => {
      expect(item).toHaveTextContent(series[i]!.label);
      expect(item.querySelector("span")).toHaveStyle({ backgroundColor: series[i]!.color });
    });
  });

  it("renders nothing for fewer than two series", () => {
    const { container } = render(<ChartLegend series={[series[0]!]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
