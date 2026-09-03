import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSampler } from "../../src/card/sampler";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const SESSION = "0199f1c0-0000-7000-8000-00000000d001";
const SESSION_2 = "0199f1c0-0000-7000-8000-00000000d002";

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

/** A `session_meta` line plus a turn context, which is what gives events their model. */
function header(offsetMs: number, threadId: string, model = "gpt-5.6-sol"): string {
  return (
    JSON.stringify({
      timestamp: iso(offsetMs),
      ordinal: 0,
      type: "session_meta",
      payload: {
        id: threadId,
        timestamp: iso(offsetMs),
        cwd: "/tmp/project-live",
        originator: "codex-tui",
        source: "cli",
        cli_version: "0.150.1",
        base_instructions: { text: "x", provenance: { type: "model", model } },
      },
    }) +
    "\n" +
    JSON.stringify({
      timestamp: iso(offsetMs),
      ordinal: 1,
      type: "turn_context",
      payload: { turn_id: "t1", model, effort: "medium", timezone: "UTC" },
    }) +
    "\n"
  );
}

/** One `token_usage_record` line: a per-response delta, so `output` is exactly what it says. */
function usage(offsetMs: number, output: number, ordinal: number): string {
  return (
    JSON.stringify({
      timestamp: iso(offsetMs),
      ordinal,
      type: "token_usage_record",
      payload: {
        turn_id: "t1",
        usage: {
          input_tokens: 300,
          cached_input_tokens: 100,
          cache_write_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: 0,
          total_tokens: 300 + output,
        },
      },
    }) + "\n"
  );
}

/**
 * One `token_count` line. Codex reports the session's running total in `total_token_usage` and the
 * response's own usage in `last_token_usage`; the parser reads the latter, so that is what a
 * sample's `output` should equal.
 */
function count(
  offsetMs: number,
  output: number,
  cumulativeOutput: number,
  ordinal: number,
): string {
  const body = (out: number) => ({
    input_tokens: 1000 + out,
    cached_input_tokens: 500,
    cache_write_input_tokens: 0,
    output_tokens: out,
    reasoning_output_tokens: 0,
    total_tokens: 1000 + out * 2,
  });
  return (
    JSON.stringify({
      timestamp: iso(offsetMs),
      ordinal,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: body(cumulativeOutput),
          last_token_usage: body(output),
        },
      },
    }) + "\n"
  );
}

function makeHome(): { home: string; write: (threadId: string, body: string) => string } {
  const home = mkdtempSync(path.join(os.tmpdir(), "ck-sampler-"));
  tmpDirs.push(home);
  const dir = path.join(home, "sessions", "2026", "09", "03");
  mkdirSync(dir, { recursive: true });
  const write = (threadId: string, body: string): string => {
    const file = path.join(dir, `rollout-2026-09-03T11-00-00-${threadId}.jsonl`);
    writeFileSync(file, body);
    // Keep mtime inside the sampler's file window, which is measured against the injected clock.
    const seconds = (NOW - 60_000) / 1000;
    utimesSync(file, seconds, seconds);
    return file;
  };
  return { home, write };
}

function samplerFor(home: string, clock: { now: number }) {
  return createSampler({
    homes: [home],
    now: () => clock.now,
    machineZone: "UTC",
    discoverEveryMs: 0, // rescan every tick; the discovery cadence is tested on its own below
  });
}

