import { describe, expect, it } from "vitest";
import type { Manifest } from "@enspack/core";
import { createDefaultDeps } from "../src/defaults.js";
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
