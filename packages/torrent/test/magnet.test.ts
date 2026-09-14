import { EnspackError, MAGNET_RE } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { checkMagnet } from "../src/index.js";

const HEX = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("checkMagnet", () => {
  it("throws VERIFY for a shell-injection string", () => {
    expect(() => checkMagnet("--dir=/etc")).toThrow(EnspackError);
    try {
      checkMagnet("--dir=/etc");
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
    }
  });

  it("throws VERIFY for a magnet with non-hex infohash", () => {
    expect(() => checkMagnet(`magnet:?xt=urn:btih:${"z".repeat(40)}`)).toThrow(EnspackError);
    try {
      checkMagnet(`magnet:?xt=urn:btih:${"z".repeat(40)}`);
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
    }
  });

  it("accepts a magnet that matches MAGNET_RE even with extra params after &", () => {
    const s = `magnet:?xt=urn:btih:${HEX}&dn=x --dir=/etc`;
    expect(MAGNET_RE.test(s)).toBe(true);
    expect(checkMagnet(s)).toBe(s);
  });
});
