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
}

export interface Spawner {
  run(command: string, args: string[], opts?: { input?: string }): Promise<SpawnResult>;
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
