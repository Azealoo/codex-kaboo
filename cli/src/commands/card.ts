/**
 * `codex-kaboo card` — the menu bar card's exact payload, on stdout, with no GUI.
 *
 * This is the card's data layer, and the desktop app is a renderer for it: both call `runCard`, so
 * there is one assembly of "server summary + local quota + live sampler", one set of fallbacks, and
 * one answer to "why does the card say that". It also means the whole thing is testable in CI on
 * every platform, including the ones where a tray icon cannot be drawn.
 */
import { QUOTA_STALE_MS } from "@codex-kaboo/shared/constants";
import { dayHourIn } from "@codex-kaboo/shared/days";
import {
  formatCompact,
  formatDeltaPercent,
  formatPercent,
  formatRelative,
  formatResetsIn,
  formatUsd,
} from "@codex-kaboo/shared/format";
import {
  SUMMARY_RANGE_KEYS,
  type QuotaEnvelope,
  type RangeSummary,
  type SummaryRangeKey,
  type SummaryResponse,
} from "@codex-kaboo/shared/summary";
import type { RateLimitSnapshot } from "@codex-kaboo/shared/sync";
import { createSampler, type Sampler, type SamplerOptions } from "../card/sampler";
import type { TpsWindow } from "../card/buckets";
import {
  identityOf,
  readSnapshotCache,
  writeSnapshotCache,
  type SnapshotIdentity,
} from "../card/snapshot";
import { readConfig } from "../core/config";
import type { KabooPaths } from "../core/paths";
import { resolveCodexHomes } from "../core/paths";
import { readState } from "../core/state";
import type { Config } from "../types";
import { isAuthError, type SyncClient } from "../upload/client";

export interface CardOptions {
  json: boolean;
  /** Never touch the network: render from the cache and local state alone. */
  offline?: boolean;
  /** Width of the live TPS window, in minutes. */
  windowMinutes?: number;
  codexHome?: string;
}

export interface CardDeps {
  paths: KabooPaths;
  env: NodeJS.ProcessEnv;
  now: () => number;
  cliVersion: string;
  /** As `machineZone()` reports it: undefined when the platform will not say. */
  machineZone: string | undefined;
  platform: NodeJS.Platform;
  createClient: (config: Config) => SyncClient;
  /** Injectable so tests can drive the sampler's clock; defaults to the real one. */
  createSampler?: (opts: SamplerOptions) => Sampler;
}

/** Where the totals on the card came from. */
export type CardSource = "server" | "cache" | "none";

export interface CardReport {
  ok: boolean;
  generatedAt: number;
  /** The machine's own calendar day — what the four ranges are anchored on. */
  today: string;
  cliVersion: string;
  machine: { label: string | null; platform: string };
  account: { userId: string; name: string } | null;
  server: string | null;
  source: CardSource;
  ranges: Record<SummaryRangeKey, RangeSummary> | null;
  /** When the totals were fetched; null when they never were. */
  fetchedAt: number | null;
  ageMs: number | null;
  quota: QuotaEnvelope;
  live: TpsWindow;
  /**
   * What the sampler actually looked at. Without this, a live strip reading zero is ambiguous
   * between "no Codex session is running", "the session is idle" and "the files could not be
   * read" — and telling those apart is most of what this command is for.
   */
  sampled: { homes: string[]; filesTracked: number; filesRead: number };
  sync: { lastSyncAt: number | null; lastSyncOk: boolean | null; lastError: string | null };
  /** Anything that went wrong but did not stop a card being drawn. */
  errors: string[];
  exitCode: number;
}

