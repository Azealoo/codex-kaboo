#!/usr/bin/env node
import { Command } from "commander";
import { randomUUID } from "node:crypto";
import os from "node:os";
import readline from "node:readline";
import { BAKED_SERVER, BAKED_WEB_ORIGIN, CLI_VERSION } from "./build-info";
import { formatDoctor, runDoctor } from "./commands/doctor";
import { formatSyncReport } from "./commands/format";
import { runInstall } from "./commands/install";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";
import type { ScheduleDeps } from "./commands/schedule-deps";
import { formatStatus, runStatus } from "./commands/status";
import { runSync, type SyncDeps } from "./commands/sync";
import { runUninstall } from "./commands/uninstall";
import { kabooPaths } from "./core/paths";
import { machineZone } from "./parser/time";
import type { Config } from "./types";
import { createClient } from "./upload/client";
import { createLogger, type Logger } from "./util/log";
import { nodeSpawner } from "./util/spawn";

const paths = kabooPaths();

function makeLogger(opts: { quiet?: boolean; verbose?: boolean; toFile?: boolean }): Logger {
  return createLogger({
    ...(opts.toFile ? { file: paths.log } : {}),
    quiet: opts.quiet === true,
    verbose: opts.verbose === true,
    console: (line) => process.stderr.write(`${line}\n`),
  });
}

/** Curried on cliVersion so every call site (and in particular LoginDeps.cliVersion, see the
 * `login` action below) can be traced to the exact client that will use it — the factory never
 * falls back to reading the outer CLI_VERSION constant behind the caller's back. */
function clientFor(cliVersion: string) {
  return (config: Pick<Config, "server" | "token">): ReturnType<typeof createClient> =>
    createClient({ server: config.server, token: config.token, cliVersion });
}

function syncDeps(log: Logger): SyncDeps {
  return {
    paths, env: process.env, now: () => Date.now(), log, cliVersion: CLI_VERSION, machineZone: machineZone(),
    newId: () => randomUUID(), createClient: clientFor(CLI_VERSION), platform: process.platform, arch: process.arch,
    nodeVersion: process.versions.node, hostname: () => os.hostname(), pid: process.pid,
    ...(BAKED_WEB_ORIGIN ? { webOrigin: BAKED_WEB_ORIGIN } : {}),
  };
}

function scheduleDeps(log: Logger): ScheduleDeps {
  return {
    paths, env: process.env, platform: process.platform, execPath: process.execPath, scriptPath: process.argv[1] ?? __filename,
    homeDir: os.homedir(), ...(typeof process.getuid === "function" ? { uid: process.getuid() } : {}), spawner: nodeSpawner, log,
  };
}

function emit(json: boolean, data: unknown, lines: string[]): void {
  if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else for (const line of lines) process.stdout.write(`${line}\n`);
}

/**
 * Prompts for the sync token on stderr. Exact guarantees:
 *  - When stdin is a real TTY: this function writes the question itself, once, before the
 *    readline interface is even created. From that point until the interface closes, readline's
 *    own output writer (`_writeToOutput`) is replaced with a no-op that swallows EVERY write it
 *    would otherwise make — unconditionally, not just ones that look like a bare character echo.
 *    That matters because readline redraws the *whole* `prompt + currentLine` on Backspace, the
 *    arrow keys, Ctrl-U and paste (not just the single changed character), so any conditional
 *    filter keyed on "does this write start with the prompt" still lets those redraws through —
 *    that was the bug here: a Backspace after typing 3 characters redrew "prompt + first two
 *    characters", which passed a `startsWith(question)` check and leaked them. Swallowing
 *    unconditionally closes that hole. Backspace/arrow-key editing and paste still work — only
 *    the *visual echo* is suppressed; readline's own line-buffer handling (and thus the final
 *    returned string) is untouched. On Enter, this function writes the trailing newline itself
 *    (readline's own newline echo is swallowed along with everything else) and resolves with the
 *    typed text. On Ctrl-C (SIGINT), it closes the interface, writes a newline, and terminates
 *    the process with exit code 130 (the standard 128+SIGINT convention) — without an explicit
 *    handler, readline in muted terminal mode does not raise SIGINT on the process by default, so
 *    Ctrl-C would otherwise appear to hang instead of exiting.
 *  - When stdin is not a TTY (piped input, some CI shells): there is no terminal echo to
 *    suppress in the first place, and no way to guarantee a piping shell won't show it, so this
 *    prints a warning first and falls back to a plain, visible prompt.
 *  Either way, the raw token is only ever returned to the caller — never written to a log or the
 *  console by this function itself.
 */
