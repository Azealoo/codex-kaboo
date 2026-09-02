import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MIN_NODE_MAJOR } from "@codex-kaboo/shared";
import { describe, expect, it } from "vitest";

/**
 * The published floor and the floor `doctor` enforces have to be the same number: npm refuses an
 * install below `engines.node`, so a `doctor` that passes underneath it blesses an install that
 * cannot happen. Both now read MIN_NODE_MAJOR; this pins the one copy that cannot import it.
 */
describe("cli engines", () => {
  it("declares the shared Node floor in package.json", () => {
    const path = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(path, "utf8")) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe(`>=${MIN_NODE_MAJOR}`);
  });
});
