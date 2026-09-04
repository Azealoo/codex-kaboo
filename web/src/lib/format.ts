/**
 * Formatting lives in `shared/src/format.ts` so the web dashboard and the mobile app render the
 * same number the same way. This module only re-exports it under the path the web code imports.
 */
export * from "@shared/format";
