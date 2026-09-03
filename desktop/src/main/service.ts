/**
 * Everything the card knows, and the only thing that knows how to change it.
 *
 * The numbers themselves are not assembled here — `runCard` in the collector does that, and this
 * calls it. What lives here is what a long-running app needs and a one-shot command does not: one
 * persistent sampler instead of a fresh baseline every refresh, timers that stop when nobody is
 * looking, and a digest gate so an idle card does no render work.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import { createHash } from "node:crypto";
import { createSampler, type Sampler, type SamplerOptions } from "@cli/card/sampler";
import { runCard, type CardReport } from "@cli/commands/card";
import { runSync } from "@cli/commands/sync";
import { BAKED_WEB_ORIGIN, CLI_VERSION } from "@cli/build-info";
import { kabooPaths, type KabooPaths } from "@cli/core/paths";
import { machineZone } from "@cli/parser/time";
import { createClient } from "@cli/upload/client";
import type { CardState, SyncStatus, UpdateSettingsRequest } from "./ipc";
import { normalizeSettings, readSettings, writeSettings, type CardSettings } from "./settings";

/** How often the live strip is re-read while the card is on screen. */
export const LIVE_TICK_MS = 2000;

export interface ServiceDeps {
  paths?: KabooPaths;
  now?: () => number;
  appVersion: string;
}

