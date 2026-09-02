import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TooltipContentProps } from "recharts";
import type { SeriesDef } from "@/lib/chart-data";
import { formatCompact } from "@/lib/format";
import { SeriesTooltip } from "./series-tooltip";

const series: SeriesDef[] = [
  { key: "s0", label: "Ada", color: "#008300", entity: "u1" },
  { key: "s1", label: "Bob", color: "#2a78d6", entity: "u2" },
  { key: "s2", label: "Cara", color: "#eb6834", entity: "u3" },
];

function payloadFor(
  values: Record<string, number>,
): TooltipContentProps<number, string>["payload"] {
  return Object.entries(values).map(([dataKey, value]) => ({
    dataKey,
    value,
    graphicalItemId: dataKey,
  }));
}

describe("SeriesTooltip", () => {
  it("lists every series sorted descending by value with a Total row", () => {
    render(
      <SeriesTooltip
        active
        label="Sep 1"
        payload={payloadFor({ s0: 500, s1: 1500, s2: 900 })}
        series={series}
        format={formatCompact}
      />,
    );
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Bob");
    expect(rows[0]).toContain("1.5K");
    expect(rows[1]).toContain("Cara");
    expect(rows[1]).toContain("900");
    expect(rows[2]).toContain("Ada");
    expect(rows[2]).toContain("500");
    const total = screen.getByText("Total").closest("p");
    expect(total).toHaveTextContent("2.9K");
  });

  it("omits the Total row when only one series is present", () => {
    render(
      <SeriesTooltip
        active
        label="Sep 1"
        payload={payloadFor({ s0: 500 })}
        series={series}
        format={formatCompact}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });

  it("renders nothing when inactive", () => {
    const { container } = render(
      <SeriesTooltip
        active={false}
        label="Sep 1"
        payload={payloadFor({ s0: 500 })}
        series={series}
        format={formatCompact}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
