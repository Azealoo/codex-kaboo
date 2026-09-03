// web/convex/lib/hash.test.ts
import { describe, expect, it } from "vitest";
import {
  base64Url,
  bytesToHex,
  generateRawToken,
  parseBearer,
  sha256Hex,
  tokenPrefix,
} from "./hash";

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("matches the known digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("bytesToHex", () => {
  it("zero-pads every byte", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });
});

describe("base64Url", () => {
  it("uses the url alphabet and strips padding", () => {
    expect(base64Url(new Uint8Array([251, 255, 191]))).toBe("-_-_");
    expect(base64Url(new Uint8Array([1]))).toBe("AQ");
  });
});

describe("generateRawToken / tokenPrefix", () => {
  it("produces ck_ tokens of 43 url-safe characters that differ per call", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).toMatch(/^ck_[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^ck_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it("keeps the prefix plus six characters", () => {
    expect(tokenPrefix("ck_abcdefXYZ123")).toBe("ck_abcdef");
  });
});

describe("parseBearer", () => {
  it("extracts the token case-insensitively", () => {
    expect(parseBearer("Bearer ck_abc")).toBe("ck_abc");
    expect(parseBearer("bearer ck_abc")).toBe("ck_abc");
    expect(parseBearer("  Bearer   ck_abc  ")).toBe("ck_abc");
  });
  it("rejects other schemes and malformed headers", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic ck_abc")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer a b")).toBeNull();
  });
});
