export type CsvValue = string | number | boolean | null | undefined;

/**
 * RFC 4180 quoting, plus a guard against spreadsheet formula injection: a cell starting with `=`,
 * `+`, `-`, `@`, tab or CR is prefixed with a single quote so Excel/Sheets show it as text.
 * Model names, project basenames and skill names are user-controlled strings, so this matters.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  // Numbers are data: a negative number must stay a number, so the formula guard is text-only.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Header row + data rows, CRLF-terminated, with a UTF-8 BOM so Excel opens it as UTF-8. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** `codex-kaboo-<name>-<from>_<to>.csv`, safe for every filesystem. */
export function csvFilename(name: string, range?: { from: string; to: string }): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = range ? `-${range.from}_${range.to}` : "";
  return `codex-kaboo-${slug}${suffix}.csv`;
}

/** Triggers a browser download of `text` as `filename`. Browser-only; a no-op without `document`. */
export function downloadCsv(filename: string, text: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been dispatched; some browsers read the URL asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
