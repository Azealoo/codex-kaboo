import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CRON_BEGIN, CRON_END, cronAdapter, removeCronBlock, renderCronLine, upsertCronBlock } from "../../src/schedule/cron";
import { checkTargetPaths, pickScheduler, type ScheduleTarget, type Spawner, type SpawnResult } from "../../src/schedule/index";
import { LAUNCHD_LABEL, launchdAdapter, plistPath, renderPlist, xmlEscape } from "../../src/schedule/launchd";
import { parseSchtasksStatus, renderVbs, schtasksAdapter, schtasksCreateArgs, TASK_NAME, vbsQuote } from "../../src/schedule/schtasks";
import { renderService, renderTimer, systemdAdapter, systemdDir } from "../../src/schedule/systemd";

function target(overrides: Partial<ScheduleTarget> = {}): ScheduleTarget {
  return {
    nodePath: "/opt/node & co/bin/node",
    scriptPath: "/Users/me/.npm-global/lib/node_modules/codex-kaboo-cli/dist/codex-kaboo.js",
    kabooHome: "/Users/me/.codex-kaboo",
    homeDir: "/Users/me",
    uid: 501,
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
    ...overrides,
  };
}

function mockSpawner(handler: (command: string, args: string[], input?: string) => SpawnResult | undefined) {
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const spawner: Spawner = {
    async run(command, args, opts) {
      calls.push({ command, args, input: opts?.input });
      return handler(command, args, opts?.input) ?? { code: 0, stdout: "", stderr: "" };
    },
  };
  return { spawner, calls };
}

describe("launchd", () => {
  it("renders an escaped plist and installs via bootout/bootstrap/kickstart", async () => {
    const plist = renderPlist(target({ codexHome: "/Users/me/<codex>" }));
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plist).toContain("<string>/opt/node &amp; co/bin/node</string>");
    expect(plist).toContain("<string>/Users/me/&lt;codex&gt;</string>");
    expect(plist).toContain("<key>StartInterval</key>\n  <integer>900</integer>");
    expect(plist).toContain("<string>sync</string>\n    <string>--scheduled</string>");
    expect(plist).toContain("<key>StandardOutPath</key>\n  <string>/Users/me/.codex-kaboo/launchd.log</string>");
    expect(plist).toContain("<key>ProcessType</key>\n  <string>Background</string>");
    expect(xmlEscape(`a"b'c`)).toBe("a&quot;b&apos;c");
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "ck-launchd-"));
    const t = target({ homeDir });
    const { spawner, calls } = mockSpawner((cmd, args) => (args[0] === "bootout" ? { code: 3, stdout: "", stderr: "not loaded" } : undefined));
    await launchdAdapter.install(t, spawner);
    expect(existsSync(plistPath(homeDir))).toBe(true);
    expect(calls.map((c) => [c.command, ...c.args])).toEqual([
      ["launchctl", "bootout", `gui/501/${LAUNCHD_LABEL}`],
      ["launchctl", "bootstrap", "gui/501", plistPath(homeDir)],
      ["launchctl", "kickstart", "-k", `gui/501/${LAUNCHD_LABEL}`],
    ]);
    const status = await launchdAdapter.status(t, mockSpawner(() => ({ code: 0, stdout: "state = running", stderr: "" })).spawner);
    expect(status.installed).toBe(true);
    await launchdAdapter.uninstall(t, spawner);
    expect(existsSync(plistPath(homeDir))).toBe(false);
  });
});

describe("cron", () => {
  it("renders the line and keeps exactly one marker block", () => {
    const line = renderCronLine(target({ codexHome: "/srv/codex" }));
    expect(line).toBe(`*/15 * * * * CODEX_KABOO_SCHEDULED=1 CODEX_HOME="/srv/codex" "/opt/node & co/bin/node" "/Users/me/.npm-global/lib/node_modules/codex-kaboo-cli/dist/codex-kaboo.js" sync --scheduled >> "/Users/me/.codex-kaboo/cron.log" 2>&1`);
    const once = upsertCronBlock("0 * * * * echo hi\n", line);
    expect(once).toBe(`0 * * * * echo hi\n${CRON_BEGIN}\n${line}\n${CRON_END}\n`);
    const twice = upsertCronBlock(once, line.replace("*/15", "*/10"));
    expect(twice.split(CRON_BEGIN)).toHaveLength(2);
    expect(twice).toContain("*/10");
    expect(twice).not.toContain("*/15");
    expect(removeCronBlock(twice)).toBe("0 * * * * echo hi\n");
    expect(upsertCronBlock("", line)).toBe(`${CRON_BEGIN}\n${line}\n${CRON_END}\n`);
  });
  it("installs through crontab -l / crontab - and reports status", async () => {
    let stored = "";
    const { spawner, calls } = mockSpawner((cmd, args, input) => {
      if (args[0] === "-l") return stored ? { code: 0, stdout: stored, stderr: "" } : { code: 1, stdout: "", stderr: "no crontab for me" };
      if (args[0] === "-") { stored = input ?? ""; return { code: 0, stdout: "", stderr: "" }; }
      return undefined;
    });
    await cronAdapter.install(target(), spawner);
    expect(calls[0]?.args).toEqual(["-l"]);
    expect(calls[1]?.args).toEqual(["-"]);
    expect(stored).toContain(CRON_BEGIN);
    expect((await cronAdapter.status(target(), spawner)).installed).toBe(true);
    await cronAdapter.uninstall(target(), spawner);
    expect(stored).not.toContain(CRON_BEGIN);
    expect((await cronAdapter.status(target(), spawner)).installed).toBe(false);
  });
});

