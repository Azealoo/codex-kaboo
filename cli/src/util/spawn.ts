import { spawn } from "node:child_process";
import type { Spawner, SpawnResult } from "../schedule/index";

/**
 * Real child-process spawner: never throws, resolves { code: null } when the command cannot start.
 * Also resolves { code: null, timedOut: true } if the command does not exit within `opts.timeoutMs`
 * (default 30 s) — guards against a wedged launchctl/schtasks/crontab (elevation prompt, unresponsive
 * daemon) hanging install/uninstall/status/doctor forever.
 */
export const nodeSpawner: Spawner = {
  run(command, args, opts = {}) {
    return new Promise<SpawnResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      } catch (error) {
        resolve({
          code: null,
          stdout,
          stderr: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      const timeoutMs = opts.timeoutMs ?? 30_000;
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: null, stdout, stderr, timedOut: true });
      }, timeoutMs);
      timer.unref();
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: stderr || error.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      if (opts.input !== undefined) child.stdin?.end(opts.input);
      else child.stdin?.end();
    });
  },
};
