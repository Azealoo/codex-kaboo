import { describe, expect, it } from "vitest";
import { makeSummary } from "@codex-kaboo/shared/test-fixtures";
import { canonicalJson, sha1Hex, sha256Hex, summaryHashOf } from "../../src/util/hash";

describe("canonicalJson", () => {
  it("sorts keys recursively, keeps array order and drops undefined", () => {
    const a = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } });
    const b = canonicalJson({ a: { d: [3, { y: 2, z: 1 }] }, b: 1 });
    expect(a).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(a).toBe(b);
  });
});

describe("hashes", () => {
  it("computes sha1 and sha256 hex digests", () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("hashes a summary ignoring summaryHash, inProgress, lineCount and generation", () => {
    const base = makeSummary();
    const h = summaryHashOf(base);
    expect(h).toMatch(/^[0-9a-f]{40}$/);
    expect(summaryHashOf(makeSummary({ inProgress: true, lineCount: 999, generation: 7, summaryHash: "0".repeat(40) }))).toBe(h);
    expect(summaryHashOf(makeSummary({ turns: 3 }))).not.toBe(h);
  });
});
