import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Regression coverage for the hidden-token prompt in cli/src/main.ts (`promptToken`). Node has no
// built-in way to allocate a pseudo-terminal, and `promptToken` only takes its raw-mode branch
// when `process.stdin.isTTY` is true, so this can only be exercised end to end against a real pty
// — hence shelling out to python3's stdlib `pty` module (no new dependency; guarded below and
// skipped when python3 or a pty aren't available, e.g. on Windows).
const here = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(here, "..", "..");
const distEntry = path.join(cliRoot, "dist", "codex-kaboo.js");
const helper = path.join(here, "pty-helper.py");

function hasPython3WithPty(): boolean {
  if (process.platform === "win32") return false; // the stdlib `pty` module does not exist on Windows
  const res = spawnSync("python3", ["-c", "import pty, termios"], { stdio: "ignore" });
  return res.status === 0;
}

const canRunPty = hasPython3WithPty();

let builtOnce = false;
/** Rebuilds dist/codex-kaboo.js exactly once per test-file run, however many describe blocks in
 * this file need it — every test here spawns the built binary, so a stale or missing dist would
 * make them test the wrong code (or fail outright). `shell: true` on Windows works around
 * execFileSync not resolving `npm` (vs. `npm.cmd`) there without it. */
function ensureBuilt(): void {
  if (builtOnce) return;
  execFileSync("npm", ["run", "build"], { cwd: cliRoot, stdio: "pipe", shell: process.platform === "win32" });
  builtOnce = true;
}

interface PtyAction {
  write?: string;
  sleep_ms?: number;
  sigint?: boolean;
}

interface PtyResult {
  output_b64: string;
  exit_code: number | null;
  timed_out: boolean;
  final_icanon: boolean | null;
}

/**
 * Runs the pty helper and returns its result. Deliberately async (`execFile`, not `execFileSync`):
 * several tests below run an in-process HTTP mock server that the spawned CLI must be able to
 * reach, and that server can only accept/respond to connections while Node's event loop is free to
 * run — a *synchronous* execFileSync call here would block that same event loop for the whole
 * duration of the pty session, deadlocking those tests (the request would never be serviced).
 * Keeping this async avoids that trap for every caller, not just the ones that currently need it.
 */