describe("createSampler", () => {
  it("baselines a file it has never seen and emits nothing for its history", async () => {
    const { home, write } = makeHome();
    write(SESSION, header(-600_000, SESSION) + usage(-600_000, 500, 2) + usage(-300_000, 400, 3));
    const clock = { now: NOW };
    const sampler = samplerFor(home, clock);

    const tick = await sampler.tick();
    expect(tick.filesTracked).toBe(1);
    expect(tick.filesBaselined).toBe(1);
    expect(tick.newSamples).toBe(0);
    expect(sampler.samples()).toEqual([]);
    expect(sampler.trackedSessions()).toEqual([SESSION]);
  });

  it("emits only what is appended after the baseline", async () => {
    const { home, write } = makeHome();
    const file = write(SESSION, header(-600_000, SESSION) + usage(-600_000, 999, 2));
    const clock = { now: NOW };
    const sampler = samplerFor(home, clock);
    await sampler.tick();

    appendFileSync(file, usage(-2000, 120, 3));
    clock.now = NOW + 1000;
    const tick = await sampler.tick();

    expect(tick.newSamples).toBe(1);
    expect(tick.filesBaselined).toBe(0);
    expect(sampler.samples()).toEqual([
      { ts: NOW - 2000, output: 120, model: "gpt-5.6-sol", sessionId: SESSION },
    ]);
  });

  it("reads only the appended bytes, not the whole file, on a later tick", async () => {
    const { home, write } = makeHome();
    const file = write(SESSION, header(-600_000, SESSION) + usage(-600_000, 10, 2));
    const clock = { now: NOW };
    const sampler = samplerFor(home, clock);
    await sampler.tick();

    // Two appends in a row must each be picked up exactly once — the proof that the offset and the
    // line index both advance, since a reset offset would re-emit the first append.
    appendFileSync(file, usage(-4000, 30, 3));
    clock.now = NOW + 1000;
    expect((await sampler.tick()).newSamples).toBe(1);

    appendFileSync(file, usage(-1000, 40, 4));
    clock.now = NOW + 2000;
    expect((await sampler.tick()).newSamples).toBe(1);

    expect(sampler.samples().map((s) => s.output)).toEqual([30, 40]);
  });

  it("reads a token_count line's per-response usage, not the session running total", async () => {
    const { home, write } = makeHome();
    const file = write(SESSION, header(-600_000, SESSION) + count(-600_000, 100, 100, 2));
    const clock = { now: NOW };
    const sampler = samplerFor(home, clock);
    await sampler.tick();

    // The running total climbs 100 → 260 → 300; the samples are the per-response numbers.
    appendFileSync(file, count(-4000, 160, 260, 3) + count(-2000, 40, 300, 4));
    clock.now = NOW + 1000;
    await sampler.tick();
    expect(sampler.samples().map((s) => s.output)).toEqual([160, 40]);
  });

  it("re-baselines a file that shrank instead of replaying it", async () => {
    const { home, write } = makeHome();
    const file = write(SESSION, header(-600_000, SESSION) + usage(-600_000, 50, 2));
    const clock = { now: NOW };
    const sampler = samplerFor(home, clock);
    await sampler.tick();

    // Rewritten shorter than the recorded offset: the offset now points into different bytes.
    writeFileSync(file, header(-120_000, SESSION));
    clock.now = NOW + 1000;
    const tick = await sampler.tick();
    expect(tick.filesBaselined).toBe(1);
    expect(tick.newSamples).toBe(0);
    expect(sampler.samples()).toEqual([]);
  });

  it("does not double count when a session flips from token_count to token_usage_record", async () => {
    const { home, write } = makeHome();
    const file = write(SESSION, header(-600_000, SESSION) + count(-600_000, 100, 100, 2));
    const clock = { now: NOW };
    const sampler = samplerFor(home, clock);
    await sampler.tick();

    appendFileSync(file, count(-30_000, 100, 200, 3));
    clock.now = NOW + 1000;
    expect((await sampler.tick()).newSamples).toBe(1);

    // The first `token_usage_record` makes the whole file `record`-derived, so `finalize` returns a
    // different list under different seqs. That tick re-baselines; the tick after it resumes.
    appendFileSync(file, usage(-20_000, 70, 4));
    clock.now = NOW + 2000;
    expect((await sampler.tick()).newSamples).toBe(0);

    appendFileSync(file, usage(-10_000, 80, 5));
    clock.now = NOW + 3000;
    expect((await sampler.tick()).newSamples).toBe(1);
    expect(sampler.samples().map((s) => s.output)).toEqual([100, 80]);
  });

  it("tracks several sessions at once and reports them in the window", async () => {
    const { home, write } = makeHome();
    const a = write(SESSION, header(-600_000, SESSION));
    const b = write(SESSION_2, header(-600_000, SESSION_2, "gpt-5.6-luna"));
    const clock = { now: NOW };
    const sampler = samplerFor(home, clock);
    await sampler.tick();

    appendFileSync(a, usage(-10_000, 60, 2));
    appendFileSync(b, usage(-10_000, 30, 2));
    clock.now = NOW + 1000;
    await sampler.tick();

    const w = sampler.window();
    expect(w.totalOutput).toBe(90);
    expect(w.models).toEqual(["gpt-5.6-sol", "gpt-5.6-luna"]);
    expect(w.activeSessions).toBe(2);
  });

  it("forgets a file that has gone quiet, freeing its reducer", async () => {
    const { home, write } = makeHome();
    write(SESSION, header(-600_000, SESSION));
    const clock = { now: NOW };
    const sampler = samplerFor(home, clock);
    await sampler.tick();
    expect(sampler.trackedSessions()).toHaveLength(1);

    // The file's mtime is now well outside the window measured from the injected clock.
    clock.now = NOW + 60 * 60 * 1000;
    await sampler.tick();
    expect(sampler.trackedSessions()).toEqual([]);
  });

  it("ignores compressed rollouts, which are finished sessions", async () => {
    const { home } = makeHome();
    const dir = path.join(home, "sessions", "2026", "09", "03");
    const zst = path.join(dir, `rollout-2026-09-03T11-30-00-${SESSION_2}.jsonl.zst`);
    writeFileSync(zst, "not really zstd, and never read");
    const seconds = (NOW - 60_000) / 1000;
    utimesSync(zst, seconds, seconds);

    const sampler = samplerFor(home, { now: NOW });
    const tick = await sampler.tick();
    expect(tick.errors).toEqual([]);
    expect(sampler.trackedSessions()).toEqual([]);
  });

  it("drops history past the retention window", async () => {
    const { home, write } = makeHome();
    const file = write(SESSION, header(-600_000, SESSION));
    const clock = { now: NOW };
    const sampler = createSampler({
      homes: [home],
      now: () => clock.now,
      machineZone: "UTC",
      discoverEveryMs: 0,
      retainMs: 60_000,
    });
    await sampler.tick();

    appendFileSync(file, usage(-1000, 25, 2));
    clock.now = NOW + 1000;
    await sampler.tick();
    expect(sampler.samples()).toHaveLength(1);

    clock.now = NOW + 120_000;
    await sampler.tick();
    expect(sampler.samples()).toEqual([]);
  });

  it("only adopts new files on a discovery tick, not on the stat ticks between", async () => {
    const { home, write } = makeHome();
    write(SESSION, header(-600_000, SESSION));
    const clock = { now: NOW };
    const sampler = createSampler({
      homes: [home],
      now: () => clock.now,
      machineZone: "UTC",
      discoverEveryMs: 15_000,
    });
    await sampler.tick();
    expect(sampler.trackedSessions()).toEqual([SESSION]);

    write(SESSION_2, header(-600_000, SESSION_2));
    clock.now = NOW + 2000; // inside the discovery interval: only tracked files are stat'd
    await sampler.tick();
    expect(sampler.trackedSessions()).toEqual([SESSION]);

    clock.now = NOW + 16_000;
    await sampler.tick();
    expect(sampler.trackedSessions()).toEqual([SESSION, SESSION_2].sort());
  });
});
