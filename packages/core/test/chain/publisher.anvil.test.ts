import type { ChildProcess } from "node:child_process";
import { http, createPublicClient, createWalletClient, namehash, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensRegistryAbi } from "../../src/ens/abis.js";
import {
  ENS_REGISTRY,
  EnspackError,
  canonicalJson,
  createPublisher,
  createResolver,
  formatPublishPlan,
  manifestCid,
  validateManifest,
} from "../../src/index.js";
import type { Manifest } from "../../src/types.js";
import {
  MODEL_NAME,
  PUBLISHER_NAME,
  VERSION_1_1_NAME,
  VERSION_NAME,
  tinyManifest,
} from "../helpers/tiny-manifest.js";
import {
  ANVIL_0_KEY,
  ANVIL_1_KEY,
  anvilAvailable,
  anvilBin,
  killPid,
  provisionPublisherName,
  startAnvil,
} from "./helpers.js";

describe.skipIf(!anvilAvailable)("publisher anvil fork", { timeout: 240_000 }, () => {
  let proc: ChildProcess | undefined;
  let rpcUrl: string;

  let bytes100: Uint8Array;
  let cid100: string;
  let manifest100: Manifest;
  let bytes110: Uint8Array;
  let cid110: string;
  let manifest110: Manifest;

  beforeAll(async () => {
    if (anvilBin === null) {
      return;
    }
    const started = await startAnvil(anvilBin);
    proc = started.proc;
    rpcUrl = started.url;
    await provisionPublisherName(rpcUrl);

    manifest100 = validateManifest(tinyManifest());
    bytes100 = canonicalJson(manifest100);
    cid100 = await manifestCid(bytes100);

    const raw110 = tinyManifest({ version: "1.1.0" });
    const previous = {
      version: "1.0.0",
      name: VERSION_NAME,
      cid: cid100,
      createdAt: "2026-09-14T00:00:00Z",
    };
    raw110.versions = [previous, ...(raw110.versions as (typeof previous)[])];
    manifest110 = validateManifest(raw110);
    bytes110 = canonicalJson(manifest110);
    cid110 = await manifestCid(bytes110);
  }, 180_000);

  afterAll(() => {
    if (proc !== undefined) {
      killPid(proc);
    }
  });

  function clients() {
    const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const account0 = privateKeyToAccount(ANVIL_0_KEY);
    const wallet0 = createWalletClient({
      account: account0,
      chain: mainnet,
      transport: http(rpcUrl),
    });
    return { publicClient, account0, wallet0 };
  }

  function fakeStore() {
    return {
      async put() {
        throw new Error("unused");
      },
      async getVerified(cid: string) {
        if (cid === cid100) {
          return bytes100;
        }
        if (cid === cid110) {
          return bytes110;
        }
        throw new Error(`unexpected cid ${cid}`);
      },
    };
  }

  async function ownerOf(name: string) {
    const { publicClient } = clients();
    return publicClient.readContract({
      address: ENS_REGISTRY,
      abi: ensRegistryAbi,
      functionName: "owner",
      args: [namehash(name)],
    });
  }

  it("publishing from an account that does not own the publisher name fails before any tx", async () => {
    const { publicClient } = clients();
    const account1 = privateKeyToAccount(ANVIL_1_KEY);
    const wallet1 = createWalletClient({
      account: account1,
      chain: mainnet,
      transport: http(rpcUrl),
    });
    const nonceBefore = await publicClient.getTransactionCount({ address: account1.address });
    const publisher = createPublisher({ client: publicClient, wallet: wallet1 });
    await expect(
      publisher.publish({
        manifest: manifest100,
        manifestCid: cid100,
        chain: "mainnet",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH",
      message: `not the owner of ${PUBLISHER_NAME}`,
    });
    expect(await publicClient.getTransactionCount({ address: account1.address })).toBe(nonceBefore);
    expect(await ownerOf(MODEL_NAME)).toBe(zeroAddress);
  });

  it("dry run of a new model returns 3 calls with gas, sends nothing, and leaves the model unowned", async () => {
    const { publicClient, account0 } = clients();
    const publisher = createPublisher({ client: publicClient, account: account0 });
    const result = await publisher.publish({
      manifest: manifest100,
      manifestCid: cid100,
      chain: "mainnet",
      dryRun: true,
    });
    expect(result.txs).toEqual([]);
    expect(result.calls).toHaveLength(3);
    expect(result.created).toEqual({ model: true, version: true });
    for (const call of result.calls) {
      expect(call.gas).toBeDefined();
      expect(call.gas !== undefined && call.gas > 0n).toBe(true);
    }
    const plan = formatPublishPlan(result.calls);
    expect(plan).toMatch(/setSubnodeRecord/);
    expect(plan).toMatch(/setSubnodeRecord[\s\S]*setSubnodeRecord/);
    expect(plan).toMatch(/multicall/);
    expect(plan).toMatch(new RegExp(ENS_REGISTRY, "i"));
    expect(await ownerOf(MODEL_NAME)).toBe(zeroAddress);
  });

  it("new model publish is exactly 3 successful transactions", async () => {
    const { publicClient, wallet0 } = clients();
    const publisher = createPublisher({ client: publicClient, wallet: wallet0 });
    const result = await publisher.publish({
      manifest: manifest100,
      manifestCid: cid100,
      chain: "mainnet",
    });
    expect(result.txs).toHaveLength(3);
    expect(result.created).toEqual({ model: true, version: true });
    for (const hash of result.txs) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
    }
  });

  it("createResolver reads back the same CID for the version name and model name after first publish", async () => {
    const { publicClient } = clients();
    const resolver = createResolver({ client: publicClient, store: fakeStore() });
    const version = await resolver.resolve(VERSION_NAME);
    const model = await resolver.resolve(MODEL_NAME);
    expect(version.cid).toBe(cid100);
    expect(model.cid).toBe(cid100);
    expect(version.manifest?.name).toBe(VERSION_NAME);
    expect(model.manifest?.model).toBe(MODEL_NAME);
  });

  it("re-running the same publish is idempotent: 0 transactions and empty calls", async () => {
    const { publicClient, wallet0 } = clients();
    const publisher = createPublisher({ client: publicClient, wallet: wallet0 });
    const nonceBefore = await publicClient.getTransactionCount({
      address: wallet0.account.address,
    });
    const result = await publisher.publish({
      manifest: manifest100,
      manifestCid: cid100,
      chain: "mainnet",
    });
    expect(result.txs).toHaveLength(0);
    expect(result.calls).toHaveLength(0);
    expect(result.created).toEqual({ model: false, version: false });
    expect(await publicClient.getTransactionCount({ address: wallet0.account.address })).toBe(
      nonceBefore,
    );
  });

  it("new version on the same model is exactly 2 successful transactions", async () => {
    const { publicClient, wallet0 } = clients();
    const publisher = createPublisher({ client: publicClient, wallet: wallet0 });
    const result = await publisher.publish({
      manifest: manifest110,
      manifestCid: cid110,
      chain: "mainnet",
    });
    expect(result.txs).toHaveLength(2);
    expect(result.created).toEqual({ model: false, version: true });
    for (const hash of result.txs) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
    }
  });

  it("createResolver reads back the 1.1.0 CID for the new version name and the model name", async () => {
    const { publicClient } = clients();
    const resolver = createResolver({ client: publicClient, store: fakeStore() });
    const version = await resolver.resolve(VERSION_1_1_NAME);
    const model = await resolver.resolve(MODEL_NAME);
    expect(version.cid).toBe(cid110);
    expect(model.cid).toBe(cid110);
    expect(version.manifest?.name).toBe(VERSION_1_1_NAME);
    expect(model.manifest?.model).toBe(MODEL_NAME);
  });

  it("repointing a version to a different CID throws PUBLISH and sends no transaction", async () => {
    const { publicClient, wallet0 } = clients();
    const publisher = createPublisher({ client: publicClient, wallet: wallet0 });
    const repoint = validateManifest(tinyManifest({ createdAt: "2026-09-14T00:00:01Z" }));
    const otherCid = await manifestCid(canonicalJson(repoint));
    expect(otherCid).not.toBe(cid100);
    const nonceBefore = await publicClient.getTransactionCount({
      address: wallet0.account.address,
    });
    await expect(
      publisher.publish({
        manifest: repoint,
        manifestCid: otherCid,
        chain: "mainnet",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH",
      message: `version name already points at ${cid100}; version names are immutable`,
    });
    expect(await publicClient.getTransactionCount({ address: wallet0.account.address })).toBe(
      nonceBefore,
    );
    await expect(
      publisher.publish({
        manifest: repoint,
        manifestCid: otherCid,
        chain: "mainnet",
      }),
    ).rejects.toBeInstanceOf(EnspackError);
  });
});
