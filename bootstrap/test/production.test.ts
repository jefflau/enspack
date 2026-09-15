import { DEFAULT_GATEWAYS, PINATA_GATEWAY, gatewaysFromEnv } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { createProductionDeps } from "../src/production.js";

const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("createProductionDeps gateways (WP-22)", () => {
  it("honours ENSPACK_IPFS_GATEWAYS via gatewaysFromEnv", () => {
    const extra = "https://custom.example/ipfs/{cid}";
    const env: NodeJS.ProcessEnv = {
      ENSPACK_OPERATOR_KEY: ANVIL_0_KEY,
      SEPOLIA_RPC_URL: "http://127.0.0.1:1",
      ENSPACK_IPFS_GATEWAYS: extra,
    };
    expect(gatewaysFromEnv(env)).toEqual([extra, PINATA_GATEWAY, ...DEFAULT_GATEWAYS]);
    const deps = createProductionDeps({
      chain: "sepolia",
      env,
      pin: "kubo",
      dryRun: true,
    });
    expect(deps.store).toBeDefined();
    expect(typeof deps.store.getVerified).toBe("function");
  });
});
