import type { ChildProcess } from "node:child_process";
import { http, type Address, createPublicClient, createWalletClient, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NAME_OWNER_ROLES } from "../../src/ens/v2/roles.js";
import {
  EnspackError,
  SPEC_STRING,
  TEXT_KEYS,
  canonicalJson,
  createResolver,
  encodeIpfsContenthash,
  ensV2ConfigFor,
  manifestCid,
  nameStateV2,
  namehashOf,
  validateManifest,
} from "../../src/index.js";
import { MAGNET, MODEL_NAME, VERSION_NAME, tinyManifest } from "../helpers/tiny-manifest.js";
import {
  ANVIL_0_KEY,
  anvilAvailable,
  anvilBin,
  deployUserRegistry,
  killPid,
  provisionV2Name,
  registerSubname,
  setRecords,
  startSepoliaAnvil,
} from "./v2-helpers.js";

const MAGNET_ONLY_NAME = "magnet-only.enspack-test.eth";
const EMPTY_NAME = "empty-records.enspack-test.eth";
const UNREGISTERED = "child.unregistered-parent-zzx.eth";

describe.skipIf(!anvilAvailable)("resolver ENSv2 sepolia fork", { timeout: 240_000 }, () => {
  let proc: ChildProcess | undefined;
  let rpcUrl: string;
  let manifestBytes: Uint8Array;
  let cid: string;
  let resolverAddr: Address;
  let modelRegistry: Address;
  let owner: Address;

  beforeAll(async () => {
    if (anvilBin === null) {
      return;
    }
    const started = await startSepoliaAnvil(anvilBin);
    proc = started.proc;
    rpcUrl = started.url;

    const cfg = ensV2ConfigFor("sepolia");
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const account0 = privateKeyToAccount(ANVIL_0_KEY);
    owner = account0.address;
    const wallet0 = createWalletClient({
      account: account0,
      chain: sepolia,
      transport: http(rpcUrl),
    });

    const provisioned = await provisionV2Name(publicClient, wallet0, cfg, {
      label: "enspack-test",
      rpcUrl,
    });
    resolverAddr = provisioned.resolver;
    const { rootUserRegistry, expiry } = provisioned;

    modelRegistry = await deployUserRegistry(
      wallet0,
      publicClient,
      cfg,
      owner,
      `model-registry:${MODEL_NAME}`,
    );

    await registerSubname(
      wallet0,
      publicClient,
      rootUserRegistry,
      "tiny-model",
      owner,
      modelRegistry,
      resolverAddr,
      NAME_OWNER_ROLES,
      expiry,
    );
    await registerSubname(
      wallet0,
      publicClient,
      modelRegistry,
      "v1-0-0",
      owner,
      zeroAddress,
      resolverAddr,
      NAME_OWNER_ROLES,
      expiry,
    );
    await registerSubname(
      wallet0,
      publicClient,
      rootUserRegistry,
      "magnet-only",
      owner,
      zeroAddress,
      resolverAddr,
      NAME_OWNER_ROLES,
      expiry,
    );
    await registerSubname(
      wallet0,
      publicClient,
      rootUserRegistry,
      "empty-records",
      owner,
      zeroAddress,
      resolverAddr,
      NAME_OWNER_ROLES,
      expiry,
    );

    const manifest = validateManifest(tinyManifest());
    manifestBytes = canonicalJson(manifest);
    cid = await manifestCid(manifestBytes);
    const contenthash = encodeIpfsContenthash(cid);
    const texts = { [TEXT_KEYS.spec]: SPEC_STRING, [TEXT_KEYS.magnet]: MAGNET };

    await setRecords(wallet0, publicClient, resolverAddr, namehashOf(VERSION_NAME), {
      contenthash,
      texts,
    });
    await setRecords(wallet0, publicClient, resolverAddr, namehashOf(MODEL_NAME), {
      contenthash,
      texts,
    });
    await setRecords(wallet0, publicClient, resolverAddr, namehashOf(MAGNET_ONLY_NAME), {
      texts: { [TEXT_KEYS.magnet]: MAGNET },
    });
  }, 240_000);

  afterAll(() => {
    if (proc !== undefined) {
      killPid(proc);
    }
  });

  function client() {
    return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  }

  function fakeStore() {
    return {
      async put() {
        throw new Error("unused");
      },
      async getVerified() {
        return manifestBytes;
      },
    };
  }

  it("resolves tiny-model.enspack-test.eth@1.0.0 with a fake store", async () => {
    const resolved = await createResolver({
      client: client(),
      chain: "sepolia",
      ensVersion: "v2",
      store: fakeStore(),
    }).resolve("tiny-model.enspack-test.eth@1.0.0");
    expect(resolved.name).toBe(VERSION_NAME);
    expect(resolved.cid).toBe(cid);
    expect(resolved.magnet).toBe(MAGNET);
    expect(resolved.spec).toBe(SPEC_STRING);
    expect(resolved.manifest?.name).toBe(VERSION_NAME);
    expect(resolved.manifest?.model).toBe(MODEL_NAME);
  });

  it("resolves the model name against manifest.model", async () => {
    const resolved = await createResolver({
      client: client(),
      chain: "sepolia",
      ensVersion: "v2",
      store: fakeStore(),
    }).resolve(MODEL_NAME);
    expect(resolved.name).toBe(MODEL_NAME);
    expect(resolved.cid).toBe(cid);
    expect(resolved.manifest?.model).toBe(MODEL_NAME);
  });

  it("returns cid: null and the magnet when only com.enspack.magnet is set", async () => {
    const resolved = await createResolver({
      client: client(),
      chain: "sepolia",
      ensVersion: "v2",
    }).resolve(MAGNET_ONLY_NAME);
    expect(resolved.cid).toBeNull();
    expect(resolved.magnet).toBe(MAGNET);
  });

  it("throws RESOLVE for a name with a resolver but no records", async () => {
    await expect(
      createResolver({ client: client(), chain: "sepolia", ensVersion: "v2" }).resolve(EMPTY_NAME),
    ).rejects.toMatchObject({
      code: "RESOLVE",
      message: `${EMPTY_NAME} has no enspack records`,
    });
  });

  it("throws RESOLVE for an unregistered label", async () => {
    const r = createResolver({ client: client(), chain: "sepolia", ensVersion: "v2" });
    await expect(r.resolve(UNREGISTERED)).rejects.toBeInstanceOf(EnspackError);
    try {
      await r.resolve(UNREGISTERED);
    } catch (e) {
      expect(e).toMatchObject({ code: "RESOLVE" });
    }
  });

  it("nameStateV2 for the model has owner, subregistry, and shared resolver", async () => {
    const state = await nameStateV2(client(), ensV2ConfigFor("sepolia"), MODEL_NAME);
    expect(state.owner.toLowerCase()).toBe(owner.toLowerCase());
    expect(state.subregistry.toLowerCase()).toBe(modelRegistry.toLowerCase());
    expect(state.resolver.toLowerCase()).toBe(resolverAddr.toLowerCase());
    expect(state.name).toBe(MODEL_NAME);
    expect(state.label).toBe("tiny-model");
    expect(state.missingFrom).toBeUndefined();
  });
});
