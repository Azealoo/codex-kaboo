import { promises as fs } from "node:fs";
import path from "node:path";
import { checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget } from "./index";

const UNIT = "codex-kaboo-sync";

/** POSIX-only generator: `path.posix` so the unit directory is byte-identical wherever the tests run (Windows CI included). */
export function systemdDir(homeDir: string): string {
  return path.posix.join(homeDir, ".config", "systemd", "user");
}

/** systemd unit files expand `%` specifiers (`%h`, `%%`, …); double a literal `%` so interpolated values pass through unchanged. */
function systemdEscape(value: string): string {
  return value.replace(/%/g, "%%");
}

export function renderService(target: ScheduleTarget): string {
  const env = ["Environment=CODEX_KABOO_SCHEDULED=1", ...(target.codexHome ? [`Environment=CODEX_HOME=${systemdEscape(target.codexHome)}`] : [])];
  return [
    "[Unit]",
    "Description=codex-kaboo sync",
    "",
    "[Service]",
    "Type=oneshot",
    ...env,
    `ExecStart="${systemdEscape(target.nodePath)}" "${systemdEscape(target.scriptPath)}" ${scheduledArgs().join(" ")}`,
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
