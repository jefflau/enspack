import type { ChildProcess } from "node:child_process";
import { http, type Address, createPublicClient, encodeFunctionData } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicResolverWriteAbi } from "../../src/ens/abis.js";
import {
  EnspackError,
  SPEC_STRING,
  TEXT_KEYS,
  canonicalJson,
  createResolver,
  encodeIpfsContenthash,
  manifestCid,
  namehashOf,
  validateManifest,
} from "../../src/index.js";
import {
  MAGNET,
  MODEL_NAME,
  PUBLISHER_NAME,
  VERSION_NAME,
  tinyManifest,
} from "../helpers/tiny-manifest.js";
import {
  anvilAvailable,
  anvilBin,
  killPid,
  provisionPublisherName,
  setSubnode,
  startAnvil,
} from "./helpers.js";

const MAGNET_ONLY_NAME = "magnet-only.enspack-test.eth";
const EMPTY_NAME = "empty-records.enspack-test.eth";
const UNREGISTERED = "child.unregistered-parent-zzx.eth";

describe.skipIf(!anvilAvailable)("resolver anvil fork", { timeout: 180_000 }, () => {
  let proc: ChildProcess | undefined;
  let rpcUrl: string;
  let account0: PrivateKeyAccount;
  let manifestBytes: Uint8Array;
  let cid: string;
  let publicResolver: Address;

  beforeAll(async () => {
    if (anvilBin === null) {
      return;
    }
    const started = await startAnvil(anvilBin);
    proc = started.proc;
    rpcUrl = started.url;

    const provisioned = await provisionPublisherName(rpcUrl);
    account0 = provisioned.account0;
    publicResolver = provisioned.publicResolver;
    const { publicClient, wallet0 } = provisioned;

    await setSubnode(
      wallet0,
      publicClient,
      account0,
      PUBLISHER_NAME,
      "tiny-model",
      account0.address,
      publicResolver,
    );
    await setSubnode(
      wallet0,
      publicClient,
      account0,
      MODEL_NAME,
      "v1-0-0",
      account0.address,
      publicResolver,
    );
    await setSubnode(
      wallet0,
      publicClient,
      account0,
      PUBLISHER_NAME,
      "magnet-only",
      account0.address,
      publicResolver,
    );
    await setSubnode(
      wallet0,
      publicClient,
      account0,
      PUBLISHER_NAME,
      "empty-records",
      account0.address,
      publicResolver,
    );

    const manifest = validateManifest(tinyManifest());
    manifestBytes = canonicalJson(manifest);
    cid = await manifestCid(manifestBytes);
    const contenthash = encodeIpfsContenthash(cid);
    const versionNode = namehashOf(VERSION_NAME);
    const modelNode = namehashOf(MODEL_NAME);
    const magnetNode = namehashOf(MAGNET_ONLY_NAME);

    const calls = [
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setContenthash",
        args: [versionNode, contenthash],
      }),
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setText",
        args: [versionNode, TEXT_KEYS.spec, SPEC_STRING],
      }),
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setText",
        args: [versionNode, TEXT_KEYS.magnet, MAGNET],
      }),
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setContenthash",
        args: [modelNode, contenthash],
      }),
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setText",
        args: [modelNode, TEXT_KEYS.spec, SPEC_STRING],
      }),
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setText",
        args: [modelNode, TEXT_KEYS.magnet, MAGNET],
      }),
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setText",
        args: [magnetNode, TEXT_KEYS.magnet, MAGNET],
      }),
    ];

    const multicallHash = await wallet0.writeContract({
      chain: mainnet,
      address: publicResolver,
      abi: publicResolverWriteAbi,
      functionName: "multicall",
      args: [calls],
    });
    const multicallReceipt = await publicClient.waitForTransactionReceipt({ hash: multicallHash });
    if (multicallReceipt.status !== "success") {
      throw new Error("resolver multicall failed");
    }
  }, 180_000);

  afterAll(() => {
    if (proc !== undefined) {
      killPid(proc);
    }
  });

  it("resolves tiny-model.enspack-test.eth@1.0.0 with a fake store", async () => {
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const resolver = createResolver({
      client,
      store: {
        async put() {
          throw new Error("unused");
        },
        async getVerified() {
          return manifestBytes;
        },
      },
    });
    const resolved = await resolver.resolve("tiny-model.enspack-test.eth@1.0.0");
    expect(resolved.name).toBe(VERSION_NAME);
    expect(resolved.cid).toBe(cid);
    expect(resolved.magnet).toBe(MAGNET);
    expect(resolved.spec).toBe(SPEC_STRING);
    expect(resolved.manifest?.name).toBe(VERSION_NAME);
    expect(resolved.manifest?.model).toBe(MODEL_NAME);
  });

  it("resolves the model name against manifest.model", async () => {
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const resolver = createResolver({
      client,
      store: {
        async put() {
          throw new Error("unused");
        },
        async getVerified() {
          return manifestBytes;
        },
      },
    });
    const resolved = await resolver.resolve(MODEL_NAME);
    expect(resolved.name).toBe(MODEL_NAME);
    expect(resolved.cid).toBe(cid);
    expect(resolved.manifest?.model).toBe(MODEL_NAME);
  });

  it("returns cid: null and the magnet when only com.enspack.magnet is set", async () => {
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const resolver = createResolver({ client });
    const resolved = await resolver.resolve(MAGNET_ONLY_NAME);
    expect(resolved.cid).toBeNull();
    expect(resolved.magnet).toBe(MAGNET);
  });

  it("throws RESOLVE for a name with a resolver but no records", async () => {
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const resolver = createResolver({ client });
    await expect(resolver.resolve(EMPTY_NAME)).rejects.toMatchObject({
      code: "RESOLVE",
      message: `${EMPTY_NAME} has no enspack records`,
    });
  });

  it("throws RESOLVE for a name under an unregistered parent", async () => {
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const resolver = createResolver({ client });
    await expect(resolver.resolve(UNREGISTERED)).rejects.toBeInstanceOf(EnspackError);
    try {
      await resolver.resolve(UNREGISTERED);
    } catch (e) {
      expect(e).toMatchObject({ code: "RESOLVE" });
    }
  });
});
