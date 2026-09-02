import { pickScheduler, type SchedulerName } from "../schedule/index";
import { buildScheduleTarget, type ScheduleDeps } from "./schedule-deps";

export interface UninstallResult {
  ok: boolean;
  exitCode: number;
  scheduler: SchedulerName;
  detail: string;
}

export async function runUninstall(opts: { systemd: boolean; json: boolean }, deps: ScheduleDeps): Promise<UninstallResult> {
  const adapter = pickScheduler(deps.platform, { systemd: opts.systemd });
  try {
    const detail = await adapter.uninstall(await buildScheduleTarget(deps), deps.spawner);
    deps.log.info(detail);
    return { ok: true, exitCode: 0, scheduler: adapter.name, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log.error(message);
    return { ok: false, exitCode: 1, scheduler: adapter.name, detail: message };
  }
}
