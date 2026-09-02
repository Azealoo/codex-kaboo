import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteConfig, readConfig, writeConfig } from "../../src/core/config";
import { kabooPaths } from "../../src/core/paths";
import type { Config } from "../../src/types";

const config: Config = {
  server: "https://example.convex.site",
  token: "ck_test",
  machineId: "m-1",
  label: "brisk-otter",
  hostnameOptIn: false,
  codexHomes: [],
  userId: "u1",
  userName: "Ada",
  userEmail: null,
  tokenName: "laptop",
  loggedInAt: 1,
};

// Temp dirs are tracked and removed in afterEach so failed runs don't litter os.tmpdir().
const tmpDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ck-cfg-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("config", () => {
  it("round-trips through an atomic 0600 file and returns null when missing", async () => {
    const paths = kabooPaths(path.join(tempDir(), "home"));
    expect(await readConfig(paths)).toBeNull();
    await writeConfig(paths, config);
    expect(await readConfig(paths)).toEqual(config);
    expect(readdirSync(paths.home).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    if (process.platform !== "win32") expect(statSync(paths.config).mode & 0o777).toBe(0o600);
    expect(await deleteConfig(paths)).toBe(true);
    expect(await deleteConfig(paths)).toBe(false);
    expect(await readConfig(paths)).toBeNull();
  });
  it("rejects incomplete configs and throws on corrupt JSON", async () => {
    const paths = kabooPaths(tempDir());
    writeFileSync(paths.config, JSON.stringify({ server: "x" }));
    expect(await readConfig(paths)).toBeNull();
    writeFileSync(paths.config, "{not json");
    await expect(readConfig(paths)).rejects.toThrow(/not valid JSON/);
  });
});
