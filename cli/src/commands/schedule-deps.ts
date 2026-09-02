import { promises as fs } from "node:fs";
import type { KabooPaths } from "../core/paths";
import type { ScheduleTarget, Spawner } from "../schedule/index";
import type { Logger } from "../util/log";

export interface ScheduleDeps {
  paths: KabooPaths;
  env: NodeJS.ProcessEnv;
  platform: string;
  execPath: string;
  scriptPath: string; // process.argv[1]
  homeDir: string;
  uid?: number;
  spawner: Spawner;
  log: Logger;
}

/** The command the scheduler will run: realpaths so nvm/npm symlink changes are detectable later. */
export async function buildScheduleTarget(deps: ScheduleDeps): Promise<ScheduleTarget> {
  const realpath = async (p: string): Promise<string> => {
    try {
      return await fs.realpath(p);
    } catch {
      return p;
    }
  };
  const target: ScheduleTarget = {
    nodePath: await realpath(deps.execPath),
    scriptPath: await realpath(deps.scriptPath),
    kabooHome: deps.paths.home,
    homeDir: deps.homeDir,
  };
  if (deps.env.CODEX_HOME && deps.env.CODEX_HOME.trim().length > 0) target.codexHome = deps.env.CODEX_HOME.trim();
  if (deps.uid !== undefined) target.uid = deps.uid;
  if (deps.env.PATH) target.pathEnv = deps.env.PATH;
  return target;
}
