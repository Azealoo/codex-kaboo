import { basename } from "node:path";
import type { RateLimitSnapshot } from "@codex-kaboo/shared/sync";
import { readConfig } from "../core/config";
import { discoverRolloutFiles } from "../core/discover";
import { resolveCodexHomes } from "../core/paths";
import { MAX_FILE_FAILURES, readState } from "../core/state";
import { pickScheduler, type SchedulerName } from "../schedule/index";
import { buildScheduleTarget, type ScheduleDeps } from "./schedule-deps";

export interface StatusReport {
  cliVersion: string;
  loggedIn: boolean;
  server: string | null;
  label: string | null;
  machineId: string | null;
  hostnameOptIn: boolean;
  user: { name: string | null; email: string | null } | null;
  codexHomes: { path: string; exists: boolean; files: number }[];
  lastSync: { at: number; ok: boolean | null; error: string | null } | null;
  lastHeartbeatAt: number | null;
  rateLimit: RateLimitSnapshot | null;
  codexVersion: string | null;
  latestCliVersion: string | null;
  filesTracked: number;
  filesWithErrors: number;
  /** Files that failed the same way past MAX_FILE_FAILURES and are no longer retried until they change. */
  filesParked: { name: string; failures: number; error: string }[];
  scheduler: { name: SchedulerName; installed: boolean; healthy: boolean; detail: string };
}

export async function runStatus(
  deps: ScheduleDeps & { cliVersion: string; codexHomeOverride?: string; systemd?: boolean },
): Promise<StatusReport> {
  const config = await readConfig(deps.paths).catch(() => null);
  const { state } = await readState(deps.paths);
  const homes = resolveCodexHomes({
    override: deps.codexHomeOverride,
    env: deps.env,
    configured: config?.codexHomes,
  });
  const discovered = await discoverRolloutFiles(homes);
  const adapter = pickScheduler(deps.platform, { systemd: deps.systemd === true });
  const scheduler = await adapter
    .status(await buildScheduleTarget(deps), deps.spawner)
    .catch((error: unknown) => ({
      installed: false,
      healthy: false,
      detail: error instanceof Error ? error.message : String(error),
    }));
  const files = Object.values(state.files);
  return {
    cliVersion: deps.cliVersion,
    loggedIn: config !== null,
    server: config?.server ?? null,
    label: config?.label ?? null,
    machineId: config?.machineId ?? null,
    hostnameOptIn: config?.hostnameOptIn ?? false,
    user: config ? { name: config.userName ?? null, email: config.userEmail ?? null } : null,
    codexHomes: discovered.homes,
    lastSync:
      state.lastSyncAt === null
        ? null
        : { at: state.lastSyncAt, ok: state.lastSyncOk, error: state.lastError },
    lastHeartbeatAt: state.lastHeartbeatAt,
    rateLimit: state.rateLimit,
    codexVersion: state.codexVersion,
    latestCliVersion: state.latestCliVersion,
    filesTracked: files.length,
    filesWithErrors: files.filter((f) => f.lastError !== null).length,
    filesParked: files
      .filter((f) => f.lastError !== null && (f.failure?.count ?? 0) > MAX_FILE_FAILURES)
      .map((f) => ({
        name: basename(f.path),
        failures: f.failure?.count ?? 0,
        error: f.lastError ?? "",
      })),
    scheduler: { name: adapter.name, ...scheduler },
  };
}

function when(ms: number | null): string {
  return ms === null ? "never" : new Date(ms).toISOString();
}

export function formatStatus(r: StatusReport): string[] {
  const lines = [
    `codex-kaboo ${r.cliVersion}${r.latestCliVersion && r.latestCliVersion !== r.cliVersion ? ` (latest ${r.latestCliVersion})` : ""}`,
    r.loggedIn
      ? `logged in: ${r.user?.name ?? r.user?.email ?? "yes"} → ${r.server}`
      : "not logged in (run `codex-kaboo login`)",
    `machine: ${r.label ?? "-"} (${r.machineId ?? "-"})${r.hostnameOptIn ? ", hostname shared" : ""}`,
    ...r.codexHomes.map(
      (h) => `codex home: ${h.path} ${h.exists ? `(${h.files} rollout files)` : "(missing)"}`,
    ),
    `codex version: ${r.codexVersion ?? "unknown"}`,
    `last sync: ${r.lastSync ? `${when(r.lastSync.at)} ${r.lastSync.ok ? "ok" : `failed: ${r.lastSync.error ?? "unknown error"}`}` : "never"}`,
    `tracked files: ${r.filesTracked}${r.filesWithErrors > 0 ? ` (${r.filesWithErrors} with errors)` : ""}`,
    ...r.filesParked.map(
      (f) =>
        `  parked: ${f.name} failed ${f.failures}x and is no longer retried until it changes — ${f.error}`,
    ),
    `scheduler: ${r.scheduler.name} ${r.scheduler.installed ? (r.scheduler.healthy ? "installed" : "INSTALLED BUT BROKEN") : "not installed"} — ${r.scheduler.detail}`,
  ];
  if (r.rateLimit)
    lines.push(
      `weekly quota: ${r.rateLimit.usedPercent}% used (observed ${when(r.rateLimit.observedAt)})`,
    );
  return lines;
}
