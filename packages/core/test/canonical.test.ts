import { describe, expect, it } from "vitest";
import { EnspackError, canonicalJson, cidMatches, manifestCid, parseCid } from "../src/index.js";

const ENSPACK_BYTES = new TextEncoder().encode("enspack");
/** sha2-256 raw CIDv1 of UTF-8 "enspack", computed once and pinned. */
const ENSPACK_CID = "bafkreibtpfyx25ckr5fj2r7tfh6m6bdmzqnb3kq7lywlqs53peqq6h2ble";

describe("canonicalJson", () => {
  it("is byte-identical across key order and nested key order", () => {
    const a = { z: { b: 1, a: 2 }, a: 0, list: [3, { y: 1, x: 2 }] };
    const b = { list: [3, { x: 2, y: 1 }], a: 0, z: { a: 2, b: 1 } };
    expect(canonicalJson(a)).toEqual(canonicalJson(b));
    expect(new TextDecoder().decode(canonicalJson(a))).toBe(
      '{"a":0,"list":[3,{"x":2,"y":1}],"z":{"a":2,"b":1}}',
    );
  });

  it("uses compact separators and no trailing newline", () => {
    const bytes = canonicalJson({ b: 1, a: 2 });
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe('{"a":2,"b":1}');
    expect(text.endsWith("\n")).toBe(false);
    expect(text.includes(" ")).toBe(false);
  });

  it("rejects non-finite numbers and undefined at top level", () => {
    expect(() => canonicalJson(undefined)).toThrow(EnspackError);
    expect(() => canonicalJson(Number.NaN)).toThrow(EnspackError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(EnspackError);
  });
});

describe("manifestCid", () => {
  it("of a known byte string equals the pinned CID and has prefix bafkrei", async () => {
    const cid = await manifestCid(ENSPACK_BYTES);
    expect(cid).toBe(ENSPACK_CID);
    expect(cid.startsWith("bafkrei")).toBe(true);
  });

  it("cidMatches is true for the pinned CID and false for another payload", async () => {
    expect(await cidMatches(ENSPACK_CID, ENSPACK_BYTES)).toBe(true);
    expect(await cidMatches(ENSPACK_CID, new TextEncoder().encode("other"))).toBe(false);
  });
});

describe("parseCid", () => {
  it("returns a CID for well-formed input and throws VERIFY on malformed input", () => {
    expect(parseCid(ENSPACK_CID).toString()).toBe(ENSPACK_CID);
    expect(() => parseCid("not-a-cid")).toThrow(EnspackError);
    try {
      parseCid("not-a-cid");
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
    }
  });
});
