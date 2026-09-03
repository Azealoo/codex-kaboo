/**
 * The live tokens-per-second sampler: tails the rollout files Codex is writing right now and turns
 * their token events into `TpsSample`s.
 *
 * It reuses the collector's own reducer rather than re-reading Codex's format, so it inherits the
 * `token_count`-vs-`token_usage_record` handling, the model/effort attribution and the timestamp
 * rules for free — and any fix to those lands here too. What it does NOT touch is `sync`'s state
 * file or its lock: the sampler is read-only, never writes `state.json`, and so cannot race a
 * scheduled sync.
 *
 * Two behaviours carry the whole design:
 *
 *  - **Baseline on first sight.** A file is read to its end once, folded into a reducer, and every
 *    event that pass produced is thrown away. Without this, opening the card at lunchtime draws a
 *    morning's worth of tokens as if they had just happened.
 *  - **Incremental afterwards.** Each tick reads only the bytes appended since the last one and
 *    feeds them to the same live reducer, so a busy 20 MB session costs a few hundred bytes per
 *    poll instead of 20 MB.
 */
import { promises as fs } from "node:fs";
import { TPS_FILE_WINDOW_MS, TPS_RETAIN_MS } from "@codex-kaboo/shared/constants";
import { discoverRolloutFiles, type DiscoveredFile } from "../core/discover";
import { readJsonlLines } from "../core/jsonl-reader";
import { createReducerState, finalize, reduceLine, type ReducerState } from "../parser/session";
import {
  bucketize,
  trimSamples,
  type BucketOptions,
  type TpsSample,
  type TpsWindow,
} from "./buckets";

export interface SamplerOptions {
  /** Codex homes to watch, already resolved (see `resolveCodexHomes`). */
  homes: string[];
  now?: () => number;
  machineZone?: string;
  /** How much sample history to keep. */
  retainMs?: number;
  /** A file is worth tailing if it was modified within this long. */
  fileWindowMs?: number;
  /** How often the homes are re-scanned; between scans only tracked files are stat'd. */
  discoverEveryMs?: number;
  /**
   * Whether a newly adopted file's existing events are discarded (the default) or emitted.
   *
   * A long-running card MUST baseline, or opening it at lunchtime draws the morning's tokens as if
   * they had just happened. A one-shot reader — `codex-kaboo card`, which starts, reads and exits —
   * wants the opposite: the last few minutes of history are the only thing it can report, and
   * `retainMs` already bounds how far back that reaches.
   */
  baseline?: boolean;
}

export interface SamplerTick {
  at: number;
  filesTracked: number;
  /** Files that had new bytes this tick. */
  filesRead: number;
  /** Files read in full because they were new, truncated, or had flipped token mechanism. */
  filesBaselined: number;
  newSamples: number;
  /** Per-file read failures, by message. A file that fails is dropped and re-discovered later. */
  errors: string[];
}

export interface Sampler {
  tick(): Promise<SamplerTick>;
  /** Retained samples, oldest first. */
  samples(): TpsSample[];
  window(opts?: BucketOptions): TpsWindow;
  /** Session ids currently being tailed. */
  trackedSessions(): string[];
}

interface Tracked {
  /** The discovered file, kept so a re-baseline can rebuild the reducer with its real metadata. */
  file: DiscoveredFile;
  offset: number;
  lines: number;
  size: number;
  mtimeMs: number;
  state: ReducerState;
  /** Highest event `seq` already turned into a sample. −1 before anything has been emitted. */
  emittedSeq: number;
  /** Which of Codex's two mechanisms the file was last parsed as. */
  origin: "count" | "record";
}

/** What a tick knows about a file before reading it, from a full scan or a bare stat. */
interface Candidate {
  sessionId: string;
  size: number;
  mtimeMs: number;
  /** Present only on the discovery path; a stat cannot produce one. */
  discovered?: DiscoveredFile;
}

