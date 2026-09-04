/**
 * Range resolution lives in `shared/src/range.ts` so the mobile app resolves "Last 30 days" to the
 * exact same `[from, to]` the web does. This module only re-exports it.
 */
export * from "@shared/range";
