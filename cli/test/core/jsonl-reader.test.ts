import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { parseJsonLine, readJsonlLines, zstdSupported, type LineRecord } from "../../src/core/jsonl-reader";

// Temp dirs are tracked and removed in afterEach so failed runs don't litter os.tmpdir().
const tmpDirs: string[] = [];

function tmpFile(name: string, content: Buffer | string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ck-reader-"));
  tmpDirs.push(dir);
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function collect(file: string, opts?: { compressed?: boolean; chunkSize?: number }) {
  const lines: LineRecord[] = [];
  const result = await readJsonlLines(file, (rec) => lines.push(rec), opts);
  return { lines, result };
}

describe("readJsonlLines", () => {
  it("yields complete lines with byte-accurate end offsets (multi-byte UTF-8)", async () => {
    const file = tmpFile("a.jsonl", '{"a":"é"}\n{"b":"😀"}\n{"c":1}\n');
    const { lines, result } = await collect(file);
    expect(lines.map((l) => l.text)).toEqual(['{"a":"é"}', '{"b":"😀"}', '{"c":1}']);
    expect(lines.map((l) => l.end)).toEqual([11, 24, 32]); // é = 2 bytes, 😀 = 4 bytes
    expect(result).toMatchObject({ consumed: 32, lines: 3, partial: false, bytes: 32 });
    expect(Buffer.from(result.tail, "base64").toString("utf8")).toBe('{"a":"é"}\n{"b":"😀"}\n{"c":1}\n');
  });
  it("does not yield or count a trailing partial line", async () => {
    const file = tmpFile("b.jsonl", '{"a":1}\n{"b":');
    const { lines, result } = await collect(file);
    expect(lines).toHaveLength(1);
    expect(result).toMatchObject({ consumed: 8, lines: 1, partial: true, bytes: 13 });
    expect(Buffer.from(result.tail, "base64").toString("utf8")).toBe('{"a":1}\n');
  });
  it("reassembles lines split across tiny chunks and strips CR", async () => {
    const file = tmpFile("c.jsonl", "héllo\r\nwörld\r\n");
    const { lines, result } = await collect(file, { chunkSize: 3 });
    expect(lines.map((l) => l.text)).toEqual(["héllo", "wörld"]);
    expect(lines.map((l) => l.end)).toEqual([8, 16]);
    expect(result.consumed).toBe(16);
  });
  it("handles a line larger than 1 MiB and keeps a 64-byte tail", async () => {
    const big = `{"x":"${"y".repeat(1_200_000)}"}`;
    const file = tmpFile("d.jsonl", `${big}\n{}\n`);
    const { lines, result } = await collect(file, { chunkSize: 64 * 1024 });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.text.length).toBe(big.length);
    expect(lines[1]?.text).toBe("{}");
    expect(Buffer.from(result.tail, "base64").length).toBe(64);
  });
  it("yields corrupt lines as text; parseJsonLine returns undefined for them", async () => {
    const file = tmpFile("e.jsonl", "{not json\n{\"ok\":true}\n");
    const { lines } = await collect(file);
    expect(parseJsonLine(lines[0]?.text ?? "")).toBeUndefined();
    expect(parseJsonLine(lines[1]?.text ?? "")).toEqual({ ok: true });
  });
  it("reads an empty file", async () => {
    const { lines, result } = await collect(tmpFile("f.jsonl", ""));
    expect(lines).toEqual([]);
    expect(result).toEqual({ consumed: 0, lines: 0, tail: "", partial: false, bytes: 0 });
  });
  it.skipIf(!zstdSupported())("streams zstd-compressed files", async () => {
    const compressed = zlib.zstdCompressSync(Buffer.from('{"a":1}\n{"b":2}\n'));
    const file = tmpFile("g.jsonl.zst", compressed);
    const { lines, result } = await collect(file, { compressed: true });
    expect(lines.map((l) => l.text)).toEqual(['{"a":1}', '{"b":2}']);
    expect(result).toMatchObject({ lines: 2, partial: false, tail: "" });
  });
});
