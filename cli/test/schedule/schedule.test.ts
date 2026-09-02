import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CRON_BEGIN, CRON_END, CrontabUnavailableError, cronAdapter, cronQuote, removeCronBlock, renderCronLine, upsertCronBlock } from "../../src/schedule/cron";
import { checkTargetPaths, pickScheduler, type ScheduleTarget, type Spawner, type SpawnResult } from "../../src/schedule/index";
import { LAUNCHD_LABEL, launchdAdapter, plistPath, renderPlist, xmlEscape } from "../../src/schedule/launchd";
import { parseSchtasksStatus, powershellQuote, ps1Path, renderPowershellCommand, renderPs1, renderVbs, schtasksAdapter, schtasksCreateArgs, TASK_NAME, vbsQuote } from "../../src/schedule/schtasks";
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

const tempDirs: string[] = [];

/** Every adapter under test writes real files (plist/units/VBS) to this instead of the real home directory. */
function freshTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

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
    const homeDir = freshTempDir("ck-launchd-");
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

  it("surfaces a launchctl kickstart failure during install", async () => {
    const homeDir = freshTempDir("ck-launchd-kickstart-");
    const t = target({ homeDir });
    const { spawner } = mockSpawner((cmd, args) =>
      args[0] === "kickstart" ? { code: 1, stdout: "", stderr: "kickstart: could not start job" } : undefined,
    );
    await expect(launchdAdapter.install(t, spawner)).rejects.toThrow(/kickstart failed/);
  });

  // Decision (newline re-review): unlike cron/systemd/schtasks, a plist is XML, and a literal
  // newline inside a <string> element's TEXT content is well-formed — XML only whitespace-
  // normalizes attribute values, not element content — so it cannot terminate the element early
  // or inject a sibling <key>/<string> pair. xmlEscape is left unchanged and renderPlist is not
  // expected to refuse; pinned here instead of merely assumed.
  it("represents an embedded newline safely inside a <string> element instead of refusing it", () => {
    const value = "/Users/me/weird\nhome";
    expect(xmlEscape(value)).toBe(value); // a literal newline needs no XML entity of its own
    const withoutNewline = renderPlist(target({ codexHome: "/srv/codex" }));
    let withNewline = "";
    expect(() => {
      withNewline = renderPlist(target({ codexHome: value }));
    }).not.toThrow();
    expect(withNewline).toContain(`<string>${value}</string>`);
    // Same element count either way: the embedded newline neither injected nor dropped an XML node.
    expect(withNewline.match(/<key>/g)?.length).toBe(withoutNewline.match(/<key>/g)?.length);
    expect(withNewline.match(/<string>/g)?.length).toBe(withoutNewline.match(/<string>/g)?.length);
  });
});

