import { fileURLToPath } from "node:url";
import { zstdSupported } from "../src/core/jsonl-reader";

export const FIXTURE_HOME = fileURLToPath(new URL("fixtures/codex-home", import.meta.url));

export const FX = {
  parent: "0199f1c0-0000-7000-8000-0000000000a0",
  paginatedCli: "0199f1c0-0000-7000-8000-0000000000a1",
  execCompaction: "0199f1c0-0000-7000-8000-0000000000a2",
  legacySubagent: "0199f1c0-0000-7000-8000-0000000000a3",
  paginatedSmall: "0199f1c0-0000-7000-8000-0000000000a4",
  partial: "0199f1c0-0000-7000-8000-0000000000b1",
  corrupt: "0199f1c0-0000-7000-8000-0000000000b2",
  future: "0199f1c0-0000-7000-8000-0000000000b3",
  zst: "0199f1c0-0000-7000-8000-0000000000b4",
  forkedRollout: "0199f1c0-0000-7000-8000-0000000000c1",
} as const;

/**
 * The fixture entries the running Node can actually parse, given a way to read each one's
 * sessionId (callers hold different shapes: `PlannedFile.file.sessionId`, `FileReport.sessionId`).
 *
 * `FX.zst` is a `.jsonl.zst` rollout and Node below 22.15 has no `zlib.createZstdDecompress`, so
 * planSync skips it with a one-time warning rather than parsing it. That is deliberate product
 * behaviour, and CI runs Node 20 to keep it exercised — which makes every assertion of the shape
 * "every file came back unchanged" false there, for a reason unrelated to what those tests are
 * about. Filter with this instead of widening the assertion to also accept "skipped": that would
 * stop catching a file which really was skipped by mistake, on every Node.
 */
export function parseableFiles<T>(files: T[], sessionIdOf: (file: T) => string): T[] {
  return zstdSupported() ? files : files.filter((f) => sessionIdOf(f) !== FX.zst);
}
