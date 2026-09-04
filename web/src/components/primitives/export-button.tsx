"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, toCsv, type CsvValue } from "@/lib/csv";

export type CsvTable = { headers: string[]; rows: CsvValue[][] };

/** A quiet "Export CSV" control; `table` is built lazily so idle renders cost nothing. */
export function ExportButton({
  filename,
  table,
  disabled,
}: {
  filename: string;
  table: () => CsvTable;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="text-muted-foreground"
      disabled={disabled}
      aria-label={`Export ${filename}`}
      title="Export as CSV"
      onClick={() => {
        const t = table();
        downloadCsv(filename, toCsv(t.headers, t.rows));
      }}
    >
      <Download aria-hidden="true" />
      CSV
    </Button>
  );
}