describe("cron", () => {
  it("renders the line and keeps exactly one marker block", () => {
    const line = renderCronLine(target({ codexHome: "/srv/codex" }));
    expect(line).toBe(`*/15 * * * * CODEX_KABOO_SCHEDULED=1 CODEX_HOME='/srv/codex' '/opt/node & co/bin/node' '/Users/me/.npm-global/lib/node_modules/codex-kaboo-cli/dist/codex-kaboo.js' sync --scheduled >> '/Users/me/.codex-kaboo/cron.log' 2>&1`);
    const once = upsertCronBlock("0 * * * * echo hi\n", line);
    expect(once).toBe(`0 * * * * echo hi\n${CRON_BEGIN}\n${line}\n${CRON_END}\n`);
    const twice = upsertCronBlock(once, line.replace("*/15", "*/10"));
    expect(twice.split(CRON_BEGIN)).toHaveLength(2);
    expect(twice).toContain("*/10");
    expect(twice).not.toContain("*/15");
    expect(removeCronBlock(twice)).toBe("0 * * * * echo hi\n");
    expect(upsertCronBlock("", line)).toBe(`${CRON_BEGIN}\n${line}\n${CRON_END}\n`);
  });

  it("escapes % for cron and single-quotes every value against the shell", () => {
    const line = renderCronLine(target({
      nodePath: "/opt/node%5/bin/node",
      scriptPath: '/Users/me/weird"quote/dist/codex-kaboo.js',
      kabooHome: "/Users/me/.codex-kaboo%home",
      codexHome: "/srv/codex'home%1",
    }));
    expect(line).toContain("'/opt/node\\%5/bin/node'");
    expect(line).toContain(`'/Users/me/weird"quote/dist/codex-kaboo.js'`); // inert inside single quotes
    expect(line).toContain("'/Users/me/.codex-kaboo\\%home/cron.log'");
    expect(line).toContain(String.raw`CODEX_HOME='/srv/codex'\''home\%1'`); // the one character single quotes cannot hold
    expect(cronQuote("a'b")).toBe(String.raw`'a'\''b'`);
    const installed = upsertCronBlock("0 * * * * echo hi\n", line);
    expect(removeCronBlock(installed)).toBe("0 * * * * echo hi\n");
    expect(upsertCronBlock(installed, line)).toBe(installed);
  });

  // Review finding: the values came from CODEX_HOME / CODEX_KABOO_HOME (both user-settable at
  // install time) and were interpolated inside DOUBLE quotes, where `$VAR`, `$(…)` and backticks
  // still expand and a trailing `\` escapes the closing quote — so such a path either broke the
  // schedule silently (status still reported "installed") or command-substituted every 15 minutes.
  // Proven end to end rather than by string comparison: a stub "node" living under a directory
  // whose name holds each metacharacter prints its own argv, so the values must arrive byte for
  // byte after a real /bin/sh has parsed the rendered command.
  it.skipIf(process.platform === "win32")("passes $, a backtick and a backslash through /bin/sh unchanged", () => {
    const root = freshTempDir("ck-cron-meta-");
    const weird = path.join(root, String.raw`we$ird` + "`tick`" + String.raw`back\slash%pct`);
    const kabooHome = path.join(weird, "kaboo");
    mkdirSync(kabooHome, { recursive: true });
    const nodeStub = path.join(weird, "node stub");
    writeFileSync(nodeStub, '#!/bin/sh\nfor a in "$0" "$@"; do printf "%s\\n" "$a"; done\nprintf "CODEX_HOME=%s\\n" "$CODEX_HOME"\n');
    chmodSync(nodeStub, 0o755);
    const scriptPath = path.join(weird, "codex-kaboo.js");
    const codexHome = path.join(weird, "codex");

    const line = renderCronLine({ nodePath: nodeStub, scriptPath, kabooHome, homeDir: root, codexHome });
    // Drop the five schedule fields and undo cron's own `\%` escape, which cron strips before
    // /bin/sh ever sees the line — what is left is exactly what the shell is handed.
    const command = line.replace(/^\S+ \S+ \S+ \S+ \S+ /, "").replace(/\\%/g, "%");
    execFileSync("/bin/sh", ["-c", command]);

    const printed = readFileSync(path.join(kabooHome, "cron.log"), "utf8").split("\n");
    expect(printed.slice(0, 4)).toEqual([nodeStub, scriptPath, "sync", "--scheduled"]);
    expect(printed[4]).toBe(`CODEX_HOME=${codexHome}`);
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

  // Re-review finding: a newline is not a metacharacter cronQuote can escape away. crontab reads
  // one line per entry no matter how a field inside it is quoted, so an embedded \n or \r would
  // either truncate the entry or inject an extra line inside the codex-kaboo block — corrupting
  // the crontab silently instead of failing loudly. Refuse instead of writing it.
  it("refuses a path containing a newline or carriage return instead of writing a broken crontab line", async () => {
    expect(() => renderCronLine(target({ nodePath: "/opt/node\n/bin/node" }))).toThrow(/newline/i);
    expect(() => renderCronLine(target({ scriptPath: "/Users/me/weird\rpath/codex-kaboo.js" }))).toThrow(/newline/i);
    expect(() => renderCronLine(target({ codexHome: "/srv/co\ndex" }))).toThrow(/crontab/i);
    expect(() => renderCronLine(target({ kabooHome: "/Users/me/.codex-kaboo\r" }))).toThrow(/newline/i);
    expect(() => cronQuote("a\nb")).toThrow(/newline/i);
    expect(() => cronQuote("a\rb")).toThrow(/newline/i);

    // Nothing is written: the throw happens before `crontab -` (the write) is ever called.
    const { spawner, calls } = mockSpawner((cmd, args) => (args[0] === "-l" ? { code: 1, stdout: "", stderr: "no crontab for me" } : undefined));
    await expect(cronAdapter.install(target({ nodePath: "/opt/node\n/bin/node" }), spawner)).rejects.toThrow(/newline/i);
    expect(calls.some((c) => c.args[0] === "-")).toBe(false);
  });

  // Review finding: a Linux box with no `crontab` binary at all (common on minimal/container
  // images) resolved `crontab -l` to `{ code: null, stdout: "" }` — indistinguishable, before this
  // fix, from a user who simply has no crontab yet (`{ code: 1, stderr: "no crontab for me" }`).
  // Both told `status`/`doctor` "not installed" and pointed at a remedy (`codex-kaboo install`)
  // that fails identically on such a machine. Mocked spawner only — this must not shell out.
  it("distinguishes a missing crontab binary from an empty, not-yet-installed crontab", async () => {
    const missingBinary = mockSpawner((cmd, args) => (args[0] === "-l" ? { code: null, stdout: "", stderr: "spawn crontab ENOENT" } : undefined));
    expect(await cronAdapter.status(target(), missingBinary.spawner)).toEqual({
      installed: false,
      healthy: false,
      detail: expect.stringMatching(/crontab is not available.*--systemd/i),
    });
    // install/uninstall read the crontab too and must fail loudly rather than silently overwrite
    // a crontab that was never actually read.
    await expect(cronAdapter.install(target(), missingBinary.spawner)).rejects.toThrow(CrontabUnavailableError);
    await expect(cronAdapter.uninstall(target(), missingBinary.spawner)).rejects.toThrow(CrontabUnavailableError);

    // Contrast: crontab runs fine and reports none installed yet — a normal, healthy state, not
    // an error.
    const noCrontabYet = mockSpawner((cmd, args) => (args[0] === "-l" ? { code: 1, stdout: "", stderr: "no crontab for me" } : undefined));
    expect(await cronAdapter.status(target(), noCrontabYet.spawner)).toEqual({ installed: false, healthy: false, detail: "not installed" });

    // A timed-out `crontab -l` (nodeSpawner: `code: null, timedOut: true`) is also "could not be
    // run", not "empty" — same bucket as a missing binary, with its own detail.
    const timedOut = mockSpawner((cmd, args) => (args[0] === "-l" ? { code: null, stdout: "", stderr: "", timedOut: true } : undefined));
    expect((await cronAdapter.status(target(), timedOut.spawner)).detail).toMatch(/timed out/i);
  });
});

describe("systemd", () => {
  it("renders unit files and enables the timer", async () => {
    const homeDir = freshTempDir("ck-systemd-");
    const t = target({ homeDir, codexHome: "/srv/codex" });
    expect(renderService(t)).toContain(`ExecStart="/opt/node & co/bin/node" "${t.scriptPath}" sync --scheduled`);
    expect(renderService(t)).toContain('Environment="CODEX_HOME=/srv/codex"');
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

  it("doubles % in interpolated values and posix-joins systemdDir", () => {
    const t = target({ nodePath: "/opt/node%5/bin/node", codexHome: "/srv/codex%home" });
    const service = renderService(t);
    expect(service).toContain('ExecStart="/opt/node%%5/bin/node"');
    expect(service).toContain('Environment="CODEX_HOME=/srv/codex%%home"');
    expect(systemdDir("/Users/me")).toBe("/Users/me/.config/systemd/user");
  });

  // Review finding: only `%` was escaped, so a `"` or `\` in a path broke the ExecStart line's
  // quoting outright and a `$` was expanded from the unit's environment (usually to nothing).
  // systemd execs directly, so a backtick is inert and must survive verbatim.
  it("escapes backslash, quote and dollar in ExecStart, and leaves $ alone in Environment", () => {
    const service = renderService(target({
      nodePath: String.raw`/opt/no\de/bin/node`,
      scriptPath: String.raw`/srv/we"ird/$HOME/back` + "`tick`" + "/codex-kaboo.js",
      codexHome: String.raw`/srv/co"dex/$HOME/back\slash`,
    }));
    // \ doubled, " escaped, $ doubled (systemd expands $VAR in a command line), ` untouched.
    expect(service).toContain(String.raw`ExecStart="/opt/no\\de/bin/node" "/srv/we\"ird/$$HOME/back` + "`tick`" + '/codex-kaboo.js"');
    // Environment= is not variable-expanded (systemd documents Environment="VAR3=$word 5 6" as a
    // literal $word), so `$` must stay single here — doubling it would corrupt the value.
    expect(service).toContain(String.raw`Environment="CODEX_HOME=/srv/co\"dex/$HOME/back\\slash"`);
    // Every line of the unit stays one line: nothing above can inject a second directive.
    expect(service.split("\n").filter((l) => l.startsWith("ExecStart="))).toHaveLength(1);
  });

  // Re-review finding: same as cron — a systemd unit is line-oriented (one Key=Value directive per
  // line), so an embedded \n or \r in a value is unrepresentable, not merely unescaped. Refuse
  // instead of writing a unit whose ExecStart/Environment line silently gains an extra directive.
  it("refuses a path containing a newline or carriage return instead of writing a broken unit file", async () => {
    expect(() => renderService(target({ nodePath: "/opt/node\n/bin/node" }))).toThrow(/newline/i);
    expect(() => renderService(target({ scriptPath: "/srv/we\rird/codex-kaboo.js" }))).toThrow(/newline/i);
    expect(() => renderService(target({ codexHome: "/srv/codex\nhome" }))).toThrow(/systemd/i);

    // Nothing is written: the throw happens before either unit file, or systemctl, is touched.
    const homeDir = freshTempDir("ck-systemd-newline-");
    const t = target({ homeDir, nodePath: "/opt/node\n/bin/node" });
    const { spawner, calls } = mockSpawner(() => undefined);
    await expect(systemdAdapter.install(t, spawner)).rejects.toThrow(/newline/i);
    expect(existsSync(path.join(systemdDir(homeDir), "codex-kaboo-sync.service"))).toBe(false);
    expect(existsSync(path.join(systemdDir(homeDir), "codex-kaboo-sync.timer"))).toBe(false);
    expect(calls.length).toBe(0);
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
    const homeDir = freshTempDir("ck-schtasks-");
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

  it("falls back to the PowerShell runner when wscript.exe is unavailable", async () => {
    const homeDir = freshTempDir("ck-schtasks-ps-");
    const kabooHome = path.join(homeDir, ".codex-kaboo");
    const t = target({
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      scriptPath: "C:\\npm\\codex-kaboo-cli\\codex-kaboo.js",
      kabooHome,
      homeDir,
      codexHome: "D:\\O'Brien\\codex",
    });
    const { spawner, calls } = mockSpawner((cmd) => (cmd === "where" ? { code: 1, stdout: "", stderr: "INFO: Could not find files matching the specified pattern." } : undefined));
    await schtasksAdapter.install(t, spawner);
    expect(existsSync(path.join(kabooHome, "sync-hidden.vbs"))).toBe(false);
    expect(existsSync(ps1Path(kabooHome))).toBe(false);
    const create = calls.find((c) => c.command === "schtasks" && c.args[0] === "/Create")!;
    const tr = create.args[create.args.length - 1];
    expect(tr).toBe(renderPowershellCommand(t));
    expect(tr).toContain("-WindowStyle Hidden");
    expect(tr).toContain("$env:CODEX_KABOO_SCHEDULED='1'");
    expect(tr).toContain("$env:CODEX_HOME='D:\\O''Brien\\codex'");
  });

  it("writes a .ps1 file and invokes it with -File when the inline PowerShell command would exceed schtasks's /TR limit", async () => {
    const homeDir = freshTempDir("ck-schtasks-ps1-");
    const kabooHome = path.join(homeDir, ".codex-kaboo");
    const t = target({
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      scriptPath: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\codex-kaboo-cli\\dist\\codex-kaboo.js",
      kabooHome,
      homeDir,
      codexHome: "D:\\codex",
    });
    expect(renderPowershellCommand(t).length).toBeGreaterThan(250); // confirms this fixture exercises the fallback below
    const { spawner, calls } = mockSpawner((cmd) => (cmd === "where" ? { code: 1, stdout: "", stderr: "INFO: Could not find files matching the specified pattern." } : undefined));
    await schtasksAdapter.install(t, spawner);
    expect(existsSync(path.join(kabooHome, "sync-hidden.vbs"))).toBe(false);
    const file = ps1Path(kabooHome);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(renderPs1(t));
    const create = calls.find((c) => c.command === "schtasks" && c.args[0] === "/Create")!;
    const tr = create.args[create.args.length - 1];
    expect(tr).toBe(`powershell.exe -NoProfile -WindowStyle Hidden -File "${file}"`);
    await schtasksAdapter.uninstall(t, spawner);
    expect(existsSync(file)).toBe(false);
  });

  // Decision (newline re-review): schtasks shares the check too. The VBS runner is classic
  // VBScript — one statement per physical line, and a double-quoted string literal cannot itself
  // span lines — so an embedded \n breaks out of the intended one-line `sh.Run "..."` statement.
  // The PowerShell runner's own quoting is more forgiving (its quoted strings can span lines), but
  // the value still has to survive as a single schtasks /TR argument and whatever the Windows Task
  // Scheduler does when storing and replaying it — a round trip this repo cannot exercise outside
  // Windows. Unable to prove that path safe the way the launchd/XML path is proven safe below,
  // both schtasks runners refuse rather than gamble.
  it("refuses a path containing a newline or carriage return for both the VBS and PowerShell runners", async () => {
    expect(() => renderVbs(target({ nodePath: "C:\\node\n.exe" }))).toThrow(/newline/i);
    expect(() => renderVbs(target({ codexHome: "D:\\codex\rhome" }))).toThrow(/newline/i);
    expect(() => renderPowershellCommand(target({ nodePath: "C:\\node\n.exe" }))).toThrow(/newline/i);
    expect(() => renderPs1(target({ scriptPath: "C:\\weird\rscript.js" }))).toThrow(/newline/i);
    expect(() => vbsQuote("a\nb")).toThrow(/newline/i);
    expect(() => powershellQuote("a\rb")).toThrow(/newline/i);

    // Nothing is written: the throw happens before the VBS file (or `schtasks /Create`) is touched.
    const homeDir = freshTempDir("ck-schtasks-newline-");
    const kabooHome = path.join(homeDir, ".codex-kaboo");
    const t = target({ homeDir, kabooHome, nodePath: "C:\\node\n.exe" });
    const { spawner, calls } = mockSpawner((cmd) => (cmd === "where" ? { code: 0, stdout: "C:\\Windows\\System32\\wscript.exe", stderr: "" } : undefined));
    await expect(schtasksAdapter.install(t, spawner)).rejects.toThrow(/newline/i);
    expect(existsSync(path.join(kabooHome, "sync-hidden.vbs"))).toBe(false);
    expect(calls.some((c) => c.command === "schtasks")).toBe(false);
  });

  // Found by the newline re-review: the runner file's own path is derived from `kabooHome`, which is
  // environment-derived (CODEX_KABOO_HOME, else os.homedir()) and reaches the /TR command line
  // without passing through vbsQuote/powershellQuote — the one value in schedule/ that bypassed
  // every quoting primitive. Guarded before the mkdir so a refusal leaves no directory behind.
  it("refuses a newline in kabooHome itself, for both the VBS and the .ps1 runner", async () => {
    const vbsHomeDir = freshTempDir("ck-schtasks-home-vbs-");
    const vbsKabooHome = path.join(vbsHomeDir, ".codex\n-kaboo");
    const vbsTarget = target({ homeDir: vbsHomeDir, kabooHome: vbsKabooHome });
    const vbs = mockSpawner((cmd) => (cmd === "where" ? { code: 0, stdout: "C:\\Windows\\System32\\wscript.exe", stderr: "" } : undefined));
    await expect(schtasksAdapter.install(vbsTarget, vbs.spawner)).rejects.toThrow(/newline/i);
    expect(existsSync(vbsKabooHome)).toBe(false);
    expect(vbs.calls.some((c) => c.command === "schtasks")).toBe(false);

    const psHomeDir = freshTempDir("ck-schtasks-home-ps1-");
    const psKabooHome = path.join(psHomeDir, ".codex\r-kaboo");
    const psTarget = target({
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      scriptPath: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\codex-kaboo-cli\\dist\\codex-kaboo.js",
      kabooHome: psKabooHome,
      homeDir: psHomeDir,
      codexHome: "D:\\codex",
    });
    expect(renderPowershellCommand(psTarget).length).toBeGreaterThan(250); // forces the .ps1 fallback
    const ps = mockSpawner((cmd) => (cmd === "where" ? { code: 1, stdout: "", stderr: "" } : undefined));
    await expect(schtasksAdapter.install(psTarget, ps.spawner)).rejects.toThrow(/newline/i);
    expect(existsSync(psKabooHome)).toBe(false);
    expect(ps.calls.some((c) => c.command === "schtasks")).toBe(false);
  });
});

describe("index", () => {
  it("picks the scheduler per platform and detects missing paths", async () => {
    expect(pickScheduler("darwin", {}).name).toBe("launchd");
    expect(pickScheduler("win32", {}).name).toBe("schtasks");
    expect(pickScheduler("linux", {}).name).toBe("cron");
    expect(pickScheduler("linux", { systemd: true }).name).toBe("systemd");
    const dir = freshTempDir("ck-paths-");
    const script = path.join(dir, "codex-kaboo.js");
    writeFileSync(script, "");
    expect(await checkTargetPaths(target({ nodePath: process.execPath, scriptPath: script }))).toEqual([]);
    expect(await checkTargetPaths(target({ nodePath: path.join(dir, "missing-node"), scriptPath: script }))).toEqual([path.join(dir, "missing-node")]);
  });
});
