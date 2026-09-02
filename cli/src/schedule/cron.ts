import path from "node:path";
import { checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget, type Spawner } from "./index";

export const CRON_BEGIN = "# BEGIN codex-kaboo";
export const CRON_END = "# END codex-kaboo";

/**
 * crontab(5): an unescaped `%` in the command field is turned into a newline (everything after it
 * becomes stdin to the job), so every `%` in an interpolated value must be escaped as `\%`. These
 * values are also wrapped in double quotes, so an embedded `"` must be escaped as `\"` too.
 */
function cronEscape(value: string): string {
  return value.replace(/%/g, "\\%").replace(/"/g, '\\"');
}

/** POSIX-only generator: `path.posix` so the crontab line is byte-identical wherever the tests run (Windows CI included). */
export function renderCronLine(target: ScheduleTarget): string {
  const env = ["CODEX_KABOO_SCHEDULED=1", ...(target.codexHome ? [`CODEX_HOME="${cronEscape(target.codexHome)}"`] : [])].join(" ");
  const log = cronEscape(path.posix.join(target.kabooHome, "cron.log"));
  return `*/15 * * * * ${env} "${cronEscape(target.nodePath)}" "${cronEscape(target.scriptPath)}" ${scheduledArgs().join(" ")} >> "${log}" 2>&1`;
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