describe("systemd", () => {
  it("renders unit files and enables the timer", async () => {
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "ck-systemd-"));
    const t = target({ homeDir, codexHome: "/srv/codex" });
    expect(renderService(t)).toContain(`ExecStart="/opt/node & co/bin/node" "${t.scriptPath}" sync --scheduled`);
    expect(renderService(t)).toContain("Environment=CODEX_HOME=/srv/codex");
    expect(renderTimer()).toContain("OnUnitActiveSec=15min");
    expect(renderTimer()).toContain("Persistent=true");
    const { spawner, calls } = mockSpawner(() => undefined);
    await systemdAdapter.install(t, spawner);
    expect(existsSync(path.join(systemdDir(homeDir), "codex-kaboo-sync.service"))).toBe(true);
    expect(existsSync(path.join(systemdDir(homeDir), "codex-kaboo-sync.timer"))).toBe(true);
    expect(calls.map((c) => c.args.join(" "))).toEqual(["--user daemon-reload", "--user enable --now codex-kaboo-sync.timer"]);
    await systemdAdapter.uninstall(t, spawner);
    expect(existsSync(path.join(systemdDir(homeDir), "codex-kaboo-sync.timer"))).toBe(false);
  });
});

describe("schtasks", () => {
  it("renders a hidden VBS runner with doubled quotes and the schtasks arguments", async () => {
    const t = target({ nodePath: "C:\\Program Files\\nodejs\\node.exe", scriptPath: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\codex-kaboo-cli\\dist\\codex-kaboo.js", kabooHome: "C:\\Users\\me\\.codex-kaboo", homeDir: "C:\\Users\\me", codexHome: "D:\\codex" });
    const vbs = renderVbs(t);
    expect(vbs).toContain('Set sh = CreateObject("WScript.Shell")');
    expect(vbs).toContain('sh.Environment("Process")("CODEX_KABOO_SCHEDULED") = "1"');
    expect(vbs).toContain('sh.Environment("Process")("CODEX_HOME") = "D:\\codex"');
    expect(vbs).toContain('sh.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\codex-kaboo-cli\\dist\\codex-kaboo.js"" sync --scheduled", 0, False');
    expect(vbsQuote('a"b')).toBe('"a""b"');
    expect(schtasksCreateArgs('wscript.exe //B //Nologo "C:\\x\\sync-hidden.vbs"')).toEqual(["/Create", "/F", "/SC", "MINUTE", "/MO", "15", "/TN", TASK_NAME, "/TR", 'wscript.exe //B //Nologo "C:\\x\\sync-hidden.vbs"']);
    expect(parseSchtasksStatus("Status: Ready")).toEqual({ healthy: true, detail: "Ready" });
    expect(parseSchtasksStatus("Status: Disabled")).toEqual({ healthy: false, detail: "Disabled" });
    expect(parseSchtasksStatus("Statut: Prêt")).toEqual({ healthy: true, detail: "Prêt" });
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "ck-schtasks-"));
    const kabooHome = path.join(homeDir, ".codex-kaboo");
    const { spawner, calls } = mockSpawner((cmd, _args) => (cmd === "where" ? { code: 0, stdout: "C:\\Windows\\System32\\wscript.exe", stderr: "" } : undefined));
    await schtasksAdapter.install({ ...t, homeDir, kabooHome }, spawner);
    expect(existsSync(path.join(kabooHome, "sync-hidden.vbs"))).toBe(true);
    const create = calls.find((c) => c.command === "schtasks" && c.args[0] === "/Create")!;
    expect(create.args[create.args.length - 1]).toContain("wscript.exe //B //Nologo");
    const status = await schtasksAdapter.status({ ...t, homeDir, kabooHome }, mockSpawner(() => ({ code: 0, stdout: "TaskName: \\codex-kaboo-sync\nStatus: Ready\n", stderr: "" })).spawner);
    expect(status).toMatchObject({ installed: true }); // `healthy` depends on checkTargetPaths, which cannot see the fake C:\ paths
    expect((await schtasksAdapter.status(t, mockSpawner(() => ({ code: 1, stdout: "", stderr: "ERROR: The system cannot find the file specified." })).spawner)).installed).toBe(false);
  });
});

describe("index", () => {
  it("picks the scheduler per platform and detects missing paths", async () => {
    expect(pickScheduler("darwin", {}).name).toBe("launchd");
    expect(pickScheduler("win32", {}).name).toBe("schtasks");
    expect(pickScheduler("linux", {}).name).toBe("cron");
    expect(pickScheduler("linux", { systemd: true }).name).toBe("systemd");
    const dir = mkdtempSync(path.join(os.tmpdir(), "ck-paths-"));
    const script = path.join(dir, "codex-kaboo.js");
    writeFileSync(script, "");
    expect(await checkTargetPaths(target({ nodePath: process.execPath, scriptPath: script }))).toEqual([]);
    expect(await checkTargetPaths(target({ nodePath: path.join(dir, "missing-node"), scriptPath: script }))).toEqual([path.join(dir, "missing-node")]);
  });
});
