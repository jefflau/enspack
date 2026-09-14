import type { Manifest } from "@enspack/core";
import { ensVersionFor } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { createDefaultDeps } from "../src/defaults.js";
import { applyEnsVersionFlag, ensOptsFor } from "../src/ens.js";
import { capturingWriter } from "./helpers.js";

const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const dummyInput = {
  manifest: { name: "v1-0-0.tiny.enspack.eth" } as Manifest,
  manifestCid: `bafkrei${"a".repeat(52)}`,
  chain: "mainnet" as const,
};

describe("createDefaultDeps publisherFactory", () => {
  it("wires core createPublisher when ENSPACK_PUBLISHER_KEY is set", () => {
    const deps = createDefaultDeps({
      stdout: capturingWriter(),
      stderr: capturingWriter(),
      env: {
        ETH_RPC_URL: "http://127.0.0.1:1",
        ENSPACK_PUBLISHER_KEY: ANVIL_0_KEY,
      },
    });
    const publisher = deps.publisherFactory("mainnet", "http://127.0.0.1:1");
    expect(typeof publisher.publish).toBe("function");
  });

  it("throws PUBLISH when the key is missing", async () => {
    const deps = createDefaultDeps({
      stdout: capturingWriter(),
      stderr: capturingWriter(),
      env: { ETH_RPC_URL: "http://127.0.0.1:1" },
    });
    await expect(
      deps.publisherFactory("mainnet", "http://127.0.0.1:1").publish(dummyInput),
    ).rejects.toMatchObject({
      code: "PUBLISH",
      message: "ENSPACK_PUBLISHER_KEY is not set",
    });
  });
});

describe("ensOptsFor (WP-17)", () => {
  it("selects v2 on sepolia by default", () => {
    const opts = ensOptsFor("sepolia", {});
    expect(opts.ensVersion).toBe("v2");
    expect(opts.ensV2?.universalResolver).toBe("0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe");
  });

  it("selects v1 on mainnet by default", () => {
    expect(ensOptsFor("mainnet", {}).ensVersion).toBe("v1");
    expect(ensOptsFor("mainnet", {}).ensV2).toBeUndefined();
  });

  it("honors ENSPACK_ENS_VERSION=v1 on sepolia", () => {
    expect(ensOptsFor("sepolia", { ENSPACK_ENS_VERSION: "v1" }).ensVersion).toBe("v1");
    expect(ensOptsFor("sepolia", { ENSPACK_ENS_VERSION: "v1" }).ensV2).toBeUndefined();
  });

  it("createDefaultDeps sepolia factory closes over env so ensVersion is v2", () => {
    const env: NodeJS.ProcessEnv = {
      SEPOLIA_RPC_URL: "http://127.0.0.1:1",
      ENSPACK_PUBLISHER_KEY: ANVIL_0_KEY,
    };
    const deps = createDefaultDeps({
      stdout: capturingWriter(),
      stderr: capturingWriter(),
      env,
    });
    expect(ensOptsFor("sepolia", deps.env).ensVersion).toBe("v2");
    expect(typeof deps.publisherFactory("sepolia", "http://127.0.0.1:1").publish).toBe("function");
    expect(typeof deps.resolverFactory("sepolia", "http://127.0.0.1:1").resolve).toBe("function");
  });

  it("ENSPACK_ENS_VERSION env is visible to factories through deps.env", () => {
    const env: NodeJS.ProcessEnv = {
      SEPOLIA_RPC_URL: "http://127.0.0.1:1",
      ENSPACK_ENS_VERSION: "v1",
    };
    const deps = createDefaultDeps({
      stdout: capturingWriter(),
      stderr: capturingWriter(),
      env,
    });
    expect(ensVersionFor("sepolia", deps.env)).toBe("v1");
    expect(ensOptsFor("sepolia", deps.env).ensVersion).toBe("v1");
  });

  it("applyEnsVersionFlag writes ENSPACK_ENS_VERSION so sepolia becomes v1", () => {
    const env: NodeJS.ProcessEnv = {};
    applyEnsVersionFlag(env, "v1");
    expect(ensOptsFor("sepolia", env).ensVersion).toBe("v1");
    applyEnsVersionFlag(env, "v2");
    expect(ensOptsFor("sepolia", env).ensVersion).toBe("v2");
    applyEnsVersionFlag(env, undefined);
    expect(env.ENSPACK_ENS_VERSION).toBe("v2");
  });

  it("applyEnsVersionFlag rejects values other than v1|v2", () => {
    expect(() => applyEnsVersionFlag({}, "v3")).toThrow(/must be v1 or v2/);
  });
});
