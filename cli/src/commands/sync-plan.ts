import { promises as fs } from "node:fs";
import path from "node:path";
import { CLI_MAX_FILE_BYTES, CLI_MAX_FILES, CLI_RUN_BUDGET_MS, PARSER_VERSION, SCHEMA_VERSION } from "@codex-kaboo/shared/constants";
import type { MachineInfo, RateLimitSnapshot, SyncBatch } from "@codex-kaboo/shared/sync";
import { discoverRolloutFiles, type DiscoveredFile } from "../core/discover";
import { zstdSupported } from "../core/jsonl-reader";
import { parseRolloutFile } from "../core/parse-file";
import { detectReset, emptyFileState, isPermanentlyFailing, isUnchanged, recordFailure, resetFileState } from "../core/state";
import type { ParsedSession } from "../parser/session";
import type { Config, FileState, SyncState } from "../types";
import type { Batch, FileUpload } from "../upload/batch";
import type { Logger } from "../util/log";
import { newestVersion } from "../util/version";

export type FileAction = "unchanged" | "parsed" | "reset" | "skipped" | "error";

export interface PlannedFile {
  file: DiscoveredFile;
  prev: FileState | undefined;
  next: FileState; // state to store once the upload (if any) is acknowledged
  upload: FileUpload | null;
  summaryHash: string; // hash of the freshly parsed summary ("" when not parsed)
  action: FileAction;
  reason?: string;
  rateLimit: RateLimitSnapshot | null;
  codexVersion?: string;
  diagnostics?: ParsedSession["diagnostics"];
}

export interface SyncPlan {
  homes: { path: string; exists: boolean; files: number }[];
  truncated: boolean;
  files: PlannedFile[];
  uploads: FileUpload[];
  rateLimit: RateLimitSnapshot | null; // newest known snapshot: the one from state, or a newer one seen this run
  rateLimitChanged: boolean; // true only when a snapshot newer than the one in state was observed this run
  codexVersion: string | null;
  codexLatestVersion: string | undefined;
  warnings: string[];
  errors: string[];
  budgetExhausted: boolean;
}

export interface PlanOptions {
  full: boolean;
  codexHome?: string;
}

/** `machineId`/`label` stand-in when there is no config, i.e. `sync --dry-run` before `login`. */
export const DRY_RUN_MACHINE_ID = "dry-run";

export interface PlanDeps {
  env: NodeJS.ProcessEnv;
  now: () => number;
  log: Logger;
  machineZone: string | undefined;
  budgetMs?: number;
  startedAt?: number;
}

