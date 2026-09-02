import { CLI_LOCK_STALE_MS, CLI_MIN_BATCH_EVENTS, CLI_RUN_BUDGET_MS, HEARTBEAT_INTERVAL_MS } from "@codex-kaboo/shared/constants";
import type { RateLimitSnapshot, SyncBatch, SyncResponse, UpsertCounts } from "@codex-kaboo/shared/sync";
import { readConfig } from "../core/config";
import { resolveCodexHomes, type KabooPaths } from "../core/paths";
import { clearFailure, emptyFileState, readState, recordFailure, resetAllFiles, writeState } from "../core/state";
import type { Config, SyncState } from "../types";
import { applyAck, buildBatches, DEFAULT_BATCH_LIMITS, type BatchLimits } from "../upload/batch";
import { isAuthError, isBadRequest, isPayloadTooLarge, type SyncClient } from "../upload/client";
import { acquireLock, releaseLock } from "../util/lock";
import type { Logger } from "../util/log";
import { compareVersions } from "../util/version";
import {
  buildMachineInfo, planSync, toSyncBatch, type FileAction, type SyncPlan,
} from "./sync-plan";

export interface SyncOptions {
  full: boolean;
  dryRun: boolean;
  scheduled: boolean;
  json: boolean;
  codexHome?: string;
}

export interface SyncDeps {
  paths: KabooPaths;
  env: NodeJS.ProcessEnv;
  now: () => number;
  log: Logger;
  cliVersion: string;
  machineZone: string | undefined;
  newId: () => string;
  createClient: (config: Config) => SyncClient;
  platform: string;
  arch: string;
  nodeVersion: string;
  hostname: () => string;
  pid: number;
  webOrigin?: string;
  budgetMs?: number;
  batchLimits?: BatchLimits;
}

export interface FileReport {
  sessionId: string;
  name: string;
  action: FileAction;
  reason?: string;
  newEvents: number;
  summaryChanged: boolean;
}

export interface SyncReport {
  ok: boolean;
  exitCode: number;
  dryRun: boolean;
  loggedIn: boolean;
  durationMs: number;
  homes: SyncPlan["homes"];
  files: FileReport[];
  uploads: { sessions: number; events: number; requests: number };
  accepted: { sessions: UpsertCounts; events: UpsertCounts } | null;
  conflicts: { sessions: string[]; events: number } | null;
  heartbeat: boolean;
  latestCliVersion: string | null;
  rateLimit: RateLimitSnapshot | null;
  warnings: string[];
  errors: string[];
  batches?: SyncBatch[]; // dry-run only: the exact payloads (privacy audit)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function zeroCounts(): UpsertCounts {
  return { inserted: 0, updated: 0, unchanged: 0 };
}

function addCounts(target: UpsertCounts, delta: UpsertCounts): void {
  target.inserted += delta.inserted;
  target.updated += delta.updated;
  target.unchanged += delta.unchanged;
}

export function upgradeHint(version: string, webOrigin: string | undefined): string {
  const origin = webOrigin ?? "https://<your-dashboard>";
  return `a newer codex-kaboo CLI (${version}) is available: npm install -g ${origin}/cli/codex-kaboo-cli.tgz (npm 12+: add --allow-remote=all)`;
}

export function summaryLine(report: SyncReport): string {
  const parsed = report.files.filter((f) => f.action === "parsed" || f.action === "reset").length;
  return `sync ${report.ok ? "ok" : "failed"}: ${report.files.length} files, ${parsed} parsed, ${report.uploads.sessions} sessions and ${report.uploads.events} events uploaded in ${report.uploads.requests} request(s)${report.heartbeat ? " (heartbeat)" : ""}, ${report.durationMs} ms`;
}