function promptToken(question: string): Promise<string> {
  return new Promise((resolve) => {
    const output = process.stderr;
    const isTTY = process.stdin.isTTY === true;

    if (!isTTY) {
      output.write("warning: stdin is not a TTY; input cannot be hidden and may be echoed by your terminal or shell\n");
      const rl = readline.createInterface({ input: process.stdin, output, terminal: false });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    output.write(question);
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    // Unconditional no-op: swallows character echo AND every prompt+line redraw (Backspace,
    // arrow keys, Ctrl-U, paste) for as long as this interface lives. See the doc comment above.
    (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => {};

    rl.on("SIGINT", () => {
      rl.close();
      output.write("\n");
      process.exit(130);
    });

    rl.question("", (answer) => {
      rl.close();
      output.write("\n");
      resolve(answer);
    });
  });
}

const program = new Command();
program
  .name("codex-kaboo")
  .description("Report Codex CLI usage metadata (never text or paths) to your codex-kaboo dashboard")
  .version(CLI_VERSION)
  .option("--json", "print machine-readable JSON on stdout")
  .option("--verbose", "debug logging on stderr");

const globals = (): { json: boolean; verbose: boolean } => {
  const o = program.opts<{ json?: boolean; verbose?: boolean }>();
  return { json: o.json === true, verbose: o.verbose === true };
};

program
  .command("login")
  .description("store a sync token for this machine (create one in the dashboard under Settings)")
  .option("--token <token>", "sync token (prompted when omitted)")
  .option("--server <url>", "dashboard API origin, https://<deployment>.convex.site")
  .option("--machine-name <name>", "label shown in the dashboard")
  .option("--hostname", "also upload this machine's hostname")
  .action(async (o: { token?: string; server?: string; machineName?: string; hostname?: boolean }) => {
    const g = globals();
    const cliVersion = CLI_VERSION;
    const result = await runLogin(
      { ...(o.token ? { token: o.token } : {}), ...(o.server ? { server: o.server } : {}), ...(o.machineName ? { machineName: o.machineName } : {}), hostname: o.hostname === true, json: g.json },
      { paths, env: process.env, bakedServer: BAKED_SERVER, cliVersion, prompt: promptToken, createClient: clientFor(cliVersion), newId: () => randomUUID(), now: () => Date.now(), log: makeLogger({ verbose: g.verbose }) },
    );
    emit(g.json, result, result.ok
      ? [`logged in as ${result.user?.name ?? result.user?.email ?? result.user?.userId} (${result.server})`, `machine label: ${result.label}`, "next: codex-kaboo install"]
      : [`error: ${result.error ?? "login failed"}`]);
    process.exitCode = result.exitCode;
  });

program
  .command("logout")
  .description("forget the sync token on this machine")
  .action(async () => {
    const g = globals();
    const result = await runLogout({ paths, log: makeLogger({ verbose: g.verbose }) });
    emit(g.json, result, [result.removed ? "logged out" : "not logged in"]);
    process.exitCode = result.exitCode;
  });

program
  .command("sync")
  .description("parse new Codex rollout logs and upload metadata")
  .option("--full", "forget file progress and re-upload everything (safe: the server upserts)")
  .option("--dry-run", "parse and show what would be sent; no network, no state changes")
  .option("--scheduled", "quiet mode for the scheduler (exit 0 when not logged in)")
  .option("--codex-home <path>", "Codex home to scan (default: CODEX_HOME or ~/.codex)")
  .action(async (o: { full?: boolean; dryRun?: boolean; scheduled?: boolean; codexHome?: string }) => {
    const g = globals();
    const scheduled = o.scheduled === true || process.env.CODEX_KABOO_SCHEDULED === "1";
    const log = makeLogger({ quiet: scheduled || g.json, verbose: g.verbose, toFile: o.dryRun !== true });
    const report = await runSync(
      { full: o.full === true, dryRun: o.dryRun === true, scheduled, json: g.json, ...(o.codexHome ? { codexHome: o.codexHome } : {}) },
      syncDeps(log),
    );
    emit(g.json, report, formatSyncReport(report));
    process.exitCode = report.exitCode;
  });

program
  .command("install")
  .description("run sync every 15 minutes in the background (launchd / cron / schtasks)")
  .option("--systemd", "on Linux, use a systemd user timer instead of cron")
  .action(async (o: { systemd?: boolean }) => {
    const g = globals();
    const log = makeLogger({ verbose: g.verbose, toFile: true });
    const result = await runInstall({ systemd: o.systemd === true, json: g.json }, {
      ...scheduleDeps(log),
      runSync: () => runSync({ full: false, dryRun: false, scheduled: false, json: g.json }, syncDeps(log)),
    });
    emit(g.json, result, [result.detail, ...(result.sync ? formatSyncReport(result.sync) : [])]);
    process.exitCode = result.exitCode;
  });

program
  .command("uninstall")
  .description("remove the background schedule")
  .option("--systemd", "on Linux, remove the systemd user timer")
  .action(async (o: { systemd?: boolean }) => {
    const g = globals();
    const result = await runUninstall({ systemd: o.systemd === true, json: g.json }, scheduleDeps(makeLogger({ verbose: g.verbose })));
    emit(g.json, result, [result.detail]);
    process.exitCode = result.exitCode;
  });

program
  .command("status")
  .description("show login, Codex homes, last sync and scheduler state")
  .option("--codex-home <path>")
  .option("--systemd")
  .action(async (o: { codexHome?: string; systemd?: boolean }) => {
    const g = globals();
    const report = await runStatus({ ...scheduleDeps(makeLogger({ verbose: g.verbose })), cliVersion: CLI_VERSION, ...(o.codexHome ? { codexHomeOverride: o.codexHome } : {}), systemd: o.systemd === true });
    emit(g.json, report, formatStatus(report));
  });

program
  .command("doctor")
  .description("check Node, Codex home, token and scheduler")
  .option("--codex-home <path>")
  .option("--systemd")
  .action(async (o: { codexHome?: string; systemd?: boolean }) => {
    const g = globals();
    const report = await runDoctor({ ...scheduleDeps(makeLogger({ verbose: g.verbose })), cliVersion: CLI_VERSION, nodeVersion: process.versions.node, createClient: clientFor(CLI_VERSION), ...(o.codexHome ? { codexHomeOverride: o.codexHome } : {}), systemd: o.systemd === true });
    emit(g.json, report, formatDoctor(report));
    process.exitCode = report.exitCode;
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
