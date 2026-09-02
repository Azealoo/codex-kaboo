import { promises as fs } from "node:fs";
import { cronAdapter } from "./cron";
import { launchdAdapter } from "./launchd";
import { schtasksAdapter } from "./schtasks";
import { systemdAdapter } from "./systemd";

export const SCHEDULE_INTERVAL_SECONDS = 900;

export interface ScheduleTarget {
  nodePath: string; // process.execPath at install time
  scriptPath: string; // realpath of dist/codex-kaboo.js
  kabooHome: string;
  homeDir: string;
  codexHome?: string; // CODEX_HOME captured at install time
  uid?: number;
  pathEnv?: string;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface Spawner {
  run(
    command: string,
    args: string[],
    opts?: { input?: string; timeoutMs?: number },
  ): Promise<SpawnResult>;
}

export interface ScheduleStatus {
  installed: boolean;
  healthy: boolean;
  detail: string;
}

export type SchedulerName = "launchd" | "cron" | "systemd" | "schtasks";

export interface SchedulerAdapter {
  name: SchedulerName;
  install(target: ScheduleTarget, spawner: Spawner): Promise<string>;
  uninstall(target: ScheduleTarget, spawner: Spawner): Promise<string>;
  status(target: ScheduleTarget, spawner: Spawner): Promise<ScheduleStatus>;
}

export function scheduledArgs(): string[] {
  return ["sync", "--scheduled"];
}

export function pickScheduler(platform: string, opts: { systemd?: boolean }): SchedulerAdapter {
  if (platform === "darwin") return launchdAdapter;
  if (platform === "win32") return schtasksAdapter;
  return opts.systemd ? systemdAdapter : cronAdapter;
}

/**
 * Refuses a value that cannot be represented in a line-oriented generated file. A crontab entry
 * and a systemd unit directive both end at the first `\n` (or `\r`) no matter how the value around
 * it is quoted — cron and systemd split the file into lines/directives *before* any quoting is
 * interpreted, so an embedded newline is not a metacharacter that escaping can neutralize, it is a
 * value that format cannot hold. Escaping it anyway would produce a file that parses without
 * complaint but means something else — in cron's case, an extra entry injected inside the
 * codex-kaboo marker block.
 *
 * `cronQuote`, `systemdEscape` and the schtasks quoting helpers all call this before doing any
 * other escaping, so every value that reaches one of those generators is checked here once,
 * rather than at each call site that happens to remember to check by hand.
 */
export function assertNoNewline(value: string, format: string): void {
  if (!/[\n\r]/.test(value)) return;
  throw new Error(
    `codex-kaboo install: this path contains a newline (or carriage return) character, which ${format} cannot represent — refusing to write it rather than produce a broken or silently corrupted schedule: ${JSON.stringify(value)}`,
  );
}

/** Paths baked into the schedule that no longer exist (nvm upgrades move node). */
export async function checkTargetPaths(target: ScheduleTarget): Promise<string[]> {
  const missing: string[] = [];
  for (const p of [target.nodePath, target.scriptPath]) {
    try {
      await fs.access(p);
    } catch {
      missing.push(p);
    }
  }
  return missing;
}
