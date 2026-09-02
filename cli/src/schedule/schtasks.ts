import { promises as fs } from "node:fs";
import path from "node:path";
import { checkTargetPaths, scheduledArgs, type SchedulerAdapter, type ScheduleTarget, type Spawner } from "./index";

export const TASK_NAME = "codex-kaboo-sync";

/** VBScript string literal: wrap in quotes, double any inner quote. */
export function vbsQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function vbsPath(kabooHome: string): string {
  return path.join(kabooHome, "sync-hidden.vbs");
}

/** Hidden runner: no console window flashes every 15 minutes (WScript.Shell.Run … , 0, False). */
export function renderVbs(target: ScheduleTarget): string {
  const command = `"${target.nodePath}" "${target.scriptPath}" ${scheduledArgs().join(" ")}`;
  const lines = [
    'Set sh = CreateObject("WScript.Shell")',
    'sh.Environment("Process")("CODEX_KABOO_SCHEDULED") = "1"',
  ];
  if (target.codexHome) lines.push(`sh.Environment("Process")("CODEX_HOME") = ${vbsQuote(target.codexHome)}`);
  lines.push(`sh.Run ${vbsQuote(command)}, 0, False`, "");
  return lines.join("\r\n");
}

function powershellEnvLines(target: ScheduleTarget, ps: (value: string) => string): string[] {
  const lines = ["$env:CODEX_KABOO_SCHEDULED='1'"];
  if (target.codexHome) lines.push(`$env:CODEX_HOME=${ps(target.codexHome)}`);
  return lines;
}

/** Fallback when wscript.exe is unavailable (a console may flash briefly). Mirrors the VBS runner's environment. */
export function renderPowershellCommand(target: ScheduleTarget): string {
  const ps = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  const script = [...powershellEnvLines(target, ps), `& ${ps(target.nodePath)} ${ps(target.scriptPath)} ${scheduledArgs().join(" ")}`].join("; ");
  return `powershell.exe -NoProfile -WindowStyle Hidden -Command "${script}"`;
}

export function ps1Path(kabooHome: string): string {
  return path.join(kabooHome, "sync-hidden.ps1");
}

/**
 * Written under the kaboo home instead of inlining the command, when the inline -Command string
 * would exceed schtasks's /TR length limit (documented as 261 characters); mirrors the VBS runner.
 */
export function renderPs1(target: ScheduleTarget): string {
  const ps = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  const lines = [...powershellEnvLines(target, ps), `& ${ps(target.nodePath)} ${ps(target.scriptPath)} ${scheduledArgs().join(" ")}`, ""];
  return lines.join("\r\n");
}

/** Stay well under schtasks's 261-character /TR limit before falling back to a .ps1 file. */
const PS_INLINE_COMMAND_LIMIT = 250;

export function schtasksCreateArgs(command: string): string[] {
  return ["/Create", "/F", "/SC", "MINUTE", "/MO", "15", "/TN", TASK_NAME, "/TR", command];
}

export function schtasksDeleteArgs(): string[] {
  return ["/Delete", "/F", "/TN", TASK_NAME];
}

export function schtasksQueryArgs(): string[] {
  return ["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"];
}

/** Loose, localisation-tolerant status parsing: the first "<label>: <value>" line that looks like a status. */
export function parseSchtasksStatus(stdout: string): { healthy: boolean; detail: string } {
  const line = stdout.split(/\r?\n/).find((l) => /^\s*(status|statut|zustand|estado|stato|状态)\s*:/i.test(l));
  const detail = line ? (line.split(":").slice(1).join(":").trim() || "unknown") : "unknown";
  if (/disabled|désactiv|deaktiviert|deshabilit|disabilit|已禁用/i.test(detail)) return { healthy: false, detail };
  return { healthy: true, detail };
}

async function hasWscript(spawner: Spawner): Promise<boolean> {
  const result = await spawner.run("where", ["wscript.exe"]);
  return result.code === 0 && result.stdout.trim().length > 0;
}

export const schtasksAdapter: SchedulerAdapter = {
  name: "schtasks",
  async install(target, spawner) {
    let command: string;
    if (await hasWscript(spawner)) {
      const file = vbsPath(target.kabooHome);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, renderVbs(target), "utf8");
      command = `wscript.exe //B //Nologo "${file}"`;
    } else {
      const inline = renderPowershellCommand(target);
      if (inline.length <= PS_INLINE_COMMAND_LIMIT) {
        command = inline;
      } else {
        const file = ps1Path(target.kabooHome);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, renderPs1(target), "utf8");
        command = `powershell.exe -NoProfile -WindowStyle Hidden -File "${file}"`;
      }
    }
    const result = await spawner.run("schtasks", schtasksCreateArgs(command));
    if (result.code !== 0) throw new Error(`schtasks /Create failed: ${result.stderr.trim() || result.stdout.trim()}`);
    return `scheduled task ${TASK_NAME} created (every 15 minutes)`;
  },
  async uninstall(target, spawner) {
    await spawner.run("schtasks", schtasksDeleteArgs());
    await fs.rm(vbsPath(target.kabooHome), { force: true });
    await fs.rm(ps1Path(target.kabooHome), { force: true });
    return `scheduled task ${TASK_NAME} deleted`;
  },
  async status(target, spawner) {
    const query = await spawner.run("schtasks", schtasksQueryArgs());
    if (query.code !== 0) return { installed: false, healthy: false, detail: "not installed" };
    const missing = await checkTargetPaths(target);
    if (missing.length > 0) return { installed: true, healthy: false, detail: `schedule broken: missing ${missing.join(", ")}; run \`codex-kaboo install\` again` };
    const parsed = parseSchtasksStatus(query.stdout);
    return { installed: true, healthy: parsed.healthy, detail: parsed.detail };
  },
};