/** Wraps this machine's own `state.json` reading, for the first paint and for offline use. */
export function localQuota(snapshot: RateLimitSnapshot | null, now: number): QuotaEnvelope {
  if (snapshot === null) return { value: null, source: "none", fetchedAt: now, stale: false };
  return {
    value: {
      usedPercent: snapshot.usedPercent,
      windowMinutes: snapshot.windowMinutes,
      resetsAt: snapshot.resetsAt ?? null,
      planType: snapshot.planType ?? null,
      limitId: snapshot.limitId ?? null,
      observedAt: snapshot.observedAt,
      // Never been near a server clock, so staleness falls back to the observation time — the only
      // timestamp there is. Both it and `now` come from this machine, so at least they agree.
      receivedAt: null,
      machine: null,
    },
    source: "local",
    fetchedAt: now,
    stale: now - snapshot.observedAt > QUOTA_STALE_MS,
  };
}

/**
 * The server's account-wide reading wins when it has one: the Codex limit is shared, so the
 * freshest machine's number describes the account better than this machine's does. Local is the
 * fallback, and it is the reason the quota row paints before any network call returns.
 */
export function pickQuota(
  fromServer: QuotaEnvelope | null,
  fromLocal: QuotaEnvelope,
): QuotaEnvelope {
  if (fromServer !== null && fromServer.value !== null) return fromServer;
  return fromLocal;
}

export async function runCard(opts: CardOptions, deps: CardDeps): Promise<CardReport> {
  const now = deps.now();
  const errors: string[] = [];
  const config = await readConfig(deps.paths).catch((error: unknown) => {
    errors.push(error instanceof Error ? error.message : String(error));
    return null;
  });
  const { state } = await readState(deps.paths);
  const today = dayHourIn(now, deps.machineZone).day;

  const homes = resolveCodexHomes({
    ...(opts.codexHome === undefined ? {} : { override: opts.codexHome }),
    env: deps.env,
    ...(config === null ? {} : { configured: config.codexHomes }),
  });
  const makeSampler = deps.createSampler ?? createSampler;
  const sampler = makeSampler({
    homes,
    now: deps.now,
    ...(deps.machineZone === undefined ? {} : { machineZone: deps.machineZone }),
    // One shot: this process starts, reads and exits, so the only live rate it can report is the
    // one already written to the files. See `SamplerOptions.baseline`.
    baseline: false,
  });
  const tick = await sampler.tick();
  errors.push(...tick.errors);
  const live = sampler.window(
    opts.windowMinutes === undefined ? {} : { windowMs: opts.windowMinutes * 60_000 },
  );
  const sampled = { homes, filesTracked: tick.filesTracked, filesRead: tick.filesRead };

  const sync = {
    lastSyncAt: state.lastSyncAt,
    lastSyncOk: state.lastSyncOk,
    lastError: state.lastError,
  };
  const local = localQuota(state.rateLimit, now);

  if (config === null) {
    return {
      ok: false,
      generatedAt: now,
      today,
      cliVersion: deps.cliVersion,
      machine: { label: null, platform: deps.platform },
      account: null,
      server: null,
      source: "none",
      ranges: null,
      fetchedAt: null,
      ageMs: null,
      quota: local,
      live,
      sampled,
      sync,
      errors: [...errors, "not logged in (run `codex-kaboo login`)"],
      exitCode: 2,
    };
  }

  const identity: SnapshotIdentity = identityOf(config);
  const cached = await readSnapshotCache(deps.paths, identity);
  let summary: SummaryResponse | null = cached?.summary ?? null;
  let fetchedAt: number | null = cached?.fetchedAt ?? null;
  let source: CardSource = summary === null ? "none" : "cache";

  if (opts.offline !== true) {
    try {
      const fresh = await deps.createClient(config).summary(today);
      summary = fresh;
      fetchedAt = now;
      source = "server";
      await writeSnapshotCache(deps.paths, identity, fresh, now);
    } catch (error) {
      // A failed refresh is not a failed card: the cached numbers are still the right numbers,
      // just older, and the age is on screen. Only a failure with nothing cached is worth an
      // error exit — except for an auth failure, which no amount of cache makes acceptable to
      // stay quiet about.
      const message = error instanceof Error ? error.message : String(error);
      errors.push(isAuthError(error) ? `${message} (run \`codex-kaboo login\`)` : message);
    }
  }

  const quota = pickQuota(summary?.quota ?? null, local);
  const ok = summary !== null;
  return {
    ok,
    generatedAt: now,
    today,
    cliVersion: deps.cliVersion,
    machine: { label: config.label, platform: deps.platform },
    account:
      summary !== null
        ? summary.user
        : config.userId !== undefined
          ? { userId: config.userId, name: config.userName ?? "" }
          : null,
    server: config.server,
    source,
    ranges: summary?.ranges ?? null,
    fetchedAt,
    ageMs: fetchedAt === null ? null : Math.max(0, now - fetchedAt),
    quota,
    live,
    sampled,
    sync,
    errors,
    exitCode: ok ? 0 : 1,
  };
}