export async function readCodexLatestVersion(homes: string[]): Promise<string | undefined> {
  for (const home of homes) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(home, "version.json"), "utf8")) as { latest_version?: unknown };
      if (typeof raw.latest_version === "string" && raw.latest_version.length > 0) return raw.latest_version;
    } catch {
      // no version.json here
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function planSync(state: SyncState, homes: string[], opts: PlanOptions, deps: PlanDeps): Promise<SyncPlan> {
  const start = deps.startedAt ?? deps.now();
  const budgetMs = deps.budgetMs ?? CLI_RUN_BUDGET_MS;
  const discovered = await discoverRolloutFiles(homes);
  const plan: SyncPlan = {
    homes: discovered.homes,
    truncated: discovered.truncated,
    files: [],
    uploads: [],
    rateLimit: state.rateLimit, // seeded the same way as codexVersion: idle runs must not wipe it
    rateLimitChanged: false, // computed once, below, after the newest candidate is known
    codexVersion: state.codexVersion,
    codexLatestVersion: await readCodexLatestVersion(homes),
    warnings: [],
    errors: [],
    budgetExhausted: false,
  };
  if (discovered.truncated) {
    plan.warnings.push(`more than ${CLI_MAX_FILES} rollout files found; only the first ${CLI_MAX_FILES} are processed`);
  }
  for (const duplicate of discovered.duplicates) {
    // Expected during Codex's compress-then-delete window, so this is a warning and not an error:
    // the two files are the same session and progress is keyed by sessionId, so whichever copy
    // survives picks up exactly where this one left off.
    plan.warnings.push(`${duplicate.dropped}: same session as ${duplicate.kept}; only the latter is processed`);
  }
  let zstdWarned = false;

  for (const file of discovered.files) {
    let prev = state.files[file.sessionId];
    if (prev && prev.path !== file.path) prev = { ...prev, path: file.path }; // moved (archived/compressed)
    const planned: PlannedFile = {
      file,
      prev,
      next: prev ?? emptyFileState(file.path),
      upload: null,
      summaryHash: prev?.summaryHash ?? "",
      action: "unchanged",
      rateLimit: null,
    };
    if (prev?.complete && !opts.full) {
      plan.files.push(planned);
      continue;
    }
    if (file.size > CLI_MAX_FILE_BYTES) {
      planned.action = "skipped";
      planned.reason = "larger than 256 MB";
      plan.warnings.push(`${file.name}: skipped (larger than 256 MB)`);
      plan.files.push(planned);
      continue;
    }
    if (file.compressed && !zstdSupported()) {
      planned.action = "skipped";
      planned.reason = "zstd not supported by this Node";
      if (!zstdWarned) {
        plan.warnings.push("compressed .jsonl.zst rollouts need Node >= 22.15; they were skipped");
        zstdWarned = true;
      }
      plan.files.push(planned);
      continue;
    }
    if (isUnchanged(prev, file.size, file.mtimeMs)) {
      plan.files.push(planned);
      continue;
    }
    if (isPermanentlyFailing(prev, file.size, file.mtimeMs)) {
      // A file that keeps failing identically is parked rather than retried (and re-failed, and
      // re-reported at exit 1) on every scheduled run. This is a warning, not an error: the file
      // stays visible in `status` and `doctor`, and any change to it starts the count over.
      planned.action = "skipped";
      planned.reason = `failed ${prev?.failure?.count ?? 0} times: ${prev?.lastError ?? "unknown error"}`;
      plan.warnings.push(
        `${file.name}: skipped after ${prev?.failure?.count ?? 0} failed attempts (${prev?.lastError ?? "unknown error"}); it will be retried when the file changes`,
      );
      plan.files.push(planned);
      continue;
    }
    if (prev !== undefined && prev.offset > 0 && !file.compressed) {
      let reason: "shrunk" | "tail-mismatch" | null = null;
      try {
        reason = await detectReset(prev, file.path, file.size);
      } catch {
        reason = "tail-mismatch";
      }
      if (reason !== null) {
        prev = resetFileState(prev, file.path);
        planned.prev = prev;
        planned.action = "reset";
        planned.reason = reason;
        plan.warnings.push(`${file.name}: file ${reason}; re-reading it from the start`);
      }
    }
    if (deps.now() - start > budgetMs) {
      plan.budgetExhausted = true;
      plan.warnings.push("run budget exhausted; remaining files will be processed on the next run");
      break;
    }
    let result;
    try {
      result = await parseRolloutFile(file, {
        machineZone: deps.machineZone, now: deps.now(), generation: prev?.generation ?? 0,
      });
    } catch (error) {
      const message = errorMessage(error);
      planned.action = "error";
      planned.reason = message;
      planned.next = recordFailure(
        { ...(prev ?? emptyFileState(file.path)), size: file.size, mtimeMs: file.mtimeMs },
        message,
        file.size,
        file.mtimeMs,
      );
      plan.errors.push(`${file.name}: ${message}`);
      plan.files.push(planned);
      continue;
    }
    const { parsed, read } = result;
    const lastUploadedSeq = prev?.lastUploadedSeq ?? -1;
    const newEvents = parsed.events.filter((event) => event.seq > lastUploadedSeq);
    const summaryChanged = parsed.summary.summaryHash !== prev?.summaryHash;
    planned.summaryHash = parsed.summary.summaryHash;
    planned.rateLimit = parsed.rateLimit;
    planned.diagnostics = parsed.diagnostics;
    if (parsed.summary.cliVersion) planned.codexVersion = parsed.summary.cliVersion;
    planned.next = {
      path: file.path,
      offset: file.compressed ? file.size : read.consumed,
      lines: read.lines,
      size: file.size,
      mtimeMs: file.mtimeMs,
      tail: read.tail,
      lastUploadedSeq,
      summaryHash: prev?.summaryHash ?? null,
      generation: prev?.generation ?? 0,
      complete: file.compressed,
      lastError: null,
    };
    if (summaryChanged || newEvents.length > 0) {
      if (planned.action !== "reset") planned.action = "parsed";
      planned.upload = { sessionId: file.sessionId, summary: parsed.summary, events: newEvents, summaryChanged };
      plan.uploads.push(planned.upload);
    } else if (planned.action !== "reset") {
      planned.action = "unchanged";
    }
    plan.files.push(planned);
    if (parsed.rateLimit && (plan.rateLimit === null || parsed.rateLimit.observedAt > plan.rateLimit.observedAt)) {
      plan.rateLimit = parsed.rateLimit;
    }
    plan.codexVersion = newestVersion([plan.codexVersion, parsed.summary.cliVersion]) ?? plan.codexVersion;
    if (Object.keys(parsed.diagnostics.unknownTypes).length > 0) {
      deps.log.debug(`${file.name}: unknown line types ${JSON.stringify(parsed.diagnostics.unknownTypes)}`);
    }
  }
  // plan.rateLimit is now the newest of {state.rateLimit, every snapshot parsed this run}; flag a
  // change only when that newest one is strictly newer than what state already had, so the caller
  // knows to send it while always being safe to persist plan.rateLimit (idle runs keep it as-is).
  plan.rateLimitChanged =
    plan.rateLimit !== null && (state.rateLimit === null || plan.rateLimit.observedAt > state.rateLimit.observedAt);
  return plan;
}

export interface MachineInput {
  config: Config | null;
  platform: string;
  arch: string;
  nodeVersion: string;
  hostname: () => string;
  machineZone: string | undefined;
  codexVersion: string | null;
  codexLatestVersion: string | undefined;
}

export function buildMachineInfo(input: MachineInput): MachineInfo {
  const machine: MachineInfo = {
    machineId: input.config?.machineId ?? DRY_RUN_MACHINE_ID,
    label: input.config?.label ?? DRY_RUN_MACHINE_ID,
    platform: input.platform,
    arch: input.arch,
    nodeVersion: input.nodeVersion,
    hostname: input.config?.hostnameOptIn ? input.hostname() : null,
  };
  if (input.codexVersion) machine.codexVersion = input.codexVersion;
  if (input.codexLatestVersion) machine.codexLatestVersion = input.codexLatestVersion;
  if (input.machineZone) machine.tz = input.machineZone;
  return machine;
}

export function toSyncBatch(
  batch: Batch,
  machine: MachineInfo,
  meta: {
    cliVersion: string;
    batchId: string;
    sentAt: number;
    rateLimit: RateLimitSnapshot | null;
    // Pass SyncPlan.rateLimitChanged here: the payload includes rateLimit only when true, so an
    // unchanged snapshot (already known to the server) is never re-sent, even though the caller
    // should keep persisting SyncPlan.rateLimit locally on every run regardless of this flag.
    rateLimitChanged: boolean;
  },
): SyncBatch {
  const payload: SyncBatch = {
    schemaVersion: SCHEMA_VERSION,
    parserVersion: PARSER_VERSION,
    cliVersion: meta.cliVersion,
    batchId: meta.batchId,
    sentAt: meta.sentAt,
    machine,
    sessions: batch.sessions,
    tokenEvents: batch.tokenEvents,
  };
  if (meta.rateLimitChanged && meta.rateLimit) payload.rateLimit = meta.rateLimit;
  return payload;
}