export async function runSync(opts: SyncOptions, deps: SyncDeps): Promise<SyncReport> {
  const start = deps.now();
  const report: SyncReport = {
    ok: true, exitCode: 0, dryRun: opts.dryRun, loggedIn: false, durationMs: 0, homes: [], files: [],
    uploads: { sessions: 0, events: 0, requests: 0 }, accepted: null, conflicts: null, heartbeat: false,
    latestCliVersion: null, rateLimit: null, warnings: [], errors: [],
  };
  const finish = (): SyncReport => {
    report.durationMs = deps.now() - start;
    report.ok = report.exitCode === 0;
    return report;
  };

  let config: Config | null = null;
  try {
    config = await readConfig(deps.paths);
  } catch (error) {
    report.errors.push(errorMessage(error));
    report.exitCode = 2;
    return finish();
  }
  report.loggedIn = config !== null;
  if (config === null && !opts.dryRun) {
    report.warnings.push("not logged in: run `codex-kaboo login` first");
    report.exitCode = opts.scheduled ? 0 : 2;
    return finish();
  }

  let lockHeld = false;
  if (!opts.dryRun) {
    const lock = await acquireLock(deps.paths.lock, { now: deps.now(), staleMs: CLI_LOCK_STALE_MS, pid: deps.pid });
    if (!lock.acquired) {
      report.warnings.push(`another sync is running (pid ${lock.holder?.pid ?? "unknown"}); skipped`);
      report.exitCode = opts.scheduled ? 0 : 1;
      return finish();
    }
    lockHeld = true;
  }

  try {
    const loaded = await readState(deps.paths);
    if (loaded.corrupt) report.warnings.push("state.json was unreadable; starting from an empty state");
    const state: SyncState = opts.full ? resetAllFiles(loaded.state) : loaded.state;
    const homes = resolveCodexHomes({ override: opts.codexHome, env: deps.env, configured: config?.codexHomes });
    const plan = await planSync(state, homes, { full: opts.full, codexHome: opts.codexHome }, {
      env: deps.env, now: deps.now, log: deps.log,
      machineZone: deps.machineZone, budgetMs: deps.budgetMs, startedAt: start,
    });
    report.homes = plan.homes;
    report.warnings.push(...plan.warnings);
    report.errors.push(...plan.errors);
    if (plan.errors.length > 0) report.exitCode = 1;
    report.files = plan.files.map((f) => ({
      sessionId: f.file.sessionId,
      name: f.file.name,
      action: f.action,
      ...(f.reason ? { reason: f.reason } : {}),
      newEvents: f.upload?.events.length ?? 0,
      summaryChanged: f.upload?.summaryChanged ?? false,
    }));
    state.codexVersion = plan.codexVersion;
    const machine = buildMachineInfo({
      config, platform: deps.platform, arch: deps.arch, nodeVersion: deps.nodeVersion, hostname: deps.hostname,
      machineZone: deps.machineZone, codexVersion: plan.codexVersion, codexLatestVersion: plan.codexLatestVersion,
    });
    const limits: BatchLimits = { ...(deps.batchLimits ?? DEFAULT_BATCH_LIMITS) };
    const plannedById = new Map(plan.files.map((f) => [f.file.sessionId, f]));
    for (const planned of plan.files) {
      if (planned.upload === null && (planned.action === "unchanged" || planned.action === "error")) {
        state.files[planned.file.sessionId] = planned.next;
      }
    }

    if (opts.dryRun) {
      const batches = buildBatches(plan.uploads, limits);
      report.batches = batches.map((batch, index) => {
        const sendRateLimit = index === 0 && plan.rateLimitChanged;
        return toSyncBatch(batch, machine, {
          cliVersion: deps.cliVersion,
          batchId: deps.newId(),
          sentAt: deps.now(),
          rateLimit: sendRateLimit ? plan.rateLimit : null,
          rateLimitChanged: sendRateLimit,
        });
      });
      // `--dry-run --json` is the privacy audit: it has to show every payload a real run would
      // send, and in steady state — nothing changed since the last sync — the ONLY thing a real run
      // sends is the machine-only heartbeat below, carrying the full `machine` object (including
      // the hostname, when `login --hostname` opted in). Reporting `"batches": []` there hid
      // precisely the payload a privacy-conscious user most wants to inspect, and left a machine in
      // its most common state with nothing to audit at all. Mirror the real heartbeat decision at
      // :305-331 exactly — same due-or-rate-limit-changed test, same batch shape — but report the
      // payload instead of sending it (a dry run makes no network call and writes no state, so
      // `state.lastHeartbeatAt` is left alone and the real run stays due).
      const heartbeatDue = state.lastHeartbeatAt === null || deps.now() - state.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS;
      if (report.batches.length === 0 && report.exitCode !== 2 && (heartbeatDue || plan.rateLimitChanged)) {
        report.batches.push(
          toSyncBatch({ sessions: [], tokenEvents: [], files: [] }, machine, {
            cliVersion: deps.cliVersion,
            batchId: deps.newId(),
            sentAt: deps.now(),
            rateLimit: plan.rateLimitChanged ? plan.rateLimit : null,
            rateLimitChanged: plan.rateLimitChanged,
          }),
        );
        report.heartbeat = true;
      }
      report.uploads = {
        sessions: plan.uploads.filter((u) => u.summaryChanged).length,
        events: plan.uploads.reduce((n, u) => n + u.events.length, 0),
        requests: report.batches.length, // the heartbeat is a request too, as it is on the real path
      };
      report.rateLimit = plan.rateLimit;
      return finish();
    }

    const client = deps.createClient(config as Config);
    const accepted = { sessions: zeroCounts(), events: zeroCounts() };
    const conflicts: { sessions: string[]; events: number } = { sessions: [], events: 0 };
    let rateLimitToSend: RateLimitSnapshot | null = plan.rateLimitChanged ? plan.rateLimit : null;
    const applyResponse = (res: SyncResponse): void => {
      addCounts(accepted.sessions, res.accepted.sessions);
      addCounts(accepted.events, res.accepted.events);
      conflicts.sessions.push(...res.conflicts.sessions);
      conflicts.events += res.conflicts.events;
      report.uploads.requests += 1;
      if (res.latestCliVersion) {
        report.latestCliVersion = res.latestCliVersion;
        state.latestCliVersion = res.latestCliVersion;
      }
      if (rateLimitToSend !== null) {
        state.rateLimit = rateLimitToSend;
        rateLimitToSend = null;
      }
    };
    const failFile = (sessionId: string, message: string): void => {
      const planned = plannedById.get(sessionId);
      // A rejected file must keep whatever cursor it had before this run (or none at all), never
      // the fully-advanced `planned.next` — see the non-final-ack comment below for why that matters.
      const current = state.files[sessionId] ?? planned?.prev ?? (planned ? emptyFileState(planned.file.path) : undefined);
      if (!current) return;
      // The size/mtime stamped on the failure are the FILE's, not the cursor's: because a rejected
      // file keeps its pre-run cursor (often a zeroed one, for a file seen for the first time),
      // the cursor's own size/mtime could never match the file on the next run and the counter
      // would restart forever.
      state.files[sessionId] = recordFailure(current, message, planned?.file.size ?? current.size, planned?.file.mtimeMs ?? current.mtimeMs);
    };

    const deadline = start + (deps.budgetMs ?? CLI_RUN_BUDGET_MS);
    let pending = plan.uploads;
    let stopped = false;
    while (pending.length > 0 && !stopped) {
      if (deps.now() >= deadline) {
        report.warnings.push("run budget exhausted; remaining files continue next run");
        stopped = true;
        break;
      }
      const batch = buildBatches(pending, limits)[0];
      if (!batch) break;
      const rateLimitChanged = rateLimitToSend !== null;
      const payload = toSyncBatch(batch, machine, { cliVersion: deps.cliVersion, batchId: deps.newId(), sentAt: deps.now(), rateLimit: rateLimitToSend, rateLimitChanged });
      let response: SyncResponse;
      try {
        response = await client.sync(payload);
      } catch (error) {
        const inBatch = new Set(batch.files.map((f) => f.sessionId));
        if (isPayloadTooLarge(error)) {
          if (limits.maxEvents <= CLI_MIN_BATCH_EVENTS) {
            for (const id of inBatch) failFile(id, "server rejected the batch as too large");
            pending = pending.filter((u) => !inBatch.has(u.sessionId));
            report.errors.push(`server rejected ${inBatch.size} file(s) as too large even at ${CLI_MIN_BATCH_EVENTS} events per batch`);
            report.exitCode = 1;
            continue;
          }
          limits.maxEvents = Math.max(CLI_MIN_BATCH_EVENTS, Math.floor(limits.maxEvents / 2));
          limits.maxBytes = Math.max(64 * 1024, Math.floor(limits.maxBytes / 2));
          report.warnings.push(`payload too large; retrying with batches of ${limits.maxEvents} events`);
          continue;
        }
        if (isAuthError(error)) {
          report.errors.push(`authentication failed (${errorMessage(error)}); run \`codex-kaboo login\``);
          report.exitCode = 2;
          stopped = true;
          break;
        }
        if (isBadRequest(error)) {
          for (const id of inBatch) failFile(id, errorMessage(error));
          pending = pending.filter((u) => !inBatch.has(u.sessionId));
          report.errors.push(`server rejected ${inBatch.size} file(s): ${errorMessage(error)}`);
          report.exitCode = 1;
          await writeState(deps.paths, state);
          continue;
        }
        report.errors.push(`upload failed: ${errorMessage(error)}`);
        report.exitCode = 1;
        stopped = true;
        break;
      }
      applyResponse(response);
      report.uploads.sessions += batch.sessions.length;
      report.uploads.events += batch.tokenEvents.length;
      for (const entry of batch.files) {
        const planned = plannedById.get(entry.sessionId);
        if (!planned) continue;
        if (entry.final) {
          // The file's whole upload (through its summary) is now acked: safe to adopt this run's
          // fully-parsed cursor.
          const current = state.files[entry.sessionId] ?? planned.next;
          state.files[entry.sessionId] = clearFailure({
            ...planned.next,
            lastUploadedSeq: Math.max(current.lastUploadedSeq, planned.next.lastUploadedSeq, entry.lastSeq),
            summaryHash: planned.summaryHash,
            lastError: null,
          });
        } else {
          // Non-final ack: only part of this file's new events were accepted. Do NOT adopt
          // `planned.next`'s cursor (offset/size/mtimeMs) — with lastError cleared, that would make
          // the next run's `isUnchanged` check see this file as fully caught up and skip re-parsing
          // it forever, silently losing every event past what this batch acked. Keep whatever
          // cursor is already on record (this run's own earlier write, else the state this run
          // started with, else "nothing read yet") so the file is re-parsed next run and the events
          // still unacked (seq > the raised lastUploadedSeq) are correctly re-derived and re-offered.
          const current = state.files[entry.sessionId] ?? planned.prev ?? emptyFileState(planned.file.path);
          state.files[entry.sessionId] = clearFailure({
            ...current,
            lastUploadedSeq: Math.max(current.lastUploadedSeq, entry.lastSeq),
            lastError: null,
          });
        }
      }
      pending = applyAck(pending, batch);
      await writeState(deps.paths, state);
    }

    if (conflicts.sessions.length > 0) {
      report.warnings.push(`${conflicts.sessions.length} session(s) belong to another user and were not merged: ${conflicts.sessions.join(", ")}`);
    }
    report.accepted = accepted;
    report.conflicts = conflicts;

    if (report.uploads.requests > 0) {
      state.lastHeartbeatAt = deps.now();
    } else if (!stopped && report.exitCode !== 2) {
      const due = state.lastHeartbeatAt === null || deps.now() - state.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS;
      if (due || rateLimitToSend !== null) {
        try {
          const heartbeatRateLimitChanged = rateLimitToSend !== null;
          const res = await client.sync(
            toSyncBatch(
              { sessions: [], tokenEvents: [], files: [] },
              machine,
              { cliVersion: deps.cliVersion, batchId: deps.newId(), sentAt: deps.now(), rateLimit: rateLimitToSend, rateLimitChanged: heartbeatRateLimitChanged },
            ),
          );
          applyResponse(res);
          state.lastHeartbeatAt = deps.now();
          report.heartbeat = true;
        } catch (error) {
          if (isAuthError(error)) {
            report.errors.push(`authentication failed (${errorMessage(error)}); run \`codex-kaboo login\``);
            report.exitCode = 2;
          } else {
            report.warnings.push(`heartbeat failed: ${errorMessage(error)}`);
          }
        }
      }
    }

    report.rateLimit = state.rateLimit;
    if (report.latestCliVersion !== null && compareVersions(report.latestCliVersion, deps.cliVersion) > 0) {
      report.warnings.push(upgradeHint(report.latestCliVersion, deps.webOrigin));
    }
    state.lastSyncAt = deps.now();
    state.lastSyncOk = report.exitCode === 0;
    state.lastError = report.errors[0] ?? null;
    await writeState(deps.paths, state);
    const done = finish();
    deps.log.info(summaryLine(done));
    for (const warning of done.warnings) deps.log.warn(warning);
    for (const error of done.errors) deps.log.error(error);
    return done;
  } catch (error) {
    report.errors.push(errorMessage(error));
    if (report.exitCode !== 2) report.exitCode = 1;
    deps.log.error(`sync crashed: ${errorMessage(error)}`);
    return finish();
  } finally {
    if (lockHeld) await releaseLock(deps.paths.lock, deps.pid);
  }
}
