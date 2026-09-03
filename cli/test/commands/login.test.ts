import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeServer, runLogin, type LoginDeps } from "../../src/commands/login";
import { runLogout } from "../../src/commands/logout";
import { readConfig } from "../../src/core/config";
import { kabooPaths } from "../../src/core/paths";
import { emptyState, writeState } from "../../src/core/state";
import type { SyncClient } from "../../src/upload/client";
import { silentLogger } from "../../src/util/log";

function deps(overrides: Partial<LoginDeps> = {}): LoginDeps {
  const paths = kabooPaths(path.join(mkdtempSync(path.join(os.tmpdir(), "ck-login-")), "home"));
  let ids = 0;
  const client: SyncClient = {
    async whoami() {
      return {
        ok: true,
        userId: "u1",
        name: "Ada",
        email: "ada@example.com",
        token: { name: "laptop", prefix: "ck_abc123" },
        serverTime: 7,
      };
    },
    async sync() {
      throw new Error("unused");
    },
    async summary() {
      throw new Error("unused");
    },
    async health() {
      return { ok: true, serverTime: 7 };
    },
  };
  return {
    paths,
    env: {},
    bakedServer: "https://baked.convex.site",
    cliVersion: "0.1.0",
    prompt: async () => "ck_prompted",
    createClient: () => client,
    newId: () => `machine-${++ids}`,
    now: () => 1234,
    log: silentLogger,
    ...overrides,
  };
}
// `hostname: undefined` means "neither --hostname nor --no-hostname was passed" — the tri-state
// commander produces for a negatable pair. Individual tests override it with true/false.
const base = { hostname: undefined, json: false };

describe("runLogin", () => {
  it("writes a 0600 config with a fresh machine id and a random label, then keeps both", async () => {
    const d = deps();
    const first = await runLogin({ ...base, token: "ck_first" }, d);
    expect(first).toMatchObject({
      ok: true,
      exitCode: 0,
      server: "https://baked.convex.site",
      machineId: "machine-1",
      user: { userId: "u1", name: "Ada" },
      token: { name: "laptop", prefix: "ck_abc123" },
    });
    expect(first.label).toMatch(/^[a-z]+-[a-z]+$/);
    const config = await readConfig(d.paths);
    expect(config).toMatchObject({
      server: "https://baked.convex.site",
      token: "ck_first",
      machineId: "machine-1",
      hostnameOptIn: false,
      userName: "Ada",
      userEmail: "ada@example.com",
      tokenName: "laptop",
      loggedInAt: 1234,
    });
    if (process.platform !== "win32") expect(statSync(d.paths.config).mode & 0o777).toBe(0o600);
    const second = await runLogin({ ...base, token: "ck_second", hostname: true }, d);
    expect(second.machineId).toBe("machine-1");
    expect(second.label).toBe(first.label);
    expect((await readConfig(d.paths))?.hostnameOptIn).toBe(true);
    expect((await readConfig(d.paths))?.token).toBe("ck_second");
    const renamed = await runLogin({ ...base, token: "ck_third", machineName: "work-laptop" }, d);
    expect(renamed.label).toBe("work-laptop");
    expect((await readConfig(d.paths))?.hostnameOptIn).toBe(true); // sticky
  });
  it("resolves hostname opt-in explicitly: --hostname sets it, --no-hostname clears it, neither flag preserves it", async () => {
    const d = deps();
    await runLogin({ ...base, token: "ck_a", hostname: true }, d);
    expect((await readConfig(d.paths))?.hostnameOptIn).toBe(true);

    // A bare re-login (neither flag passed) must not silently reset a chosen opt-in.
    await runLogin({ ...base, token: "ck_b" }, d);
    expect((await readConfig(d.paths))?.hostnameOptIn).toBe(true);

    // --no-hostname is the only way back short of `logout`.
    await runLogin({ ...base, token: "ck_c", hostname: false }, d);
    expect((await readConfig(d.paths))?.hostnameOptIn).toBe(false);

    // Once cleared, a bare re-login keeps it cleared — sticky in both directions.
    await runLogin({ ...base, token: "ck_d" }, d);
    expect((await readConfig(d.paths))?.hostnameOptIn).toBe(false);
  });
  it("prompts for the token, prefers --server, then the env, then the baked server", async () => {
    const d0 = deps();
    const prompted = await runLogin(base, d0);
    expect(prompted.ok).toBe(true);
    expect((await readConfig(d0.paths))?.token).toBe("ck_prompted");
    const d = deps({ env: { CODEX_KABOO_SERVER: "https://env.convex.site/" } });
    expect((await runLogin({ ...base, token: "ck_x" }, d)).server).toBe("https://env.convex.site");
    expect(
      (await runLogin({ ...base, token: "ck_x", server: "https://flag.convex.site" }, d)).server,
    ).toBe("https://flag.convex.site");
    const none = await runLogin({ ...base, token: "ck_x" }, deps({ bakedServer: undefined }));
    expect(none.exitCode).toBe(2);
    expect(none.error).toContain("--server");
    expect(normalizeServer("https://a.convex.site///")).toBe("https://a.convex.site");
    expect(normalizeServer("a.convex.site")).toBeNull();
  });
  it("rejects bad tokens without writing anything and keeps the old config when whoami fails", async () => {
    const d = deps();
    const bad = await runLogin({ ...base, token: "nope" }, d);
    expect(bad.exitCode).toBe(2);
    expect(existsSync(d.paths.config)).toBe(false);
    await runLogin({ ...base, token: "ck_good" }, d);
    const failing = deps({
      paths: d.paths,
      createClient: () => ({
        async whoami() {
          throw new Error("401 unauthorized");
        },
        async sync() {
          throw new Error("x");
        },
        async summary() {
          throw new Error("unused");
        },
        async health() {
          return { ok: false, serverTime: null };
        },
      }),
    });
    const rejected = await runLogin({ ...base, token: "ck_new" }, failing);
    expect(rejected.exitCode).toBe(2);
    expect(rejected.error).toContain("401");
    expect((await readConfig(d.paths))?.token).toBe("ck_good");
  });
});

describe("runLogout", () => {
  it("removes config.json but keeps state.json", async () => {
    const d = deps();
    await runLogin({ ...base, token: "ck_good" }, d);
    await writeState(d.paths, emptyState());
    expect(await runLogout({ paths: d.paths, log: silentLogger })).toEqual({
      ok: true,
      exitCode: 0,
      removed: true,
    });
    expect(existsSync(d.paths.config)).toBe(false);
    expect(existsSync(d.paths.state)).toBe(true);
    expect((await runLogout({ paths: d.paths, log: silentLogger })).removed).toBe(false);
  });
});
