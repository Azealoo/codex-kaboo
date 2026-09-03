import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { kabooPaths } from "@cli/core/paths";
import {
  DEFAULT_SETTINGS,
  MAX_REFRESH_MS,
  MIN_REFRESH_MS,
  normalizeSettings,
  readSettings,
  writeSettings,
} from "../src/main/settings";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tmpPaths() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ck-card-settings-"));
  tmpDirs.push(root);
  return kabooPaths(path.join(root, "kaboo"));
}

describe("normalizeSettings", () => {
  it("returns defaults for anything that is not settings", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    const settings = normalizeSettings({
      version: 1,
      range: "week",
      height: 520,
      refreshMs: 60_000,
      windowMinutes: 10,
      launchAtLogin: true,
      showTrayLabel: true,
    });
    expect(settings).toEqual({
      version: 1,
      range: "week",
      height: 520,
      refreshMs: 60_000,
      windowMinutes: 10,
      launchAtLogin: true,
      showTrayLabel: true,
    });
  });

  it("drops a field that is no longer part of the shape", () => {
    // A key removed in a later version must not come back through a file an older one wrote.
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, theme: "gacha", nested: { a: 1 } });
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it("clamps values a hand-edited file could hold", () => {
    expect(normalizeSettings({ height: 5 }).height).toBe(200);
    expect(normalizeSettings({ height: 99_999 }).height).toBe(4000);
    expect(normalizeSettings({ refreshMs: 10 }).refreshMs).toBe(MIN_REFRESH_MS);
    expect(normalizeSettings({ refreshMs: 999_999_999 }).refreshMs).toBe(MAX_REFRESH_MS);
    expect(normalizeSettings({ windowMinutes: 0 }).windowMinutes).toBe(1);
    // Never wider than the sampler's own 30-minute retention.
    expect(normalizeSettings({ windowMinutes: 120 }).windowMinutes).toBe(30);
  });

  it("falls back on a range that is not a tab, and on wrong types", () => {
    expect(normalizeSettings({ range: "quarter" }).range).toBe(DEFAULT_SETTINGS.range);
    expect(normalizeSettings({ height: "tall" }).height).toBe(DEFAULT_SETTINGS.height);
    expect(normalizeSettings({ launchAtLogin: "yes" }).launchAtLogin).toBe(false);
    expect(normalizeSettings({ refreshMs: Number.NaN }).refreshMs).toBe(DEFAULT_SETTINGS.refreshMs);
  });
});

describe("readSettings / writeSettings", () => {
  it("returns defaults when the file does not exist", async () => {
    expect(await readSettings(tmpPaths())).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips", async () => {
    const paths = tmpPaths();
    await writeSettings(paths, { ...DEFAULT_SETTINGS, range: "month", height: 480 });
    const read = await readSettings(paths);
    expect(read.range).toBe("month");
    expect(read.height).toBe(480);
  });

  it("normalises on the way out as well as in, so the file can never hold nonsense", async () => {
    const paths = tmpPaths();
    await writeSettings(paths, { ...DEFAULT_SETTINGS, height: 10 });
    expect((await readSettings(paths)).height).toBe(200);
  });

  it("survives a corrupt file rather than refusing to start", async () => {
    const paths = tmpPaths();
    await writeSettings(paths, DEFAULT_SETTINGS);
    writeFileSync(paths.cardSettings, "{ half-writ");
    expect(await readSettings(paths)).toEqual(DEFAULT_SETTINGS);
  });
});
