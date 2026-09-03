import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  /** Append every line here (created on demand, rotated to `<file>.1` at maxBytes). */
  file?: string;
  /** Hide info/debug on the console (warn/error always show). */
  quiet?: boolean;
  /** Show debug on the console. */
  verbose?: boolean;
  console?: (line: string) => void;
  maxBytes?: number;
  now?: () => number;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;

export function createLogger(opts: LoggerOptions = {}): Logger {
  const write = opts.console ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = opts.now ?? (() => Date.now());
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let dirReady = false;

  const toFile = (line: string): void => {
    if (!opts.file) return;
    try {
      if (!dirReady) {
        mkdirSync(path.dirname(opts.file), { recursive: true });
        dirReady = true;
      }
      try {
        if (statSync(opts.file).size >= maxBytes) renameSync(opts.file, `${opts.file}.1`);
      } catch {
        // file does not exist yet
      }
      appendFileSync(opts.file, `${line}\n`, "utf8");
    } catch {
      // logging must never break a sync
    }
  };

  const emit = (level: LogLevel, message: string): void => {
    const line = `${new Date(now()).toISOString()} ${level.toUpperCase()} ${message}`;
    toFile(line);
    const showOnConsole =
      level === "error" ||
      level === "warn" ||
      (level === "info" && !opts.quiet) ||
      (level === "debug" && opts.verbose === true);
    if (showOnConsole) write(line);
  };

  return {
    debug: (m) => emit("debug", m),
    info: (m) => emit("info", m),
    warn: (m) => emit("warn", m),
    error: (m) => emit("error", m),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
