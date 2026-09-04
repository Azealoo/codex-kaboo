import type { KeyboardEvent, ReactNode } from "react";
import type { CsvValue } from "@/lib/csv";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { BarCell, type BarScale } from "./bar-cell";
import { ExportButton } from "./export-button";

export type HideBelow = "sm" | "md" | "lg";

export type Column<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  bar?: (row: T) => number;
  width?: string;
  /**
   * The cell's value for a CSV export. Falls back to `render` when that returns a plain string or
   * number; a column whose `render` returns markup and that has no `csv` is left out of the export.
   */
  csv?: (row: T) => CsvValue;
  /**
   * Hide this column on viewports narrower than the breakpoint. A phone cannot show an eleven-column
   * table, so each table names the columns it can live without there; the row's detail view (where
   * one exists) still carries every value.
   */
  hideBelow?: HideBelow;
};

const HIDE_CLASS: Record<HideBelow, string> = {
  sm: "max-sm:hidden",
  md: "max-md:hidden",
  lg: "max-lg:hidden",
};

export function hideBelowClass(hideBelow: HideBelow | undefined): string | undefined {
  return hideBelow ? HIDE_CLASS[hideBelow] : undefined;
}

function csvValueOf<T>(column: Column<T>, row: T): CsvValue | undefined {
  if (column.csv) return column.csv(row);
  const rendered = column.render(row);
  return typeof rendered === "string" || typeof rendered === "number" ? rendered : undefined;
}

/** The table as CSV headers + rows: every column that can produce a text value, in display order. */
export function tableToCsv<T>(
  columns: Column<T>[],
  rows: T[],
): { headers: string[]; rows: CsvValue[][] } {
  const exportable = columns.filter(
    (c) => c.csv !== undefined || rows.some((r) => csvValueOf(c, r) !== undefined),
  );
  return {
    headers: exportable.map((c) => c.header),
    rows: rows.map((r) => exportable.map((c) => csvValueOf(c, r) ?? null)),
  };
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  scale = "linear",
  emptyLabel = "No data in this range",
  onRowClick,
  rowLabel,
  barColor,
  exportFilename,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  scale?: BarScale;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
  /**
   * Accessible name for a clickable row, used as `aria-label` on the row when `onRowClick` is set.
   * A consumer that wires `onRowClick` should always supply this (e.g. the row's subject name) —
   * without it a keyboard/screen-reader user can activate the row but has no announced name for it.
   */
  rowLabel?: (row: T) => string;
  barColor?: (row: T) => string;
  /** When set, an "Export CSV" control appears above the table and downloads `rows` as this file. */
  exportFilename?: string;
}) {
  const maxima = new Map<string, number>();
  for (const c of columns) {
    const bar = c.bar;
    if (bar)
      maxima.set(
        c.key,
        rows.reduce((m, r) => Math.max(m, bar(r)), 0),
      );
  }
  return (
    <div className="flex flex-col gap-1">
      {exportFilename ? (
        <div className="flex justify-end">
          <ExportButton
            filename={exportFilename}
            disabled={rows.length === 0}
            table={() => tableToCsv(columns, rows)}
          />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(
                    "text-xs",
                    c.align === "right" && "text-right",
                    hideBelowClass(c.hideBelow),
                  )}
                >
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const handleKeyDown = onRowClick
                  ? (event: KeyboardEvent<HTMLTableRowElement>) => {
                      if (event.key === "Enter") {
                        onRowClick(row);
                      } else if (event.key === " ") {
                        // Match native button behaviour: Space activates but must not scroll the page.
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined;
                return (
                  <TableRow
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={handleKeyDown}
                    role={onRowClick ? "button" : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-label={onRowClick ? rowLabel?.(row) : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn(
                          "text-sm",
                          c.align === "right" && "text-right font-mono tabular",
                          hideBelowClass(c.hideBelow),
                        )}
                      >
                        {c.bar ? (
                          <BarCell
                            value={c.bar(row)}
                            max={maxima.get(c.key) ?? 0}
                            scale={scale}
                            color={barColor?.(row)}
                          >
                            {c.render(row)}
                          </BarCell>
                        ) : (
                          c.render(row)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
