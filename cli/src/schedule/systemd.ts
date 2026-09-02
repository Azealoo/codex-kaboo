import { promises as fs } from "node:fs";
import path from "node:path";
import { assertNoNewline, checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget } from "./index";

const UNIT = "codex-kaboo-sync";

/** POSIX-only generator: `path.posix` so the unit directory is byte-identical wherever the tests run (Windows CI included). */
export function systemdDir(homeDir: string): string {
  return path.posix.join(homeDir, ".config", "systemd", "user");
}

/**
 * Escapes one value for the inside of a double-quoted systemd unit token. No shell is involved
 * (systemd execs directly, so `$(…)` and backticks are inert), but the unit parser has three
 * rewrites of its own that a raw path can trip:
 *
 *  - `%` introduces a specifier (`%h`, `%i`, …), so a literal one is written `%%`.
 *  - inside double quotes, C-style escapes are processed, so a literal `\` is `\\` and a literal
 *    `"` is `\"` — previously neither was escaped, and a path containing a backslash or a quote
 *    silently mis-parsed the whole ExecStart line.
 *
 * Backslash first, so the backslashes this function itself introduces are not doubled again.
 *
 * A `\n` or `\r` inside `value` is refused rather than escaped: a systemd unit is one directive
 * per line, parsed *before* this escaping has any effect, so an embedded newline cannot be quoted
 * into safety — see `assertNoNewline`.
 */
function systemdEscape(value: string): string {
  assertNoNewline(value, "a systemd unit");
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
}

/**
 * As above, plus `$` → `$$`: systemd expands `$VAR` / `${VAR}` in an ExecStart command line from
 * the unit's own environment, so an unescaped `$` in a path substituted a variable (usually an
 * empty one) instead of reaching the process. `Environment=` values are NOT expanded this way —
 * systemd documents `Environment="VAR3=$word 5 6"` as yielding a literal `$word` — so they use
 * `systemdEscape` and doubling `$` there would corrupt the value.
 */
function systemdExecEscape(value: string): string {
  return systemdEscape(value).replace(/\$/g, "$$$$"); // "$$$$" is a literal "$$" ($$ escapes $ in a replacement)
}

export function renderService(target: ScheduleTarget): string {
  // The whole NAME=value assignment is quoted, per systemd's own `Environment="VAR1=word1 word2"`
  // example: unquoted, a value containing a space would be split into extra assignments.
  const env = [
    "Environment=CODEX_KABOO_SCHEDULED=1",
    ...(target.codexHome ? [`Environment="CODEX_HOME=${systemdEscape(target.codexHome)}"`] : []),
  ];
  return [
    "[Unit]",
    "Description=codex-kaboo sync",
    "",
    "[Service]",
    "Type=oneshot",
    ...env,
    `ExecStart="${systemdExecEscape(target.nodePath)}" "${systemdExecEscape(target.scriptPath)}" ${scheduledArgs().join(" ")}`,
    "",
  ].join("\n");
}

export function renderTimer(): string {
  return [
    "[Unit]",
    "Description=codex-kaboo sync every 15 minutes",
    "",
    "[Timer]",
    "OnBootSec=2min",
    "OnUnitActiveSec=15min",
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

export const systemdAdapter: SchedulerAdapter = {
  name: "systemd",
  async install(target, spawner) {
    const dir = systemdDir(target.homeDir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${UNIT}.service`), renderService(target), "utf8");
    await fs.writeFile(path.join(dir, `${UNIT}.timer`), renderTimer(), "utf8");
    const reload = await spawner.run("systemctl", ["--user", "daemon-reload"]);
    if (reload.code !== 0) throw new Error(`systemctl --user daemon-reload failed: ${reload.stderr.trim()}`);
    const enable = await spawner.run("systemctl", ["--user", "enable", "--now", `${UNIT}.timer`]);
    if (enable.code !== 0) throw new Error(`systemctl --user enable failed: ${enable.stderr.trim()}`);
    return `systemd user timer ${UNIT}.timer enabled (every 15 minutes)`;
  },
  async uninstall(target, spawner) {
    const dir = systemdDir(target.homeDir);
    await spawner.run("systemctl", ["--user", "disable", "--now", `${UNIT}.timer`]);
    await fs.rm(path.join(dir, `${UNIT}.service`), { force: true });
    await fs.rm(path.join(dir, `${UNIT}.timer`), { force: true });
    await spawner.run("systemctl", ["--user", "daemon-reload"]);
    return `systemd user timer ${UNIT}.timer removed`;
  },
  async status(target, spawner) {
    const active = await spawner.run("systemctl", ["--user", "is-active", `${UNIT}.timer`]);
    if (active.code !== 0) return { installed: false, healthy: false, detail: `timer not active (${active.stdout.trim() || active.stderr.trim() || "unknown"})` };
    const missing = await checkTargetPaths(target);
    if (missing.length > 0) return { installed: true, healthy: false, detail: `schedule broken: missing ${missing.join(", ")}; run \`codex-kaboo install --systemd\` again` };
    return { installed: true, healthy: true, detail: "timer active" };
  },
};
