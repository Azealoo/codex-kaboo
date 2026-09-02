import os from "node:os";
import path from "node:path";

export interface KabooPaths {
  home: string;
  config: string;
  state: string;
  log: string;
  lock: string;
  launchdLog: string;
  cronLog: string;
  vbs: string;
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** ~/.codex-kaboo (os.homedir honours USERPROFILE on Windows); CODEX_KABOO_HOME overrides. */
export function kabooHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODEX_KABOO_HOME;
  if (override && override.trim().length > 0) return path.resolve(expandHome(override.trim()));
  return path.join(os.homedir(), ".codex-kaboo");
}

export function kabooPaths(home: string = kabooHome()): KabooPaths {
  return {
    home,
    config: path.join(home, "config.json"),
    state: path.join(home, "state.json"),
    log: path.join(home, "sync.log"),
    lock: path.join(home, "sync.lock"),
    launchdLog: path.join(home, "launchd.log"),
    cronLog: path.join(home, "cron.log"),
    vbs: path.join(home, "sync-hidden.vbs"),
  };
}

export function defaultCodexHome(): string {
  return path.join(os.homedir(), ".codex");
}

/** Precedence: --codex-home override → CODEX_HOME → config.codexHomes → ~/.codex. */
export function resolveCodexHomes(
  opts: { override?: string; env?: NodeJS.ProcessEnv; configured?: string[] } = {},
): string[] {
  const env = opts.env ?? process.env;
  let homes: string[];
  if (opts.override && opts.override.trim().length > 0) homes = [opts.override.trim()];
  else if (env.CODEX_HOME && env.CODEX_HOME.trim().length > 0) homes = [env.CODEX_HOME.trim()];
  else if (opts.configured && opts.configured.length > 0) homes = opts.configured;
  else homes = [defaultCodexHome()];
  return Array.from(new Set(homes.map((h) => path.resolve(expandHome(h)))));
}