const RANGE_LABELS: Record<SummaryRangeKey, string> = {
  day: "day",
  week: "week",
  month: "month",
  all: "all",
};

function rangeLine(key: SummaryRangeKey, range: RangeSummary): string {
  const unpriced =
    range.unpricedModels.length > 0 ? ` (${range.unpricedModels.length} unpriced)` : "";
  return [
    `  ${RANGE_LABELS[key].padEnd(6)}`,
    `${formatCompact(range.tokens.total).padStart(8)} tokens`,
    `${formatDeltaPercent(range.changePercent).padStart(8)}`,
    `${formatUsd(range.costUsd).padStart(9)}${unpriced}`,
    `${String(range.sessions).padStart(4)} sessions`,
    range.topModel ?? "",
  ].join("  ");
}

function quotaLine(quota: QuotaEnvelope, now: number): string {
  if (quota.value === null) return "quota: no reading yet (it arrives with the next sync)";
  const v = quota.value;
  const window =
    v.windowMinutes >= 1440
      ? `${Math.round(v.windowMinutes / 1440)}d`
      : `${Math.round(v.windowMinutes / 60)}h`;
  const from = v.machine ? `${quota.source}, ${v.machine.label}` : quota.source;
  return `quota: ${formatPercent(v.usedPercent / 100, 0)} of the ${window} window used · ${formatResetsIn(v.resetsAt, now)} · ${from}${quota.stale ? " · stale" : ""}`;
}

export function formatCard(report: CardReport): string[] {
  const now = report.generatedAt;
  const lines: string[] = [];
  const who = report.account?.name ?? report.machine.label ?? "this machine";
  lines.push(`codex-kaboo card — ${who} · ${report.today}`);
  if (report.ranges === null) {
    lines.push(
      report.exitCode === 2
        ? "  no totals: not logged in (run `codex-kaboo login`)"
        : "  no totals: the server could not be reached and nothing is cached",
    );
  } else {
    const age =
      report.fetchedAt === null
        ? "never fetched"
        : report.source === "server"
          ? "just fetched"
          : `cached, ${formatRelative(report.fetchedAt, now)}`;
    lines.push(`  ${report.server} · ${age}`);
    for (const key of SUMMARY_RANGE_KEYS) lines.push(rangeLine(key, report.ranges[key]));
  }
  lines.push(`  ${quotaLine(report.quota, now)}`);
  lines.push(
    `  live: ${report.live.currentTps.toFixed(0)} TPS now · ${report.live.averageTps.toFixed(1)} TPS avg` +
      ` · ${report.live.activeSessions} active session${report.live.activeSessions === 1 ? "" : "s"}` +
      ` · peak ${report.live.peakTps.toFixed(0)}` +
      ` · tailing ${report.sampled.filesTracked} rollout file${report.sampled.filesTracked === 1 ? "" : "s"}`,
  );
  lines.push(
    `  last sync: ${report.sync.lastSyncAt === null ? "never" : formatRelative(report.sync.lastSyncAt, now)}` +
      (report.sync.lastSyncOk === false ? ` (failed: ${report.sync.lastError ?? "unknown"})` : ""),
  );
  for (const error of report.errors) lines.push(`  ! ${error}`);
  return lines;
}