function runPty(
  args: string[],
  actions: PtyAction[],
  envExtra: Record<string, string>,
  timeoutS = 10,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean; finalIcanon: boolean | null }> {
  const planDir = mkdtempSync(path.join(os.tmpdir(), "ck-pty-plan-"));
  const planFile = path.join(planDir, "plan.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      cmd: [process.execPath, distEntry, ...args],
      env: envExtra,
      cwd: cliRoot,
      timeout_s: timeoutS,
      actions,
    }),
  );
  return new Promise((resolve, reject) => {
    // -B: never write a __pycache__ next to the checked-in helper (this is a repo, not a scratch dir).
    execFile("python3", ["-B", helper, planFile], { encoding: "utf8", timeout: (timeoutS + 5) * 1000 }, (error, stdout, stderr) => {
      rmSync(planDir, { recursive: true, force: true });
      if (error) {
        reject(new Error(`pty-helper.py failed: ${error.message}\n${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout) as PtyResult;
        resolve({
          output: Buffer.from(result.output_b64, "base64").toString("utf8"),
          exitCode: result.exit_code,
          timedOut: result.timed_out,
          finalIcanon: result.final_icanon,
        });
      } catch (parseError) {
        reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
      }
    });
  });
}

/**
 * Runs `login --server http://127.0.0.1:<mock port>` against a tiny local mock server that just
 * records the `Authorization` header of the request it receives (and replies 401, so `runLogin`
 * fails fast without retrying). Since the CLI is never allowed to print the token anywhere, this
 * is the only reliable way to check the *exact* value `promptToken` resolved to — proving it was
 * captured correctly (survived Backspace edits / arrow-key noise / a fast paste) even though it
 * was never visible in the terminal output.
 */
async function runLoginAgainstMockServer(actions: PtyAction[], kabooHome: string, timeoutS = 10): Promise<{ output: string; capturedAuth: string | null | undefined }> {
  let capturedAuth: string | null | undefined;
  const server = http.createServer((req, res) => {
    capturedAuth = req.headers.authorization;
    const body = JSON.stringify({ error: "unauthorized" });
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const { output } = await runPty(["login", "--server", `http://127.0.0.1:${port}`], actions, { CODEX_KABOO_HOME: kabooHome }, timeoutS);
    return { output, capturedAuth };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe.skipIf(!canRunPty)("promptToken (real pty)", () => {
  let kabooHome: string;

  beforeAll(() => {
    ensureBuilt();
  }, 60_000);

  beforeEach(() => {
    kabooHome = mkdtempSync(path.join(os.tmpdir(), "ck-pty-home-"));
  });

  afterEach(() => {
    rmSync(kabooHome, { recursive: true, force: true });
  });

  it("never echoes typed characters across a Backspace edit, and never erases the prompt", async () => {
    // Reproduces the exact finding: typing "135X", Backspace (removing the X), then "79", Enter,
    // yielding "13579". Round 1's fix (mute readline's _writeToOutput) closed the character-echo
    // leak but readline's _refreshLine also calls cursorTo/clearScreenDown directly on the output,
    // a separate path _writeToOutput cannot intercept — which erased the freshly-printed prompt on
    // the very first internal redraw and never redrew it, leaving a blank line for the rest of the
    // interaction. This asserts BOTH properties: no leak, and the prompt is never erased.
    const { output, exitCode } = await runPty(
      ["login", "--server", "http://127.0.0.1:1"],
      [
        { sleep_ms: 300 },
        { write: "1", sleep_ms: 60 },
        { write: "3", sleep_ms: 60 },
        { write: "5", sleep_ms: 60 },
        { write: "X", sleep_ms: 60 },
        { write: "\x7f", sleep_ms: 60 }, // Backspace: removes the "X"
        { write: "7", sleep_ms: 60 },
        { write: "9", sleep_ms: 60 },
        { write: "\r", sleep_ms: 600 },
      ],
      { CODEX_KABOO_HOME: kabooHome },
    );
    expect(output).toContain("Paste your sync token");
    expect(output).not.toContain("13579");
    expect(output).not.toContain("1359");
    expect(output).not.toContain("135");
    expect(output).not.toContain("13");
    expect(exitCode).toBe(2); // "13579" doesn't start with ck_, so runLogin rejects it — expected

    // The prompt must still be visible: no "erase to end of screen" / "erase line" escape may
    // appear anywhere after the prompt bytes (there should be no escape sequences at all here,
    // since the TTY branch no longer goes through readline's redraw machinery — but assert the
    // ordering explicitly, not just "none exist", so this stays meaningful if that ever changes).
    const promptIndex = output.indexOf("Paste your sync token");
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    // eslint-disable-next-line no-control-regex -- matching real terminal erase sequences is the point
    const eraseSeq = /\x1b\[(?:0J|2K)/g;
    const eraseIndexesAfterPrompt: number[] = [];
    for (const match of output.matchAll(eraseSeq)) {
      if ((match.index ?? -1) > promptIndex) eraseIndexesAfterPrompt.push(match.index as number);
    }
    expect(eraseIndexesAfterPrompt).toEqual([]);
  });

  it("resolves a Backspace-edited value to exactly the intended text", async () => {
    // Same edit pattern as above ("...X", Backspace, "79"), but with a ck_-prefixed value so the
    // exact resolved string can be checked end to end via the mock server's Authorization header
    // — proving the Backspace correctly dropped just the "X" and nothing else was corrupted.
    const { output, capturedAuth } = await runLoginAgainstMockServer(
      [
        { sleep_ms: 300 },
        { write: "ck_1", sleep_ms: 60 },
        { write: "3", sleep_ms: 60 },
        { write: "5", sleep_ms: 60 },
        { write: "X", sleep_ms: 60 },
        { write: "\x7f", sleep_ms: 60 }, // Backspace: removes the "X"
        { write: "7", sleep_ms: 60 },
        { write: "9", sleep_ms: 60 },
        { write: "\r", sleep_ms: 600 },
      ],
      kabooHome,
    );
    expect(capturedAuth).toBe("Bearer ck_13579");
    expect(output).not.toContain("13579");
    expect(output).not.toContain("ck_13579");
  });

  it("still captures a fast multi-character paste in full, without ever echoing it", async () => {
    // A real terminal paste delivers the whole clipboard string in one (or a few) chunk(s), not
    // one keystroke at a time. Simulated here with a single write() of the whole token.
    const token = "ck_pastedFULLtoken1234567890";
    const { output, capturedAuth } = await runLoginAgainstMockServer(
      [{ sleep_ms: 300 }, { write: token, sleep_ms: 300 }, { write: "\r", sleep_ms: 800 }],
      kabooHome,
    );
    expect(output).not.toContain(token);
    expect(capturedAuth).toBe(`Bearer ${token}`);
  });

  it("ignores an arrow-key sequence typed mid-entry without corrupting the value", async () => {
    // Arrow keys are CSI sequences (ESC '[' 'A'/'B'/'C'/'D'); they must be stripped wholesale, not
    // partially interpreted as literal characters or control codes.
    const { output, capturedAuth } = await runLoginAgainstMockServer(
      [
        { sleep_ms: 300 },
        { write: "ck_1", sleep_ms: 60 },
        { write: "\x1b[A", sleep_ms: 60 }, // Up
        { write: "\x1b[B", sleep_ms: 60 }, // Down
        { write: "\x1b[C", sleep_ms: 60 }, // Right
        { write: "\x1b[D", sleep_ms: 60 }, // Left
        { write: "23", sleep_ms: 60 },
        { write: "\r", sleep_ms: 600 },
      ],
      kabooHome,
    );
    expect(capturedAuth).toBe("Bearer ck_123");
    expect(output).not.toContain("ck_123");
  });

  it("exits 130 promptly on a real interactive Ctrl-C, restoring cooked mode", async () => {
    const { exitCode, timedOut, finalIcanon } = await runPty(
      ["login", "--server", "http://127.0.0.1:1"],
      [{ sleep_ms: 300 }, { write: "ab", sleep_ms: 100 }, { sigint: true, sleep_ms: 500 }],
      { CODEX_KABOO_HOME: kabooHome },
      5,
    );
    expect(timedOut).toBe(false);
    expect(exitCode).toBe(130);
    // The pty must be left in canonical/"cooked" mode (echo + line buffering handled by the tty
    // driver again), not stuck in raw mode — i.e. setRawMode(false) really ran before exiting.
    expect(finalIcanon).toBe(true);
  });
});

describe("promptToken (non-TTY fallback)", () => {
  // Plain piped stdin, not a pty — needs neither python3 nor platform gating, so it keeps running
  // (including on Windows) even when the pty-based describe block above is skipped. It still needs
  // its own fresh build, hence its own beforeAll — ensureBuilt() no-ops if the block above already
  // built it in this same run.
  beforeAll(() => {
    ensureBuilt();
  }, 60_000);

  it("falls back to a visible, warned prompt when stdin is not a TTY (no pty needed)", () => {
    const kabooHome = mkdtempSync(path.join(os.tmpdir(), "ck-nontty-home-"));
    try {
      let output = "";
      try {
        execFileSync(process.execPath, [distEntry, "login", "--server", "http://127.0.0.1:1"], {
          input: "ck_pipedNonTtyToken\n",
          encoding: "utf8",
          env: { ...process.env, CODEX_KABOO_HOME: kabooHome },
          timeout: 15_000,
        });
      } catch (error) {
        // login is expected to fail (nothing is listening on 127.0.0.1:1); execFileSync throws on
        // a non-zero exit code and still attaches the captured output.
        const withOutput = error as { stdout?: string; stderr?: string };
        output = `${withOutput.stdout ?? ""}${withOutput.stderr ?? ""}`;
      }
      expect(output).toContain("warning: stdin is not a TTY");
      expect(output).not.toContain("ck_pipedNonTtyToken");
    } finally {
      rmSync(kabooHome, { recursive: true, force: true });
    }
  });

  it("fails loudly instead of exiting 0 silently when stdin is at EOF", () => {
    // Regression: `rl.question`'s callback was the ONLY thing that could settle promptToken's
    // promise, but at EOF readline emits `close` and never calls it — so runLogin never returned,
    // the --json result was never printed, process.exitCode was never assigned, and Node exited 0
    // with empty stdout having written no config. A provisioning script read that as success.
    const kabooHome = mkdtempSync(path.join(os.tmpdir(), "ck-eof-home-"));
    try {
      let stdout = "";
      let stderr = "";
      let status: number | null = 0;
      try {
        stdout = execFileSync(process.execPath, [distEntry, "login", "--server", "https://example.invalid", "--json"], {
          input: "", // EOF immediately
          encoding: "utf8",
          env: { ...process.env, CODEX_KABOO_HOME: kabooHome },
          timeout: 15_000,
        });
      } catch (error) {
        const e = error as { stdout?: string; stderr?: string; status?: number | null; signal?: string | null };
        stdout = e.stdout ?? "";
        stderr = e.stderr ?? "";
        status = e.status ?? null;
        expect(e.signal ?? null).toBeNull(); // it must exit on its own, not be killed by the timeout
      }
      expect(status).toBe(2);
      const parsed = JSON.parse(stdout) as { ok: boolean; exitCode: number; error?: string };
      expect(parsed.ok).toBe(false);
      expect(parsed.exitCode).toBe(2);
      expect(parsed.error).toContain("no token provided");
      expect(stderr).not.toContain("no token provided"); // --json puts the result on stdout
      expect(existsSync(path.join(kabooHome, "config.json"))).toBe(false);
    } finally {
      rmSync(kabooHome, { recursive: true, force: true });
    }
  });
});