export function createSampler(opts: SamplerOptions): Sampler {
  const now = opts.now ?? (() => Date.now());
  const retainMs = opts.retainMs ?? TPS_RETAIN_MS;
  const fileWindowMs = opts.fileWindowMs ?? TPS_FILE_WINDOW_MS;
  const discoverEveryMs = opts.discoverEveryMs ?? 15_000;
  const baselineNewFiles = opts.baseline ?? true;

  const tracked = new Map<string, Tracked>();
  let samples: TpsSample[] = [];
  let lastDiscoveryAt: number | null = null;

  function reducerFor(file: DiscoveredFile): ReducerState {
    return createReducerState({
      sessionId: file.sessionId,
      threadId: file.threadId,
      rolloutId: file.rolloutId,
      fileTimestampMs: file.fileTimestampMs,
      ...(opts.machineZone === undefined ? {} : { machineZone: opts.machineZone }),
    });
  }

  /** Folds whatever is new into the entry's reducer; `fresh` restarts it from byte 0. */
  async function advance(entry: Tracked, size: number, mtimeMs: number, fresh: boolean) {
    if (fresh) {
      entry.state = reducerFor(entry.file);
      entry.offset = 0;
      entry.lines = 0;
    }
    const read = await readJsonlLines(
      entry.file.path,
      (record) => reduceLine(entry.state, record.seq, record.text),
      { start: entry.offset, startSeq: entry.lines },
    );
    entry.offset = read.consumed;
    entry.lines = read.lines;
    entry.size = size;
    entry.mtimeMs = mtimeMs;
  }

  /** Turns the reducer's events into samples, skipping the ones already emitted. */
  function harvest(entry: Tracked, at: number, baseline: boolean): number {
    const parsed = finalize(entry.state, { now: at, generation: 0 });
    const origin = parsed.summary.eventOrigin;
    // The mechanism is a whole-file decision the reducer re-takes on every parse, and `finalize`
    // returns one list or the other. When it flips — a session that starts with `token_count`
    // lines and later emits its first `token_usage_record` — the two lists can describe the same
    // responses under different seqs, so carrying the old high-water mark over would count those
    // responses twice. Re-baseline instead: everything the file holds at the moment of the flip
    // counts as history.
    //
    // `emittedSeq >= 0` is what keeps that from firing on the ordinary case. A file first seen
    // before it has produced any tokens at all baselines as `count` (nothing has set
    // `hasUsageRecords`), so its very first `token_usage_record` would otherwise look like a flip
    // and be discarded — losing the first response of every session the card is open for.
    const flipped = origin !== entry.origin && entry.emittedSeq >= 0;
    entry.origin = origin;
    const highest = parsed.events.reduce((max, event) => Math.max(max, event.seq), -1);
    if (baseline || flipped) {
      entry.emittedSeq = highest;
      return 0;
    }
    let added = 0;
    for (const event of parsed.events) {
      if (event.seq <= entry.emittedSeq) continue;
      if (event.output <= 0) continue;
      samples.push({
        ts: event.ts,
        output: event.output,
        model: event.model,
        sessionId: event.sessionId,
      });
      added += 1;
    }
    entry.emittedSeq = Math.max(entry.emittedSeq, highest);
    return added;
  }

  async function candidatesFromStat(): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const entry of tracked.values()) {
      try {
        const stat = await fs.stat(entry.file.path);
        out.push({ sessionId: entry.file.sessionId, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Gone or unreadable: leave it tracked and let the next full scan settle it.
      }
    }
    return out;
  }

  async function candidatesFromScan(at: number): Promise<Candidate[]> {
    const result = await discoverRolloutFiles(opts.homes);
    // Compressed rollouts are Codex's archived, finished sessions — nothing appends to them, and
    // they cannot be resumed from an offset. They are history, which is the dashboard's job.
    const live = result.files.filter(
      (file) => !file.compressed && file.mtimeMs > at - fileWindowMs,
    );
    // Anything that fell out of the window stops being tracked, which is also what frees its
    // reducer — the only thing in here that grows with a session's length.
    const ids = new Set(live.map((file) => file.sessionId));
    for (const sessionId of [...tracked.keys()]) {
      if (!ids.has(sessionId)) tracked.delete(sessionId);
    }
    return live.map((file) => ({
      sessionId: file.sessionId,
      size: file.size,
      mtimeMs: file.mtimeMs,
      discovered: file,
    }));
  }

  return {
    async tick(): Promise<SamplerTick> {
      const at = now();
      const errors: string[] = [];
      let filesRead = 0;
      let filesBaselined = 0;
      let newSamples = 0;

      const rediscover = lastDiscoveryAt === null || at - lastDiscoveryAt >= discoverEveryMs;
      const candidates = rediscover ? await candidatesFromScan(at) : await candidatesFromStat();
      if (rediscover) lastDiscoveryAt = at;

      for (const candidate of candidates) {
        const existing = tracked.get(candidate.sessionId);
        try {
          if (existing === undefined) {
            // Only the discovery path can adopt a file: a bare stat has no session metadata to
            // build a reducer from, and a file that is not tracked yet was not in that scan.
            if (candidate.discovered === undefined) continue;
            const entry: Tracked = {
              file: candidate.discovered,
              offset: 0,
              lines: 0,
              size: candidate.size,
              mtimeMs: candidate.mtimeMs,
              state: reducerFor(candidate.discovered),
              emittedSeq: -1,
              origin: "count",
            };
            await advance(entry, candidate.size, candidate.mtimeMs, true);
            newSamples += harvest(entry, at, baselineNewFiles);
            tracked.set(candidate.sessionId, entry);
            if (baselineNewFiles) filesBaselined += 1;
            filesRead += 1;
            continue;
          }
          // A rollout that shrank was rewritten under us. The recorded offset now points into
          // different bytes, so the only safe move is to start over and treat what the file holds
          // as history, exactly like a first sighting.
          if (candidate.size < existing.offset) {
            await advance(existing, candidate.size, candidate.mtimeMs, true);
            harvest(existing, at, true);
            filesBaselined += 1;
            filesRead += 1;
            continue;
          }
          if (candidate.size === existing.size && candidate.mtimeMs === existing.mtimeMs) continue;
          await advance(existing, candidate.size, candidate.mtimeMs, false);
          newSamples += harvest(existing, at, false);
          filesRead += 1;
        } catch (error) {
          // A file that cannot be read is dropped rather than retried in a tight loop; the next
          // discovery picks it up again if it is still there.
          tracked.delete(candidate.sessionId);
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      samples = trimSamples(samples, at, retainMs);
      return { at, filesTracked: tracked.size, filesRead, filesBaselined, newSamples, errors };
    },

    samples(): TpsSample[] {
      return [...samples].sort((a, b) => a.ts - b.ts);
    },

    window(bucketOpts: BucketOptions = {}): TpsWindow {
      return bucketize(samples, now(), bucketOpts);
    },

    trackedSessions(): string[] {
      return [...tracked.keys()].sort();
    },
  };
}
