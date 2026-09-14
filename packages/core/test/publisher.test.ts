import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { createPublicClient, custom } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  EnspackError,
  canonicalJson,
  createPublisher,
  manifestCid,
  validateManifest,
} from "../src/index.js";
import type { Manifest } from "../src/types.js";
import { MODEL_NAME, PUBLISHER_NAME, VERSION_NAME, tinyManifest } from "./helpers/tiny-manifest.js";

const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function mockClient() {
  return createPublicClient({
    chain: mainnet,
    transport: custom({
      async request() {
        throw new Error("unit test must not hit the network");
      },
    }),
  });
}

function publisher() {
  return createPublisher({
    client: mockClient(),
    account: privateKeyToAccount(ANVIL_0_KEY),
  });
}

async function publish(manifest: unknown, cid?: string) {
  const validated = manifest as Manifest;
  const bytes = canonicalJson(validated);
  return publisher().publish({
    manifest: validated,
    manifestCid: cid ?? (await manifestCid(bytes)),
    chain: "mainnet",
    dryRun: true,
  });
}

describe("createPublisher validation (no chain)", () => {
  it("throws VERIFY when the manifest fails schema/rules", async () => {
    await expect(publish({ spec: "nope" })).rejects.toMatchObject({
      code: "VERIFY",
    });
    await expect(publish({ spec: "nope" })).rejects.toBeInstanceOf(EnspackError);
  });

  it("throws PUBLISH when model is not exactly one label under publisher", async () => {
    const manifest = validateManifest(
      tinyManifest({
        model: "extra.tiny-model.enspack-test.eth",
        name: "v1-0-0.extra.tiny-model.enspack-test.eth",
      }),
    );
    await expect(publish(manifest)).rejects.toMatchObject({
      code: "PUBLISH",
      message: "extra.tiny-model.enspack-test.eth must be exactly one label under enspack-test.eth",
    });
  });

  it("throws PUBLISH when the version label does not match versionLabel(version)", async () => {
    const manifest = validateManifest(
      tinyManifest({
        name: "v9-9-9.tiny-model.enspack-test.eth",
      }),
    );
    await expect(publish(manifest)).rejects.toMatchObject({
      code: "PUBLISH",
      message: "version label must be v1-0-0",
    });
  });

  it("throws VERIFY when manifestCid does not parse", async () => {
    const manifest = validateManifest(tinyManifest());
    await expect(publish(manifest, "not-a-cid")).rejects.toMatchObject({
      code: "VERIFY",
      message: "malformed CID: not-a-cid",
    });
  });

  it("throws PUBLISH when manifestCid is not raw sha2-256", async () => {
    const hash = await sha256.digest(new Uint8Array([1, 2, 3]));
    const dagPb = CID.createV1(0x70, hash).toString();
    const manifest = validateManifest(tinyManifest());
    await expect(publish(manifest, dagPb)).rejects.toMatchObject({
      code: "PUBLISH",
      message: expect.stringContaining("manifestCid must be raw sha2-256"),
    });
  });

  it("throws VERIFY when distribution.magnet fails schema (MAGNET_RE is checked after)", async () => {
    await expect(
      publish(
        tinyManifest({
          magnet: "https://example.com/not-a-magnet",
        }),
      ),
    ).rejects.toMatchObject({
      code: "VERIFY",
    });
  });

  it("passes step-1 validation then fails closed on chain reads with a mock client", async () => {
    const manifest = validateManifest(tinyManifest());
    const cid = await manifestCid(canonicalJson(manifest));
    expect(manifest.model).toBe(MODEL_NAME);
    expect(manifest.name).toBe(VERSION_NAME);
    expect(manifest.publisher).toBe(PUBLISHER_NAME);
    expect(cid.startsWith("bafkrei")).toBe(true);
    await expect(
      publisher().publish({
        manifest,
        manifestCid: cid,
        chain: "mainnet",
        dryRun: true,
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH",
      message: `failed to read owner of ${PUBLISHER_NAME}`,
    });
  });
});
