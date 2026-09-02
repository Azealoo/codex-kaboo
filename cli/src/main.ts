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
 *  - When stdin is a real TTY: this function is the ONLY thing that ever writes to `output` for
 *    the whole prompt. It writes `question` once, up front, and never writes it again and never
 *    erases it. It does NOT create a `readline` interface for this branch at all — deliberately:
 *    an earlier version did, and tried to silence it by overriding its `_writeToOutput` method,
 *    but readline's line-editing machinery (`_refreshLine`) also calls `cursorTo`/`clearScreenDown`
 *    directly on the output stream, a separate path `_writeToOutput` cannot intercept — so the
 *    very first internal redraw erased the just-printed prompt and it was never redrawn, leaving a
 *    blank line for the whole interaction. Reading the keystrokes by hand avoids the problem
 *    entirely: nothing but this function ever touches the terminal, so there is nothing left that
 *    could erase or redraw anything.
 *    Concretely: stdin is put into raw mode and read chunk by chunk. Each chunk first has ANSI/CSI
 *    escape sequences stripped (arrow keys, bracketed-paste markers, ...) plus any stray bare ESC
 *    byte, so cursor/navigation input can't corrupt the typed value; a pasted string arrives as
 *    plain characters and is appended in full. Of what's left: CR or LF finishes; Backspace/Delete
 *    drops the last character typed so far; Ctrl-U clears everything typed so far; any other
 *    control character (code point < 0x20) — Ctrl-C aside — is ignored; everything else is
 *    appended to the value. On Ctrl-C, raw mode is restored, a newline is written, and the process
 *    exits with code 130 (the standard 128+SIGINT convention) instead of leaving the process
 *    hanging. On finish, raw mode is restored the same way, a single trailing newline is written,
 *    and the promise resolves with the trimmed value.
 *  - When stdin is not a TTY (piped input, some CI shells): there is no terminal echo to
 *    suppress in the first place, and no way to guarantee a piping shell won't show it, so this
 *    prints a warning first and falls back to a plain, visible `readline` prompt — unchanged from
 *    before.
 *  Either way, the raw token is only ever returned to the caller — never written to a log or the
 *  console by this function itself.
 */
function promptToken(question: string): Promise<string> {
  return new Promise((resolve) => {
    const output = process.stderr;
    const input = process.stdin;
    const isTTY = input.isTTY === true;

    if (!isTTY) {
      output.write("warning: stdin is not a TTY; input cannot be hidden and may be echoed by your terminal or shell\n");
      const rl = readline.createInterface({ input, output, terminal: false });
      // `rl.question`'s callback is NOT the only way this prompt can end: when stdin is already at
      // EOF (`login --json < /dev/null`, a provisioning script with no input) readline emits `close`
      // and the question callback never fires. Without the `close` handler below this promise never
      // settled — `runLogin` never returned, the `--json` result was never printed and
      // `process.exitCode` was never assigned, so Node exited 0 having silently done nothing and a
      // calling script read that as a successful login. Resolving with "" on close makes the caller
      // take its normal "invalid token" path (exit 2 with a message). `settle` guards against both
      // paths firing (readline always emits `close` after `question` resolves, too).
      let settled = false;
      const settle = (answer: string): void => {
        if (settled) return;
        settled = true;
        resolve(answer);
      };
      rl.on("close", () => settle(""));
      rl.question(question, (answer) => {
        rl.close();
        settle(answer);
      });
      return;
    }

    output.write(question);

    let value = "";
    let done = false;

    // Idempotent: safe to call from the finish path, the Ctrl-C path, or (in principle) both.
    const cleanup = (): void => {
      if (done) return;
      done = true;
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
    };

    const finish = (): void => {
      if (done) return;
      cleanup();
      output.write("\n");
      resolve(value.trim());
    };

    function onData(chunk: string): void {
      // Strip CSI escape sequences (ESC '[' params letter — arrow keys, bracketed-paste markers,
      // ...) and any leftover bare ESC byte, so navigation input can never reach `value`; ordinary
      // (including pasted) text passes through untouched.
      // eslint-disable-next-line no-control-regex -- matching the ESC (0x1b) byte is the point
      const stripped = chunk.replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, "").replace(/\x1b/g, "");
      for (const ch of stripped) {
        if (ch === "\r" || ch === "\n") {
          finish();
          return;
        }
        const code = ch.codePointAt(0) ?? 0;
        if (code === 0x03) {
          // Ctrl-C: never leave the process hanging in raw mode.
          cleanup();
          output.write("\n");
          process.exit(130);
        } else if (code === 0x7f || ch === "\b") {
          value = value.slice(0, -1); // Backspace / Delete
        } else if (code === 0x15) {
          value = ""; // Ctrl-U
        } else if (code < 0x20) {
          // ignore other control characters
        } else {
          value += ch;
        }
      }
    }

    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
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
