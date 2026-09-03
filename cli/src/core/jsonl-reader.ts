import { createReadStream, promises as fs } from "node:fs";
import zlib from "node:zlib";
import { TAIL_BYTES } from "./state"; // one definition: the tail this reader writes is the window detectReset compares

export interface LineRecord {
  seq: number; // 0-based complete-line index
  text: string; // line without the trailing \n (and \r)
  end: number; // byte offset just after the '\n'
}

export interface ReadResult {
  consumed: number; // byte offset after the last complete line
  lines: number;
  tail: string; // base64 of the last ≤ 64 bytes before `consumed` ("" for compressed input)
  partial: boolean; // trailing bytes without '\n' exist
  bytes: number; // total bytes read (decompressed bytes for .zst)
}

export interface ReadOptions {
  compressed?: boolean;
  chunkSize?: number;
  /**
   * Byte offset to resume from, which MUST be the `consumed` of an earlier read of the same file
   * (i.e. sit just after a newline). Defaults to 0, a full pass.
   *
   * This exists for the card's live sampler, which re-reads growing rollout files every couple of
   * seconds: a full pass per tick would re-decode megabytes of history to find the few hundred
   * bytes that are new. `consumed`, `seq` and the tail all stay ABSOLUTE — as if the file had been
   * read from the beginning — so a resumed read is interchangeable with a full one.
   */
  start?: number;
  /** `seq` of the first line read; pair it with `start`. Defaults to 0. */
  startSeq?: number;
}

export class ZstdUnsupportedError extends Error {
  constructor() {
    super("zstd decompression needs Node >= 22.15 (zlib.createZstdDecompress)");
    this.name = "ZstdUnsupportedError";
  }
}

type ZlibWithZstd = {
  createZstdDecompress?: () => NodeJS.ReadWriteStream & { destroy(error?: Error): void };
};

export function zstdSupported(): boolean {
  return typeof (zlib as unknown as ZlibWithZstd).createZstdDecompress === "function";
}

export function parseJsonLine(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const NEWLINE = 0x0a;

class LineSplitter {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private position: number;
  seq: number;
  consumed: number;
  private readonly start: number;

  constructor(
    private readonly onLine: (record: LineRecord) => void,
    start = 0,
    startSeq = 0,
  ) {
    this.position = start;
    this.start = start;
    this.seq = startSeq;
    // A resumed read that finds no complete line has still consumed everything before `start`.
    this.consumed = start;
  }

  push(chunk: Buffer): void {
    let start = 0;
    for (;;) {
      const idx = chunk.indexOf(NEWLINE, start);
      if (idx === -1) break;
      const piece = chunk.subarray(start, idx);
      const full = this.pendingBytes > 0 ? Buffer.concat([...this.pending, piece]) : piece;
      this.pending = [];
      this.pendingBytes = 0;
      let text = full.toString("utf8");
      if (text.endsWith("\r")) text = text.slice(0, -1);
      const end = this.position + idx + 1;
      this.onLine({ seq: this.seq, text, end });
      this.seq += 1;
      this.consumed = end;
      start = idx + 1;
    }
    if (start < chunk.length) {
      const rest = Buffer.from(chunk.subarray(start)); // copy: the caller reuses its buffer
      this.pending.push(rest);
      this.pendingBytes += rest.length;
    }
    this.position += chunk.length;
  }

  get partial(): boolean {
    return this.pendingBytes > 0;
  }

  /** Bytes read by THIS pass, not the absolute offset. */
  get bytes(): number {
    return this.position - this.start;
  }
}

async function readTail(handle: fs.FileHandle, consumed: number): Promise<string> {
  if (consumed <= 0) return "";
  const start = Math.max(0, consumed - TAIL_BYTES);
  const buffer = Buffer.alloc(consumed - start);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
  return buffer.subarray(0, bytesRead).toString("base64");
}

export async function readJsonlLines(
  filePath: string,
  onLine: (record: LineRecord) => void,
  opts: ReadOptions = {},
): Promise<ReadResult> {
  const start = opts.start ?? 0;
  const splitter = new LineSplitter(onLine, start, opts.startSeq ?? 0);
  if (opts.compressed) {
    // A zstd stream cannot be seeked into, and it never needs to be: compressed rollouts are
    // Codex's archived, finished sessions, so nothing tails them.
    if (start > 0) throw new RangeError("cannot resume a compressed rollout from an offset");
    const factory = (zlib as unknown as ZlibWithZstd).createZstdDecompress;
    if (typeof factory !== "function") throw new ZstdUnsupportedError();
    const decompressor = factory();
    const source = createReadStream(filePath);
    // .pipe() does not forward 'error' from the source: without this listener, a missing or
    // unreadable .zst file raises an unhandled 'error' on `source` (crash) instead of rejecting.
    // Destroying the decompressor with that error makes the `for await` below reject with it.
    source.on("error", (err) => decompressor.destroy(err));
    source.pipe(decompressor);
    for await (const chunk of decompressor) splitter.push(chunk as Buffer);
    return {
      consumed: splitter.consumed,
      lines: splitter.seq,
      tail: "",
      partial: splitter.partial,
      bytes: splitter.bytes,
    };
  }
  const chunkSize = opts.chunkSize ?? 256 * 1024;
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(chunkSize);
    let position = start;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, position);
      if (bytesRead === 0) break;
      splitter.push(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const tail = await readTail(handle, splitter.consumed);
    return {
      consumed: splitter.consumed,
      lines: splitter.seq,
      tail,
      partial: splitter.partial,
      bytes: position - start,
    };
  } finally {
    await handle.close();
  }
}
