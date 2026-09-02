import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { barWidth } from "./bar-cell";
import { DataTable, type Column } from "./data-table";

type Row = { id: string; name: string; tokens: number };
const rows: Row[] = [
  { id: "a", name: "Ada", tokens: 1000 },
  { id: "b", name: "Bob", tokens: 10 },
];
const columns: Column<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  {
    key: "tokens",
    header: "Tokens",
    align: "right",
    render: (r) => String(r.tokens),
    bar: (r) => r.tokens,
  },
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
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyLabel="No data in this range"
      />,
    );
    expect(screen.getByText("No data in this range")).toBeInTheDocument();
  });
});

describe("DataTable keyboard accessibility", () => {
  it("makes a clickable row focusable and fires onRowClick exactly once for Enter and once for Space", async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        rowLabel={(r) => r.name}
      />,
    );
    const adaRow = screen.getByRole("button", { name: "Ada" });
    expect(adaRow).toHaveAttribute("tabindex", "0");
    adaRow.focus();
    expect(adaRow).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenNthCalledWith(1, rows[0]);

    const bobRow = screen.getByRole("button", { name: "Bob" });
    bobRow.focus();
    await userEvent.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenNthCalledWith(2, rows[1]);
  });

  it("keeps a plain, non-interactive row when onRowClick is not set", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByRole("button", { name: "Ada" })).not.toBeInTheDocument();
    const row = screen.getByText("Ada").closest("tr");
    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
  });
});
