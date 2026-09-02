import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../../src/util/log";

describe("createLogger", () => {
  it("writes timestamped lines to the file and honours quiet/verbose on the console", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ck-log-"));
    const file = path.join(dir, "nested", "sync.log");
    const lines: string[] = [];
    const log = createLogger({ file, quiet: true, console: (l) => lines.push(l), now: () => Date.UTC(2026, 8, 1, 12) });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines).toEqual(["2026-09-01T12:00:00.000Z WARN w", "2026-09-01T12:00:00.000Z ERROR e"]);
    const content = readFileSync(file, "utf8");
    expect(content).toBe(
      "2026-09-01T12:00:00.000Z DEBUG d\n2026-09-01T12:00:00.000Z INFO i\n2026-09-01T12:00:00.000Z WARN w\n2026-09-01T12:00:00.000Z ERROR e\n",
    );
    const loud: string[] = [];
    const log2 = createLogger({ console: (l) => loud.push(l), verbose: true, now: () => 0 });
    log2.debug("x");
    log2.info("y");
    expect(loud).toEqual(["1970-01-01T00:00:00.000Z DEBUG x", "1970-01-01T00:00:00.000Z INFO y"]);
  });
  it("rotates the file to .1 when it reaches maxBytes", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ck-log-"));
    const file = path.join(dir, "sync.log");
    const log = createLogger({ file, quiet: true, console: () => {}, maxBytes: 120, now: () => 0 });
    for (let i = 0; i < 10; i++) log.info(`line number ${i} padding padding padding`);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(statSync(file).size).toBeLessThan(200);
  });
});
