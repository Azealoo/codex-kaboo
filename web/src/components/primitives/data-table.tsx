import type { KeyboardEvent, ReactNode } from "react";
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

export type Column<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  bar?: (row: T) => number;
  width?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  scale = "linear",
  emptyLabel = "No data in this range",
  onRowClick,
  rowLabel,
  barColor,
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
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cn("text-xs", c.align === "right" && "text-right")}
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
  );
}
