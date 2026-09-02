import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { defaultCodexHome, kabooHome, kabooPaths, resolveCodexHomes } from "../../src/core/paths";

describe("paths", () => {
  it("defaults to ~/.codex-kaboo and honours CODEX_KABOO_HOME", () => {
    expect(kabooHome({})).toBe(path.join(os.homedir(), ".codex-kaboo"));
    expect(kabooHome({ CODEX_KABOO_HOME: "/tmp/ck-home" })).toBe(path.resolve("/tmp/ck-home"));
    const p = kabooPaths("/tmp/ck-home");
    expect(p.config).toBe(path.join("/tmp/ck-home", "config.json"));
    expect(p.state).toBe(path.join("/tmp/ck-home", "state.json"));
    expect(p.log).toBe(path.join("/tmp/ck-home", "sync.log"));
    expect(p.lock).toBe(path.join("/tmp/ck-home", "sync.lock"));
    expect(p.vbs).toBe(path.join("/tmp/ck-home", "sync-hidden.vbs"));
  });
  it("resolves codex homes by precedence: override > CODEX_HOME > configured > ~/.codex", () => {
    expect(resolveCodexHomes({ env: {} })).toEqual([defaultCodexHome()]);
    expect(resolveCodexHomes({ env: { CODEX_HOME: "/x/codex" }, configured: ["/y"] })).toEqual([path.resolve("/x/codex")]);
    expect(resolveCodexHomes({ env: {}, configured: ["/y", "/y", "/z"] })).toEqual([path.resolve("/y"), path.resolve("/z")]);
    expect(resolveCodexHomes({ override: "/o", env: { CODEX_HOME: "/x" } })).toEqual([path.resolve("/o")]);
    expect(resolveCodexHomes({ env: {}, configured: ["~/.codex-alt"] })).toEqual([path.join(os.homedir(), ".codex-alt")]);
  });
});
