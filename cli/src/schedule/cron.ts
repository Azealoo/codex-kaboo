import path from "node:path";
import { assertNoNewline, checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget, type Spawner } from "./index";

export const CRON_BEGIN = "# BEGIN codex-kaboo";
export const CRON_END = "# END codex-kaboo";

/**
 * Quotes one interpolated value for a crontab command field, which is two layers deep:
 *
 *  - cron reads the line first. An unescaped `%` becomes a newline (everything after it is fed to
 *    the job as stdin), so every `%` is escaped as `\%`; cron strips that backslash again before
 *    handing the line over.
 *  - `/bin/sh -c` then executes what is left. Double quotes were not enough there: `$VAR`, `$(…)`
 *    and backticks still expand inside them, and a trailing `\` escapes the closing quote — so a
 *    `CODEX_HOME` or `CODEX_KABOO_HOME` containing any of those (both are user-settable at install
 *    time) either silently broke the schedule or ran a command substitution every 15 minutes.
 *    Single quotes suppress every shell expansion instead; the only character they cannot contain
 *    is `'` itself, written as `'\''` — close, escaped quote, reopen.
 *
 * `%` is escaped last so it applies to the quoting punctuation too, and the backslash it introduces
 * is removed by cron before the shell sees the (still correctly single-quoted) line.
 *
 * A `\n` or `\r` inside `value` is refused rather than quoted: cron splits the crontab into one
 * entry per line *before* the shell ever parses this quoting, so an embedded newline cannot be
 * escaped into safety — see `assertNoNewline`.
 */
export function cronQuote(value: string): string {
  assertNoNewline(value, "a crontab entry");
  return `'${value.replace(/'/g, "'\\''")}'`.replace(/%/g, "\\%");
}

/** POSIX-only generator: `path.posix` so the crontab line is byte-identical wherever the tests run (Windows CI included). */
export function renderCronLine(target: ScheduleTarget): string {
  const env = ["CODEX_KABOO_SCHEDULED=1", ...(target.codexHome ? [`CODEX_HOME=${cronQuote(target.codexHome)}`] : [])].join(" ");
  const log = cronQuote(path.posix.join(target.kabooHome, "cron.log"));
  return `*/15 * * * * ${env} ${cronQuote(target.nodePath)} ${cronQuote(target.scriptPath)} ${scheduledArgs().join(" ")} >> ${log} 2>&1`;
}

export function removeCronBlock(existing: string): string {
  const lines = existing.split("\n");
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === CRON_BEGIN) {
      inside = true;
      continue;
    }
    if (line.trim() === CRON_END) {
      inside = false;
      continue;
    }
    if (!inside) out.push(line);
  }
  let text = out.join("\n");
  text = text.replace(/\n+$/, "");
  return text.length > 0 ? `${text}\n` : "";
}

/** Replaces (or appends) the marker block; running it twice yields the same crontab. */
export function upsertCronBlock(existing: string, line: string): string {
  const base = removeCronBlock(existing);
  return `${base}${CRON_BEGIN}\n${line}\n${CRON_END}\n`;
}

/**
 * Thrown by `readCrontab` when the `crontab` binary itself could not be run — missing entirely (a
 * minimal/container Linux image, most commonly) or timed out — as opposed to `crontab` running
 * fine and reporting "no crontab for this user", which is a normal, healthy "nothing installed
 * yet" result. `nodeSpawner` (the real `Spawner`, in `util/spawn.ts`) resolves `code: null` in
 * exactly these two cases and never for a `crontab` that ran and exited non-zero, so `code === null`
 * is the reliable signal. Conflating the two used to tell a crontab-less machine its schedule was
 * simply "not installed" and point it at a remedy (`codex-kaboo install`) that fails identically.
 */
export class CrontabUnavailableError extends Error {}

async function readCrontab(spawner: Spawner): Promise<string> {
  const result = await spawner.run("crontab", ["-l"]);
  if (result.code === 0) return result.stdout;
  if (result.code === null) {
    throw new CrontabUnavailableError(
      result.timedOut
        ? "crontab -l timed out"
        : `crontab could not be run${result.stderr.trim() ? `: ${result.stderr.trim()}` : " (is it installed?)"}`,
    );
  }
  if (/no crontab/i.test(result.stderr) || result.stdout.trim() === "") return "";
  throw new Error(`crontab -l failed: ${result.stderr.trim()}`);
}

export const cronAdapter: SchedulerAdapter = {
  name: "cron",
  async install(target, spawner) {
    const next = upsertCronBlock(await readCrontab(spawner), renderCronLine(target));
    const result = await spawner.run("crontab", ["-"], { input: next });
    if (result.code !== 0) throw new Error(`crontab - failed: ${result.stderr.trim()}`);
    return "crontab entry installed (every 15 minutes)";
  },
  async uninstall(target, spawner) {
    const next = removeCronBlock(await readCrontab(spawner));
    const result = await spawner.run("crontab", ["-"], { input: next });
    if (result.code !== 0) throw new Error(`crontab - failed: ${result.stderr.trim()}`);
    return "crontab entry removed";
  },
  async status(target, spawner) {
    let current: string;
    try {
      current = await readCrontab(spawner);
    } catch (error) {
      if (error instanceof CrontabUnavailableError) {
        return { installed: false, healthy: false, detail: `crontab is not available on this machine (${error.message}) — use \`codex-kaboo install --systemd\` instead` };
      }
      throw error;
    }
    const installed = current.includes(CRON_BEGIN);
    if (!installed) return { installed: false, healthy: false, detail: "not installed" };
    const missing = await checkTargetPaths(target);
    if (missing.length > 0) return { installed: true, healthy: false, detail: `schedule broken: missing ${missing.join(", ")}; run \`codex-kaboo install\` again` };
    return { installed: true, healthy: true, detail: "crontab entry present" };
  },
};
