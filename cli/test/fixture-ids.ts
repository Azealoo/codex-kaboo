import { fileURLToPath } from "node:url";

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
