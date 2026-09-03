#!/usr/bin/env python3
"""PTY driver used by cli/test/commands/prompt.test.ts (and by hand for manual verification).

Node has no built-in way to allocate a pseudo-terminal, and `promptToken` in cli/src/main.ts only
takes its TTY-muting code path when process.stdin.isTTY is true — so exercising it at all (from a
test or by hand) requires a real pty, not a plain pipe. This script spawns the given command
attached to one, plays back a scripted sequence of raw byte writes / sleeps / SIGINT, captures
every byte the child writes back to the pty (i.e. exactly what a real terminal would have shown a
person), and prints a single JSON object describing the result to ITS OWN stdout — a plain pipe,
never the pty, so it can't be confused with the child's captured output.

Usage: python3 pty-helper.py <plan.json>
plan.json: {
  "cmd": [argv0, argv1, ...],
  "env": { "NAME": "value", ... },   // merged over this process's environment
  "cwd": "...",
  "timeout_s": 10,                    // overall budget; the child is killed if it runs past this
  "actions": [
    { "write": "text" },              // raw bytes to the pty master (a keystroke, or a whole
                                       // pasted string written in one write() call)
    { "sleep_ms": 50 },                // let the child react before the next action
    { "sigint": true }                 // write the raw 0x03 byte (a real interactive Ctrl-C,
                                       // as delivered through a raw-mode tty — NOT an OS signal
                                       // sent straight to the process, which is a different path)
  ]
}
Prints: {"output_b64": "...", "exit_code": <int|null>, "timed_out": <bool>, "final_icanon": <bool>}
final_icanon reflects the pty's line discipline *after* the child has exited (or been killed on
timeout): true means canonical/"cooked" mode — echo and line buffering are handled by the tty
driver again — which is what a well-behaved raw-mode reader must restore before it finishes,
however it finishes (including on Ctrl-C). false means the pty was left in raw mode, e.g. because
the child exited (or was killed) without ever calling setRawMode(false).
"""
import base64
import json
import os
import pty
import select
import subprocess
import sys
import termios
import time


def pump(master, output, until):
    while time.time() < until:
        remaining = until - time.time()
        if remaining <= 0:
            return
        ready, _, _ = select.select([master], [], [], min(0.05, remaining))
        if master not in ready:
            continue
        try:
            chunk = os.read(master, 4096)
        except OSError:
            return
        if not chunk:
            return
        output.append(chunk)


def main() -> None:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        plan = json.load(f)

    env = dict(os.environ)
    env.update(plan.get("env", {}))
    timeout_s = float(plan.get("timeout_s", 10))
    deadline = time.time() + timeout_s

    master, slave = pty.openpty()
    proc = subprocess.Popen(
        plan["cmd"],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=plan.get("cwd"),
        env=env,
        close_fds=True,
    )
    os.close(slave)

    output: list[bytes] = []
    for action in plan.get("actions", []):
        if time.time() >= deadline:
            break
        if "write" in action:
            os.write(master, action["write"].encode("utf-8"))
        elif action.get("sigint"):
            # A real interactive Ctrl-C is delivered as the raw 0x03 byte through the pty, not as
            # an OS-level signal sent to the process: readline puts the tty in raw mode (ISIG
            # disabled), so the kernel does NOT translate Ctrl-C into SIGINT itself — it hands the
            # literal byte to whoever is reading stdin, and it's readline's own keypress parser
            # that recognizes 0x03 and emits the interface's 'SIGINT' event. Sending an OS signal
            # directly (proc.send_signal) bypasses that parser entirely and exercises a different
            # (default Node) code path, so it must not be used here.
            os.write(master, b"\x03")
        sleep_ms = action.get("sleep_ms", 20)
        pump(master, output, min(time.time() + sleep_ms / 1000.0, deadline))

    timed_out = False
    while proc.poll() is None:
        if time.time() >= deadline:
            timed_out = True
            break
        pump(master, output, min(time.time() + 0.2, deadline))
    pump(master, output, time.time() + 0.2)  # final drain

    exit_code = None
    if timed_out:
        try:
            proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=2)
        except Exception:
            pass
    else:
        try:
            exit_code = proc.wait(timeout=2)
        except Exception:
            timed_out = True

    final_icanon = None
    try:
        attrs = termios.tcgetattr(master)
        final_icanon = bool(attrs[3] & termios.ICANON)
    except (OSError, termios.error):
        pass  # master already gone (e.g. the child closed its end) — leave as None

    try:
        os.close(master)
    except OSError:
        pass

    sys.stdout.write(
        json.dumps(
            {
                "output_b64": base64.b64encode(b"".join(output)).decode("ascii"),
                "exit_code": exit_code,
                "timed_out": timed_out,
                "final_icanon": final_icanon,
            }
        )
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
