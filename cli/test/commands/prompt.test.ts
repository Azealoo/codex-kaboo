import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Regression coverage for the hidden-token prompt in cli/src/main.ts (`promptToken`). Node has no
// built-in way to allocate a pseudo-terminal, and `promptToken` only takes its echo-muting branch
// when `process.stdin.isTTY` is true, so this can only be exercised end to end against a real pty
// — hence shelling out to python3's stdlib `pty` module (no new dependency; guarded below and
// skipped when python3 or a pty aren't available, e.g. on Windows).
const here = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(here, "..", "..");
const distEntry = path.join(cliRoot, "dist", "codex-kaboo.js");
const helper = path.join(here, "pty-helper.py");

function hasPython3WithPty(): boolean {
  if (process.platform === "win32") return false; // the stdlib `pty` module does not exist on Windows
  const res = spawnSync("python3", ["-c", "import pty"], { stdio: "ignore" });
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
}

/**
 * Runs the pty helper and returns its result. Deliberately async (`execFile`, not `execFileSync`):
 * the "paste" test below runs an in-process HTTP mock server that the spawned CLI must be able to
 * reach, and that server can only accept/respond to connections while Node's event loop is free to
 * run — a *synchronous* execFileSync call here would block that same event loop for the whole
 * duration of the pty session, deadlocking that test (the request would never be serviced). Keeping
 * this async avoids that trap for every caller, not just the one test that currently needs it.
 */
function runPty(args: string[], actions: PtyAction[], envExtra: Record<string, string>, timeoutS = 10): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
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
        resolve({ output: Buffer.from(result.output_b64, "base64").toString("utf8"), exitCode: result.exit_code, timedOut: result.timed_out });
      } catch (parseError) {
        reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
      }
    });
  });
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

  it("never echoes typed characters, even across a Backspace-triggered line redraw", async () => {
    // Reproduces the exact finding: typing "135X", Backspace (removing the X), then "79", Enter.
    // The old `_writeToOutput` override only swallowed writes that did NOT start with the prompt
    // text — but readline redraws `prompt + currentLine` on Backspace/arrow keys/Ctrl-U, and that
    // redraw DOES start with the prompt, so it slipped through and leaked "13" in cleartext.
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
  });

  it("still captures a fast multi-character paste in full, without ever echoing it", async () => {
    // A real terminal paste delivers the whole clipboard string in one (or a few) chunk(s), not
    // one keystroke at a time. Simulated here with a single write() of the whole token. Since the
    // token is never allowed to reach the terminal, the only way to prove it was captured in full
    // is to check what the CLI actually sent over the network for `--server`.
    const token = "ck_pastedFULLtoken1234567890";
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
      const { output } = await runPty(
        ["login", "--server", `http://127.0.0.1:${port}`],
        [{ sleep_ms: 300 }, { write: token, sleep_ms: 300 }, { write: "\r", sleep_ms: 800 }],
        { CODEX_KABOO_HOME: kabooHome },
      );
      expect(output).not.toContain(token);
      expect(capturedAuth).toBe(`Bearer ${token}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("exits 130 promptly on a real interactive Ctrl-C instead of hanging", async () => {
    const { exitCode, timedOut } = await runPty(
      ["login", "--server", "http://127.0.0.1:1"],
      [{ sleep_ms: 300 }, { write: "ab", sleep_ms: 100 }, { sigint: true, sleep_ms: 500 }],
      { CODEX_KABOO_HOME: kabooHome },
      5,
    );
    expect(timedOut).toBe(false);
    expect(exitCode).toBe(130);
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
});
