import { readConfig } from "../core/config";
import { discoverRolloutFiles } from "../core/discover";
import { resolveCodexHomes } from "../core/paths";
import { MAX_FILE_FAILURES, readState } from "../core/state";
import { pickScheduler } from "../schedule/index";
import type { Config } from "../types";
import type { SyncClient } from "../upload/client";
import { meetsVersion } from "../util/version";
import { buildScheduleTarget, type ScheduleDeps } from "./schedule-deps";

/**
 * Must stay equal to `engines.node` in cli/package.json and to the floor the README states. When
 * they drift, `doctor` blesses an install npm would have refused — the one command whose whole job
 * is to catch that.
 */
const MIN_NODE_MAJOR = 20;
const MIN_NODE = `${MIN_NODE_MAJOR}.0.0`;

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  exitCode: number;
  checks: DoctorCheck[];
}

export async function runDoctor(
  deps: ScheduleDeps & {
    cliVersion: string;
    nodeVersion: string;
    createClient: (config: Config) => SyncClient;
    codexHomeOverride?: string;
    systemd?: boolean;
  },
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeOk = meetsVersion(deps.nodeVersion, MIN_NODE);
  checks.push({
    name: "node",
    ok: nodeOk,
    detail: `${deps.nodeVersion}${meetsVersion(deps.nodeVersion, "22.15.0") ? "" : " (compressed .jsonl.zst rollouts need Node >= 22.15)"}${nodeOk ? "" : ` — Node ${MIN_NODE_MAJOR} or newer is required`}`,
  });
  const config = await readConfig(deps.paths).catch(() => null);
  const homes = resolveCodexHomes({
    override: deps.codexHomeOverride,
    env: deps.env,
    configured: config?.codexHomes,
  });
  const discovered = await discoverRolloutFiles(homes);
  const found = discovered.homes.filter((h) => h.exists);
  checks.push({
    name: "codex home",
    ok: found.length > 0,
    detail:
      found.length > 0
        ? found.map((h) => `${h.path} (${h.files} rollout files)`).join(", ")
        : `none of ${homes.join(", ")} exists`,
  });
  checks.push({
    name: "login",
    ok: config !== null,
    detail: config
      ? `${config.server} as ${config.userName ?? config.userEmail ?? config.machineId}`
      : "not logged in (run `codex-kaboo login`)",
  });
  if (config) {
    try {
      const who = await deps.createClient(config).whoami();
      checks.push({
        name: "token",
        ok: true,
        detail: `valid (${who.token.name}, ${who.name ?? who.email ?? who.userId})`,
      });
    } catch (error) {
      checks.push({
        name: "token",
        ok: false,
        detail: `invalid or unreachable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } else {
    checks.push({ name: "token", ok: false, detail: "no token configured" });
  }
  const adapter = pickScheduler(deps.platform, { systemd: deps.systemd === true });
  try {
    const status = await adapter.status(await buildScheduleTarget(deps), deps.spawner);
    checks.push({
      name: "scheduler",
      ok: status.installed && status.healthy,
      detail: `${adapter.name}: ${status.detail}`,
    });
  } catch (error) {
    checks.push({
      name: "scheduler",
      ok: false,
      detail: `${adapter.name}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const { state, corrupt } = await readState(deps.paths);
  const errored = Object.values(state.files).filter((f) => f.lastError !== null);
  // Parked files are the ones `sync` has stopped retrying after MAX_FILE_FAILURES identical
  // failures. They no longer fail a scheduled run, which is the point — so `doctor` is where they
  // have to be visible, with the count and the way back (change the file).
  const parked = errored.filter((f) => (f.failure?.count ?? 0) > MAX_FILE_FAILURES);
  const erroredDetail =
    errored.length === 0
      ? `${Object.keys(state.files).length} files tracked`
      : `${errored.length} file(s) with errors${parked.length > 0 ? ` (${parked.length} parked after ${MAX_FILE_FAILURES}+ identical failures; each is retried again as soon as the file changes)` : ""}: ${errored.map((f) => f.lastError).join("; ")}`;
  checks.push({
    name: "state",
    ok: !corrupt && errored.length === 0,
    detail: corrupt ? "state.json is corrupt (it will be rebuilt on the next sync)" : erroredDetail,
  });
  const ok = checks.every((c) => c.ok);
  return { ok, exitCode: ok ? 0 : 1, checks };
}

export function formatDoctor(report: DoctorReport): string[] {
  return [
    ...report.checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`),
    report.ok ? "all checks passed" : "some checks failed",
  ];
}
