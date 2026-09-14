import { getAddress, keccak256, toBytes } from "viem";
import { labelhash } from "viem/ens";
import { describe, expect, it } from "vitest";
import { EnspackError, ensV2ConfigFor, ensVersionFor, labelId } from "../../src/index.js";

const UR = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe";
const FACTORY = "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef";
const ALT = "0x0000000000000000000000000000000000000001";

describe("ensVersionFor", () => {
  it("defaults sepolia to v2 and mainnet to v1", () => {
    expect(ensVersionFor("sepolia", {})).toBe("v2");
    expect(ensVersionFor("mainnet", {})).toBe("v1");
  });

  it("honours ENSPACK_ENS_VERSION override", () => {
    expect(ensVersionFor("sepolia", { ENSPACK_ENS_VERSION: "v1" })).toBe("v1");
    expect(ensVersionFor("mainnet", { ENSPACK_ENS_VERSION: "v2" })).toBe("v2");
  });

  it("rejects an invalid override", () => {
    expect(() => ensVersionFor("sepolia", { ENSPACK_ENS_VERSION: "v3" })).toThrow(EnspackError);
    try {
      ensVersionFor("sepolia", { ENSPACK_ENS_VERSION: "v3" });
    } catch (e) {
      expect(e).toMatchObject({ code: "RESOLVE", message: "ENSPACK_ENS_VERSION must be v1 or v2" });
    }
  });
});

describe("ensV2ConfigFor", () => {
  it("returns Sepolia defaults", () => {
    const cfg = ensV2ConfigFor("sepolia", {});
    expect(cfg.universalResolver).toBe(getAddress(UR));
    expect(cfg.verifiableFactory).toBe(getAddress(FACTORY));
  });

  it("applies env overrides", () => {
    const cfg = ensV2ConfigFor("sepolia", {
      ENSPACK_ENSV2_UNIVERSAL_RESOLVER: ALT,
      ENSPACK_ENSV2_ETH_REGISTRAR: ALT,
    });
    expect(cfg.universalResolver).toBe(getAddress(ALT));
    expect(cfg.ethRegistrar).toBe(getAddress(ALT));
    expect(cfg.verifiableFactory).toBe(getAddress(FACTORY));
  });

  it("throws RESOLVE for mainnet", () => {
    expect(() => ensV2ConfigFor("mainnet", {})).toThrow(EnspackError);
    try {
      ensV2ConfigFor("mainnet", {});
    } catch (e) {
      expect(e).toMatchObject({ code: "RESOLVE", message: "ENSv2 is not deployed on mainnet" });
    }
  });

  it("throws RESOLVE for an invalid override address", () => {
    expect(() => ensV2ConfigFor("sepolia", { ENSPACK_ENSV2_UNIVERSAL_RESOLVER: "0x123" })).toThrow(
      EnspackError,
    );
  });
});

describe("labelId", () => {
  it("is uint256(keccak256(bytes(label)))", () => {
    expect(labelId("eth")).toBe(BigInt(labelhash("eth")));
    expect(labelId("eth")).toBe(BigInt(keccak256(toBytes("eth"))));
    expect(labelId("enspack-test")).toBe(BigInt(keccak256(toBytes("enspack-test"))));
  });
});
