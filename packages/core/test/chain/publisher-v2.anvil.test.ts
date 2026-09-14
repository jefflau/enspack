import type { ChildProcess } from "node:child_process";
import { createPublicClient, createWalletClient, http, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeIpfsContenthash } from "../../src/ens/contenthash.js";
import { ensV2ConfigFor } from "../../src/ens/v2/config.js";
import { nameStateV2 } from "../../src/ens/v2/discovery.js";
import { permissionedResolverAbi } from "../../src/ens/v2/abis.js";
import { NAME_OWNER_ROLES, REGISTRY_ROLES } from "../../src/ens/v2/roles.js";
import {
  EnspackError,
  canonicalJson,
  createPublisher,
  createResolver,
  formatPublishPlan,
  manifestCid,
  namehashOf,
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
  provisionV2Name,
  registerSubname,
  startSepoliaAnvil,
} from "./v2-helpers.js";

const ANVIL_2_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

describe.skipIf(!anvilAvailable)("publisher v2 anvil sepolia fork", { timeout: 300_000 }, () => {
  let proc: ChildProcess | undefined;
  let rpcUrl: string;
  let cfg: ReturnType<typeof ensV2ConfigFor>;
  let rootUserRegistry: `0x${string}`;
  let provisionedExpiry: bigint;

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
    const started = await startSepoliaAnvil(anvilBin);
    proc = started.proc;
    rpcUrl = started.url;
    cfg = ensV2ConfigFor("sepolia");
    const { publicClient, wallet0 } = clients();
    const provisioned = await provisionV2Name(publicClient, wallet0, cfg, { rpcUrl });
    rootUserRegistry = provisioned.rootUserRegistry;
    provisionedExpiry = provisioned.expiry;

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
  }, 240_000);

  afterAll(() => {
    if (proc !== undefined) {
      killPid(proc);
    }
  });

  function clients() {
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const account0 = privateKeyToAccount(ANVIL_0_KEY);
    const wallet0 = createWalletClient({
      account: account0,
      chain: sepolia,
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

  it("publishing from an account that does not own the publisher name fails before any tx", async () => {
    const { publicClient } = clients();
    const account1 = privateKeyToAccount(ANVIL_1_KEY);
    const wallet1 = createWalletClient({
      account: account1,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    const nonceBefore = await publicClient.getTransactionCount({ address: account1.address });
    const publisher = createPublisher({
      client: publicClient,
      wallet: wallet1,
      ensVersion: "v2",
    });
    await expect(
      publisher.publish({
        manifest: manifest100,
        manifestCid: cid100,
        chain: "sepolia",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH",
      message: `not the owner of ${PUBLISHER_NAME}`,
    });
    expect(await publicClient.getTransactionCount({ address: account1.address })).toBe(nonceBefore);
  });

  it("dry run of a new model returns 4 calls, sends nothing, and leaves state unchanged", async () => {
    const { publicClient, account0 } = clients();
    const before = await nameStateV2(publicClient, cfg, MODEL_NAME);
    const publisher = createPublisher({
      client: publicClient,
      account: account0,
      ensVersion: "v2",
    });
    const result = await publisher.publish({
      manifest: manifest100,
      manifestCid: cid100,
      chain: "sepolia",
      dryRun: true,
    });
    expect(result.txs).toEqual([]);
    expect(result.calls).toHaveLength(4);
    expect(result.created).toEqual({ model: true, version: true });
    const plan = formatPublishPlan(result.calls);
    expect(plan).toMatch(/deployProxy/);
    expect(plan).toMatch(/register/);
    expect(plan).toMatch(/multicall/);
    expect(plan).toMatch(/\(gas after deploy\)/);
    const after = await nameStateV2(publicClient, cfg, MODEL_NAME);
    expect(after.owner).toBe(before.owner);
    expect(after.subregistry).toBe(before.subregistry);
  });

  it("new model publish is exactly 4 successful transactions", async () => {
    const { publicClient, wallet0 } = clients();
    const publisher = createPublisher({
      client: publicClient,
      wallet: wallet0,
      ensVersion: "v2",
    });
    const result = await publisher.publish({
      manifest: manifest100,
      manifestCid: cid100,
      chain: "sepolia",
    });
    expect(result.txs).toHaveLength(4);
    expect(result.created).toEqual({ model: true, version: true });
    for (const hash of result.txs) {
      expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
    }
    const modelState = await nameStateV2(publicClient, cfg, MODEL_NAME);
    expect(modelState.subregistry).not.toBe(zeroAddress);
    expect(modelState.owner.toLowerCase()).toBe(wallet0.account.address.toLowerCase());
  });

  it("createResolver reads back the same CID for version and model after first publish", async () => {
    const { publicClient } = clients();
    const pubState = await nameStateV2(publicClient, cfg, PUBLISHER_NAME);
    const encoded = encodeIpfsContenthash(cid100);
    const versionHash = await publicClient.readContract({
      address: pubState.resolver,
      abi: permissionedResolverAbi,
      functionName: "contenthash",
      args: [namehashOf(VERSION_NAME)],
    });
    const modelHash = await publicClient.readContract({
      address: pubState.resolver,
      abi: permissionedResolverAbi,
      functionName: "contenthash",
      args: [namehashOf(MODEL_NAME)],
    });
    expect(versionHash).toBe(encoded);
    expect(modelHash).toBe(encoded);
    const resolver = createResolver({
      client: publicClient,
      chain: "sepolia",
      ensVersion: "v2",
      store: fakeStore(),
    });
    const version = await resolver.resolve(VERSION_NAME);
    const model = await resolver.resolve(MODEL_NAME);
    expect(version.cid).toBe(cid100);
    expect(model.cid).toBe(cid100);
  });

  it("re-running the same publish is idempotent: 0 transactions and empty calls", async () => {
    const { publicClient, wallet0 } = clients();
    const publisher = createPublisher({
      client: publicClient,
      wallet: wallet0,
      ensVersion: "v2",
    });
    const nonceBefore = await publicClient.getTransactionCount({
      address: wallet0.account.address,
    });
    const result = await publisher.publish({
      manifest: manifest100,
      manifestCid: cid100,
      chain: "sepolia",
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
    const publisher = createPublisher({
      client: publicClient,
      wallet: wallet0,
      ensVersion: "v2",
    });
    const result = await publisher.publish({
      manifest: manifest110,
      manifestCid: cid110,
      chain: "sepolia",
    });
    expect(result.txs).toHaveLength(2);
    expect(result.created).toEqual({ model: false, version: true });
    for (const hash of result.txs) {
      expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
    }
  });

  it("createResolver reads back the 1.1.0 CID for the new version name and the model name", async () => {
    const { publicClient } = clients();
    const resolver = createResolver({
      client: publicClient,
      chain: "sepolia",
      ensVersion: "v2",
      store: fakeStore(),
    });
    const version = await resolver.resolve(VERSION_1_1_NAME);
    const model = await resolver.resolve(MODEL_NAME);
    expect(version.cid).toBe(cid110);
    expect(model.cid).toBe(cid110);
  });

  it("repointing a version to a different CID throws PUBLISH and sends no transaction", async () => {
    const { publicClient, wallet0 } = clients();
    const publisher = createPublisher({
      client: publicClient,
      wallet: wallet0,
      ensVersion: "v2",
    });
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
        chain: "sepolia",
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
        chain: "sepolia",
      }),
    ).rejects.toBeInstanceOf(EnspackError);
  });

  it("first-time publisher setup deploys registry and resolver then publishes a model", async () => {
    const { publicClient, wallet0 } = clients();
    await registerSubname(
      wallet0,
      publicClient,
      rootUserRegistry,
      "fresh-pub",
      wallet0.account.address,
      zeroAddress,
      zeroAddress,
      NAME_OWNER_ROLES,
      provisionedExpiry,
    );
    const freshPublisher = "fresh-pub.enspack-test.eth";
    const freshManifest = validateManifest(
      tinyManifest({
        publisher: freshPublisher,
        model: "tiny-model.fresh-pub.enspack-test.eth",
      }),
    );
    const freshCid = await manifestCid(canonicalJson(freshManifest));
    const publisher = createPublisher({
      client: publicClient,
      wallet: wallet0,
      ensVersion: "v2",
    });
    const dry = await publisher.publish({
      manifest: freshManifest,
      manifestCid: freshCid,
      chain: "sepolia",
      dryRun: true,
    });
    const plan = formatPublishPlan(dry.calls);
    expect(plan).toMatch(/setup:.*deployProxy\(UserRegistryImpl/);
    expect(plan).toMatch(/setup:.*setSubregistry/);
    expect(plan).toMatch(/setup:.*deployProxy\(PermissionedResolverImpl/);
    expect(plan).toMatch(/setup:.*setResolver/);
    const live = await publisher.publish({
      manifest: freshManifest,
      manifestCid: freshCid,
      chain: "sepolia",
    });
    expect(live.txs.length).toBeGreaterThan(4);
    for (const hash of live.txs) {
      expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
    }
    const after = await nameStateV2(publicClient, cfg, freshPublisher);
    expect(after.subregistry).not.toBe(zeroAddress);
    expect(after.resolver).not.toBe(zeroAddress);
  });

  it("account lacking ROLE_SET_RESOLVER gets PUBLISH naming the missing role", async () => {
    const { publicClient, wallet0 } = clients();
    const account2 = privateKeyToAccount(ANVIL_2_KEY);
    await registerSubname(
      wallet0,
      publicClient,
      rootUserRegistry,
      "no-set-resolver",
      account2.address,
      zeroAddress,
      zeroAddress,
      NAME_OWNER_ROLES & ~REGISTRY_ROLES.SET_RESOLVER,
      provisionedExpiry,
    );
    const wallet2 = createWalletClient({
      account: account2,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    const nonceBefore = await publicClient.getTransactionCount({ address: account2.address });
    const publisherName = "no-set-resolver.enspack-test.eth";
    const manifest = validateManifest(
      tinyManifest({
        publisher: publisherName,
        model: `tiny-model.${publisherName}`,
      }),
    );
    const cid = await manifestCid(canonicalJson(manifest));
    const publisher = createPublisher({
      client: publicClient,
      wallet: wallet2,
      ensVersion: "v2",
    });
    await expect(
      publisher.publish({
        manifest,
        manifestCid: cid,
        chain: "sepolia",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH",
      message: expect.stringMatching(/ROLE_SET_RESOLVER/),
    });
    expect(await publicClient.getTransactionCount({ address: account2.address })).toBe(nonceBefore);
  });
});
