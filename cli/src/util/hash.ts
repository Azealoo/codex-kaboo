import { createHash } from "node:crypto";
import type { SessionSummary } from "@codex-kaboo/shared";

/** Recursively sorts object keys, keeps array order, drops `undefined` values. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha1Hex(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Contracts §6: summaryWithoutHash = SessionSummary minus summaryHash, inProgress, lineCount,
// generation, syncedAt. `syncedAt` is not a field of the shared `SessionSummary` type (it is
// added by the Convex `sessions` table) but is listed here too so this stays correct if a wider
// record (e.g. one round-tripped through storage) is ever passed in.
const EXCLUDED_FROM_HASH = ["summaryHash", "inProgress", "lineCount", "generation", "syncedAt"] as const;

/** Contracts §6: sha1 of the canonical JSON of the summary minus volatile fields. */
export function summaryHashOf(summary: Omit<SessionSummary, "summaryHash"> | SessionSummary): string {
  const clone: Record<string, unknown> = { ...summary };
  for (const key of EXCLUDED_FROM_HASH) delete clone[key];
  return sha1Hex(canonicalJson(clone));
}
