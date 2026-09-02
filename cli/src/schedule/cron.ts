import path from "node:path";
import { checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget, type Spawner } from "./index";

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
 */
export function cronQuote(value: string): string {
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

async function readCrontab(spawner: Spawner): Promise<string> {
  const result = await spawner.run("crontab", ["-l"]);
  if (result.code === 0) return result.stdout;
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
    const current = await readCrontab(spawner);
    const installed = current.includes(CRON_BEGIN);
    if (!installed) return { installed: false, healthy: false, detail: "not installed" };
    const missing = await checkTargetPaths(target);
    if (missing.length > 0) return { installed: true, healthy: false, detail: `schedule broken: missing ${missing.join(", ")}; run \`codex-kaboo install\` again` };
    return { installed: true, healthy: true, detail: "crontab entry present" };
  },
};
