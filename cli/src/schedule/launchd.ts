import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SCHEDULE_INTERVAL_SECONDS,
  checkTargetPaths,
  scheduledArgs,
  type SchedulerAdapter,
  type ScheduleTarget,
} from "./index";

export const LAUNCHD_LABEL = "com.codex-kaboo.sync";

/** macOS-only generator: `path.posix` so the plist is byte-identical wherever the tests run (Windows CI included). */
export function plistPath(homeDir: string): string {
  return path.posix.join(homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderPlist(target: ScheduleTarget): string {
  const args = [target.nodePath, target.scriptPath, ...scheduledArgs()];
  const log = path.posix.join(target.kabooHome, "launchd.log");
  const env: [string, string][] = [
    ["PATH", target.pathEnv ?? "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"],
    ["CODEX_KABOO_SCHEDULED", "1"],
  ];
  if (target.codexHome) env.push(["CODEX_HOME", target.codexHome]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((a) => `    <string>${xmlEscape(a)}</string>`),
    "  </array>",
    "  <key>StartInterval</key>",
    `  <integer>${SCHEDULE_INTERVAL_SECONDS}</integer>`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(log)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(log)}</string>`,
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...env.flatMap(([k, v]) => [
      `    <key>${xmlEscape(k)}</key>`,
      `    <string>${xmlEscape(v)}</string>`,
    ]),
    "  </dict>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function domain(target: ScheduleTarget): string {
  return `gui/${target.uid ?? 501}`;
}

export const launchdAdapter: SchedulerAdapter = {
  name: "launchd",
  async install(target, spawner) {
    const file = plistPath(target.homeDir);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, renderPlist(target), "utf8");
    await spawner.run("launchctl", ["bootout", `${domain(target)}/${LAUNCHD_LABEL}`]); // ignore failure: not loaded yet
    const bootstrap = await spawner.run("launchctl", ["bootstrap", domain(target), file]);
    if (bootstrap.code !== 0) {
      const legacy = await spawner.run("launchctl", ["load", "-w", file]);
      if (legacy.code !== 0)
        throw new Error(
          `launchctl bootstrap failed: ${bootstrap.stderr.trim() || legacy.stderr.trim()}`,
        );
    }
    const kickstart = await spawner.run("launchctl", [
      "kickstart",
      "-k",
      `${domain(target)}/${LAUNCHD_LABEL}`,
    ]);
    if (kickstart.code !== 0)
      throw new Error(`launchctl kickstart failed: ${kickstart.stderr.trim()}`);
    return `launchd agent ${LAUNCHD_LABEL} installed (${file}), runs every 15 minutes`;
  },
  async uninstall(target, spawner) {
    const file = plistPath(target.homeDir);
    await spawner.run("launchctl", ["bootout", `${domain(target)}/${LAUNCHD_LABEL}`]);
    await fs.rm(file, { force: true });
    return `launchd agent ${LAUNCHD_LABEL} removed`;
  },
  async status(target, spawner) {
    const file = plistPath(target.homeDir);
    let hasPlist = false;
    try {
      await fs.access(file);
      hasPlist = true;
    } catch {
      hasPlist = false;
    }
    const print = await spawner.run("launchctl", ["print", `${domain(target)}/${LAUNCHD_LABEL}`]);
    const installed = print.code === 0 || hasPlist;
    const missing = await checkTargetPaths(target);
    if (!installed) return { installed: false, healthy: false, detail: "not installed" };
    if (missing.length > 0)
      return {
        installed: true,
        healthy: false,
        detail: `schedule broken: missing ${missing.join(", ")}; run \`codex-kaboo install\` again`,
      };
    return {
      installed: true,
      healthy: print.code === 0,
      detail:
        print.code === 0
          ? "loaded"
          : "plist present but not loaded (log in again or run `codex-kaboo install`)",
    };
  },
};