export interface CardService {
  state(): CardState;
  /** Called whenever the state changes in a way the card would draw differently. */
  subscribe(listener: (state: CardState) => void): () => void;
  /** Load settings and paint from the cache. Safe to call once, at startup. */
  start(): Promise<void>;
  /** Refetch the server summary. */
  refresh(): Promise<void>;
  /** Run a full `codex-kaboo sync`, then refetch. */
  syncNow(): Promise<void>;
  updateSettings(patch: UpdateSettingsRequest): Promise<CardSettings>;
  /** Start/stop the live sampler's timer as the card is shown and hidden. */
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * Wraps one long-lived sampler so `runCard` can be handed a factory without creating (and
 * re-baselining) a new one on every refresh.
 *
 * `tick()` is serialised through a promise chain. Two overlapping ticks would each read from the
 * same recorded offset and emit the same appended events twice — the card's own refresh and its
 * 2-second timer can otherwise land together, so this is not hypothetical.
 */
function liveSampler(): {
  factory: (opts: SamplerOptions) => Sampler;
  tick: () => Promise<void>;
  dispose: () => void;
} {
  let real: Sampler | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const tick = async (): Promise<void> => {
    const next = chain.then(async () => {
      if (real) await real.tick();
    });
    // Never let one failed tick poison the chain for every later one.
    chain = next.catch(() => undefined);
    await chain;
  };

  return {
    factory(opts: SamplerOptions): Sampler {
      // Created on the first assembly, when `runCard` has resolved the Codex homes from config.
      // A long-running card MUST baseline, unlike the one-shot command: see SamplerOptions.
      real ??= createSampler({ ...opts, baseline: true });
      const sampler = real;
      return {
        async tick() {
          await tick();
          // The facade reports what the sampler holds now rather than what this call read, because
          // the timer may have done the reading. Only the counts are used, for diagnostics.
          return {
            at: Date.now(),
            filesTracked: sampler.trackedSessions().length,
            filesRead: 0,
            filesBaselined: 0,
            newSamples: 0,
            errors: [],
          };
        },
        samples: () => sampler.samples(),
        window: (bucketOpts) => sampler.window(bucketOpts),
        trackedSessions: () => sampler.trackedSessions(),
      };
    },
    tick,
    dispose() {
      real = null;
    },
  };
}

/** What the card would draw, hashed. Timestamps that tick on their own are left out. */
function reportDigest(report: CardReport | null, settings: CardSettings, sync: SyncStatus): string {
  const shape = report === null ? null : { ...report, generatedAt: 0, ageMs: 0 };
  return createHash("sha1").update(JSON.stringify({ shape, settings, sync })).digest("hex");
}

/**
 * The dashboard's origin. Baked at build time like the collector's upgrade hint; null when the
 * build did not carry one, in which case the card hides the link rather than guessing a URL.
 */
export function dashboardUrl(): string | null {
  return BAKED_WEB_ORIGIN ?? null;
}

export function createService(deps: ServiceDeps): CardService {
  const paths = deps.paths ?? kabooPaths();
  const now = deps.now ?? (() => Date.now());
  const listeners = new Set<(state: CardState) => void>();
  const sampler = liveSampler();

  let settings: CardSettings = normalizeSettings(null);
  let report: CardReport | null = null;
  let sync: SyncStatus = { state: "idle", lastError: null };
  let refreshing = false;
  let lastDigest = "";
  let liveTimer: NodeJS.Timeout | null = null;
  let refreshTimer: NodeJS.Timeout | null = null;
  let visible = false;
  let disposed = false;

  function state(): CardState {
    return {
      report,
      settings,
      sync,
      refreshing,
      dashboardUrl: dashboardUrl(),
      appVersion: deps.appVersion,
    };
  }

  /** Pushes only when the card would look different — an idle card does no render work. */
  function publish(force = false): void {
    const digest = reportDigest(report, settings, sync);
    if (!force && digest === lastDigest) return;
    lastDigest = digest;
    const snapshot = state();
    for (const listener of listeners) listener(snapshot);
  }

  async function assemble(offline: boolean): Promise<void> {
    report = await runCard(
      { json: true, offline, windowMinutes: settings.windowMinutes },
      {
        paths,
        env: process.env,
        now,
        cliVersion: CLI_VERSION,
        machineZone: machineZone(),
        platform: process.platform,
        createClient: (config) =>
          createClient({ server: config.server, token: config.token, cliVersion: CLI_VERSION }),
        createSampler: sampler.factory,
      },
    );
  }

  function restartRefreshTimer(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      void refresh();
    }, settings.refreshMs);
    // The card is a background app; its timers must never be the reason the process stays alive.
    refreshTimer.unref?.();
  }

  async function refresh(): Promise<void> {
    if (disposed || refreshing) return;
    refreshing = true;
    publish();
    try {
      await assemble(false);
    } finally {
      refreshing = false;
      publish();
    }
  }

  return {
    state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start() {
      settings = await readSettings(paths);
      // Offline first: the cached snapshot paints immediately, and the quota row comes straight
      // from `state.json` with no network at all. Then the real fetch replaces both.
      await assemble(true);
      publish(true);
      restartRefreshTimer();
      await refresh();
    },

    refresh,

    async syncNow() {
      if (disposed || sync.state === "running") return;
      sync = { state: "running" };
      publish();
      try {
        // `runSync` takes `~/.codex-kaboo/sync.lock` itself and reports a warning rather than
        // failing when the scheduled sync already holds it. That is exactly the behaviour wanted
        // here: a card must never corrupt `state.json` by writing behind a running sync.
        const result = await runSync(
          { full: false, dryRun: false, scheduled: false, json: true },
          {
            paths,
            env: process.env,
            now,
            log: {
              debug: () => undefined,
              info: () => undefined,
              warn: () => undefined,
              error: () => undefined,
            },
            cliVersion: CLI_VERSION,
            machineZone: machineZone(),
            newId: () => randomUUID(),
            createClient: (config) =>
              createClient({ server: config.server, token: config.token, cliVersion: CLI_VERSION }),
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.versions.node,
            hostname: () => os.hostname(),
            pid: process.pid,
          },
        );
        const blocked = result.warnings.find((w) => w.startsWith("another sync is running"));
        sync = blocked
          ? { state: "blocked", holder: blocked }
          : {
              state: "idle",
              lastError: result.exitCode === 0 ? null : (result.errors[0] ?? "sync failed"),
            };
      } catch (error) {
        sync = {
          state: "idle",
          lastError: error instanceof Error ? error.message : String(error),
        };
      }
      publish();
      await refresh();
    },

    async updateSettings(patch) {
      const next = normalizeSettings({ ...settings, ...patch });
      const refreshChanged = next.refreshMs !== settings.refreshMs;
      const windowChanged = next.windowMinutes !== settings.windowMinutes;
      settings = next;
      await writeSettings(paths, next);
      if (refreshChanged) restartRefreshTimer();
      // A different window width changes the live strip without any new data, so re-assemble from
      // the cache rather than making the user wait for a fetch that would return the same totals.
      if (windowChanged) await assemble(true);
      publish();
      return next;
    },

    setVisible(next) {
      visible = next;
      if (liveTimer) {
        clearInterval(liveTimer);
        liveTimer = null;
      }
      if (!visible || disposed) return;
      liveTimer = setInterval(() => {
        void (async () => {
          await sampler.tick();
          // Re-assembling offline is cheap — no network, no disk write unless the digest moved —
          // and it is what turns a sampler tick into new numbers on the card.
          await assemble(true);
          publish();
        })();
      }, LIVE_TICK_MS);
      liveTimer.unref?.();
      // Paint the moment the card opens rather than after the first tick.
      void (async () => {
        await sampler.tick();
        await assemble(true);
        publish();
      })();
    },

    dispose() {
      disposed = true;
      if (liveTimer) clearInterval(liveTimer);
      if (refreshTimer) clearInterval(refreshTimer);
      liveTimer = null;
      refreshTimer = null;
      listeners.clear();
      sampler.dispose();
    },
  };
}
