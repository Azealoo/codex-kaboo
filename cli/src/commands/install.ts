import { readConfig } from "../core/config";
import { pickScheduler, type SchedulerName } from "../schedule/index";
import { buildScheduleTarget, type ScheduleDeps } from "./schedule-deps";
import type { SyncReport } from "./sync";

export interface InstallOptions {
  systemd: boolean;
  json: boolean;
}

export interface InstallResult {
  ok: boolean;
  exitCode: number;
  scheduler: SchedulerName;
  detail: string;
  sync: SyncReport | null;
}

export async function runInstall(opts: InstallOptions, deps: ScheduleDeps & { runSync: () => Promise<SyncReport> }): Promise<InstallResult> {
  const adapter = pickScheduler(deps.platform, { systemd: opts.systemd });
  const config = await readConfig(deps.paths);
  if (config === null) {
    return { ok: false, exitCode: 2, scheduler: adapter.name, detail: "not logged in: run `codex-kaboo login` first", sync: null };
  }
  const target = await buildScheduleTarget(deps);
  let detail: string;
  try {
    detail = await adapter.install(target, deps.spawner);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log.error(message);
    return { ok: false, exitCode: 1, scheduler: adapter.name, detail: message, sync: null };
  }
  deps.log.info(detail);
  const sync = await deps.runSync();
  return { ok: sync.exitCode === 0, exitCode: sync.exitCode, scheduler: adapter.name, detail, sync };
}
