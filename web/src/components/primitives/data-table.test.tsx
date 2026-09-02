import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { barWidth } from "./bar-cell";
import { DataTable, type Column } from "./data-table";

type Row = { id: string; name: string; tokens: number };
const rows: Row[] = [
  { id: "a", name: "Ada", tokens: 1000 },
  { id: "b", name: "Bob", tokens: 10 },
];
const columns: Column<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "tokens", header: "Tokens", align: "right", render: (r) => String(r.tokens), bar: (r) => r.tokens },
];

describe("barWidth", () => {
  it("is linear by default and log10(v+1) when asked", () => {
    expect(barWidth(10, 1000, "linear")).toBeCloseTo(0.01);
    expect(barWidth(10, 1000, "log")).toBeCloseTo(Math.log10(11) / Math.log10(1001));
    expect(barWidth(0, 0, "linear")).toBe(0);
    expect(barWidth(5, 1000, "linear")).toBeCloseTo(0.005);
  });
});

describe("DataTable", () => {
  it("renders headers, rows and bar widths", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} scale="linear" />);
    expect(screen.getByRole("columnheader", { name: "Tokens" })).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    const bars = screen.getAllByTestId("bar-fill");
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "1%" });
  });
  it("shows the empty label when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyLabel="No data in this range" />);
    expect(screen.getByText("No data in this range")).toBeInTheDocument();
  });
});
