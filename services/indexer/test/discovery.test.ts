import { dnsEncodeName } from "@enspack/core";
import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { type ResolverReadClient, discoverResolvers } from "../src/config.js";

const R_ROOT = "0x1111111111111111111111111111111111111111" as const;
const R_MIRRORS = "0x2222222222222222222222222222222222222222" as const;
const R_ENV = "0x3333333333333333333333333333333333333333" as const;
const NODE = `0x${"ab".repeat(32)}` as const;

function dnsOf(name: string): string {
  return dnsEncodeName(name);
}

function mockFindResolver(map: Record<string, `0x${string}`>): ResolverReadClient {
  return {
    async readContract(opts) {
      if (opts.functionName !== "findResolver") {
        throw new Error(`unexpected ${String(opts.functionName)}`);
      }
      const dns = Array.isArray(opts.args) ? opts.args[0] : undefined;
      if (typeof dns !== "string") {
        throw new Error("expected dns name");
      }
      const enspack = dnsOf("enspack.eth");
      const mirrors = dnsOf("mirrors.enspack.eth");
      if (dns === enspack) {
        return [map["enspack.eth"] ?? zeroAddress, NODE, 0n];
      }
      if (dns === mirrors) {
        return [map["mirrors.enspack.eth"] ?? zeroAddress, NODE, 0n];
      }
      throw new Error(`unexpected name ${dns}`);
    },
  } as ResolverReadClient;
}

describe("discoverResolvers v2 (Sepolia)", () => {
  it("findResolver for both names, skips zero, unions env", async () => {
    const client = mockFindResolver({
      "enspack.eth": R_ROOT,
      "mirrors.enspack.eth": zeroAddress,
    });
    const found = await discoverResolvers(
      "sepolia",
      {
        SEPOLIA_RPC_URL: "http://127.0.0.1:9",
        ENSPACK_INDEXER_RESOLVERS_SEPOLIA: R_ENV,
      },
      client,
    );
    expect(found).toEqual([R_ENV, R_ROOT]);
  });

  it("unions both discovered PermissionedResolver proxies", async () => {
    const client = mockFindResolver({
      "enspack.eth": R_ROOT,
      "mirrors.enspack.eth": R_MIRRORS,
    });
    const found = await discoverResolvers(
      "sepolia",
      { SEPOLIA_RPC_URL: "http://127.0.0.1:9" },
      client,
    );
    expect(found).toEqual([R_ROOT, R_MIRRORS]);
  });

  it("throws when nothing remains after skipping zero", async () => {
    const client = mockFindResolver({
      "enspack.eth": zeroAddress,
      "mirrors.enspack.eth": zeroAddress,
    });
    await expect(
      discoverResolvers("sepolia", { SEPOLIA_RPC_URL: "http://127.0.0.1:9" }, client),
    ).rejects.toThrow(/no resolvers to index on sepolia/);
  });
});
