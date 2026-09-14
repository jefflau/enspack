import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import {
  type Address,
  createPublicClient,
  custom,
  encodeFunctionResult,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contenthashResolverAbi, textResolverAbi } from "../src/ens/abis.js";
import type { NameStateV2 } from "../src/ens/v2/publisher-support.js";
import { REGISTRY_ROLES, RESOLVER_RECORD_ROLES } from "../src/ens/v2/publisher-support.js";
import {
  EnspackError,
  canonicalJson,
  createPublisher,
  manifestCid,
  validateManifest,
} from "../src/index.js";
import { createPublisherV2 } from "../src/publisher-v2.js";
import type { Manifest } from "../src/types.js";
import { PUBLISHER_NAME, tinyManifest } from "./helpers/tiny-manifest.js";

const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_1_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ACCOUNT0 = privateKeyToAccount(ANVIL_0_KEY);
const ACCOUNT1 = privateKeyToAccount(ANVIL_1_KEY);

const PARENT = "0x1111111111111111111111111111111111111111" as Address;
const PUB_REGISTRY = "0x2222222222222222222222222222222222222222" as Address;
const PUB_RESOLVER = "0x3333333333333333333333333333333333333333" as Address;

const nameStateV2 = vi.hoisted(() => vi.fn());
const findExactRegistry = vi.hoisted(() => vi.fn());
const hasRolesV2 = vi.hoisted(() => vi.fn());
const hasRootRolesV2 = vi.hoisted(() => vi.fn());

vi.mock("../src/ens/v2/publisher-support.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ens/v2/publisher-support.js")>();
  return {
    ...actual,
    nameStateV2,
    findExactRegistry,
    hasRolesV2,
    hasRootRolesV2,
  };
});

function emptyState(name: string): NameStateV2 {
  const label = name.split(".")[0] ?? name;
  return {
    name,
    label,
    parentRegistry: PARENT,
    tokenIdOrLabelId: 0n,
    owner: zeroAddress,
    expiry: 0n,
    resolver: zeroAddress,
    subregistry: zeroAddress,
    status: 0,
  };
}

function ownedPublisher(opts?: Partial<NameStateV2>): NameStateV2 {
  return {
    name: PUBLISHER_NAME,
    label: "enspack-test",
    parentRegistry: PARENT,
    tokenIdOrLabelId: 0n,
    owner: ACCOUNT0.address,
    expiry: 2_000_000_000n,
    resolver: PUB_RESOLVER,
    subregistry: PUB_REGISTRY,
    status: 2,
    ...opts,
  };
}

function mockClient() {
  return createPublicClient({
    chain: sepolia,
    transport: custom({
      async request({ method, params }) {
        if (method === "eth_chainId") {
          return `0x${sepolia.id.toString(16)}`;
        }
        if (method === "eth_estimateGas") {
          return "0x5208";
        }
        if (method === "eth_call") {
          const data = (params as [{ data?: string }] | undefined)?.[0]?.data ?? "0x";
          const selector = data.slice(0, 10).toLowerCase();
          if (selector === "0xbc1c58d1") {
            return encodeFunctionResult({
              abi: contenthashResolverAbi,
              functionName: "contenthash",
              result: "0x",
            });
          }
          if (selector === "0x59d1d43d") {
            return encodeFunctionResult({
              abi: textResolverAbi,
              functionName: "text",
              result: "",
            });
          }
          return "0x";
        }
        throw new Error("unit test must not hit the network");
      },
    }),
  });
}

function publisherV2() {
  return createPublisherV2({
    client: mockClient(),
    account: ACCOUNT0,
  });
}

async function publishV2(manifest: unknown, cid?: string) {
  const validated = manifest as Manifest;
  const bytes = canonicalJson(validated);
  return publisherV2().publish({
    manifest: validated,
    manifestCid: cid ?? (await manifestCid(bytes)),
    chain: "sepolia",
    dryRun: true,
  });
}

describe("createPublisherV2 validation (no chain)", () => {
  beforeEach(() => {
    nameStateV2.mockReset();
    findExactRegistry.mockReset();
    hasRolesV2.mockReset();
    hasRootRolesV2.mockReset();
    findExactRegistry.mockResolvedValue(zeroAddress);
    hasRolesV2.mockResolvedValue(true);
    hasRootRolesV2.mockResolvedValue(true);
  });

  it("throws VERIFY when the manifest fails schema/rules", async () => {
    await expect(publishV2({ spec: "nope" })).rejects.toMatchObject({
      code: "VERIFY",
    });
    await expect(publishV2({ spec: "nope" })).rejects.toBeInstanceOf(EnspackError);
  });

  it("throws PUBLISH when model is not exactly one label under publisher", async () => {
    const manifest = validateManifest(
      tinyManifest({
        model: "extra.tiny-model.enspack-test.eth",
        name: "v1-0-0.extra.tiny-model.enspack-test.eth",
      }),
    );
    await expect(publishV2(manifest)).rejects.toMatchObject({
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
    await expect(publishV2(manifest)).rejects.toMatchObject({
      code: "PUBLISH",
      message: "version label must be v1-0-0",
    });
  });

  it("throws VERIFY when manifestCid does not parse", async () => {
    const manifest = validateManifest(tinyManifest());
    await expect(publishV2(manifest, "not-a-cid")).rejects.toMatchObject({
      code: "VERIFY",
      message: "malformed CID: not-a-cid",
    });
  });

  it("throws PUBLISH when manifestCid is not raw sha2-256", async () => {
    const hash = await sha256.digest(new Uint8Array([1, 2, 3]));
    const dagPb = CID.createV1(0x70, hash).toString();
    const manifest = validateManifest(tinyManifest());
    await expect(publishV2(manifest, dagPb)).rejects.toMatchObject({
      code: "PUBLISH",
      message: expect.stringContaining("manifestCid must be raw sha2-256"),
    });
  });

  it("not the owner of the publisher name throws PUBLISH before any write", async () => {
    nameStateV2.mockImplementation(async (_c: unknown, _cfg: unknown, name: string) => {
      if (name === PUBLISHER_NAME) {
        return ownedPublisher({ owner: ACCOUNT1.address });
      }
      return emptyState(name);
    });
    const manifest = validateManifest(tinyManifest());
    await expect(publishV2(manifest)).rejects.toMatchObject({
      code: "PUBLISH",
      message: `not the owner of ${PUBLISHER_NAME}`,
    });
    expect(hasRolesV2).not.toHaveBeenCalled();
    expect(hasRootRolesV2).not.toHaveBeenCalled();
  });

  it("missing ROLE_REGISTRAR on the publisher registry throws PUBLISH with a grant hint", async () => {
    nameStateV2.mockImplementation(async (_c: unknown, _cfg: unknown, name: string) => {
      if (name === PUBLISHER_NAME) {
        return ownedPublisher();
      }
      return emptyState(name);
    });
    hasRootRolesV2.mockImplementation(
      async (_c: unknown, contract: Address, roleBitmap: bigint) => {
        if (contract === PUB_RESOLVER && roleBitmap === RESOLVER_RECORD_ROLES) {
          return true;
        }
        if (contract === PUB_REGISTRY && roleBitmap === REGISTRY_ROLES.REGISTRAR) {
          return false;
        }
        return true;
      },
    );
    const manifest = validateManifest(tinyManifest());
    await expect(publishV2(manifest)).rejects.toMatchObject({
      code: "PUBLISH",
      message: `grant ROLE_REGISTRAR on ${PUB_REGISTRY} to ${ACCOUNT0.address}`,
    });
  });

  it("plan for a fully set-up publisher publishing a new model has 4 calls and no setup", async () => {
    nameStateV2.mockImplementation(async (_c: unknown, _cfg: unknown, name: string) => {
      if (name === PUBLISHER_NAME) {
        return ownedPublisher();
      }
      return emptyState(name);
    });
    const manifest = validateManifest(tinyManifest());
    const result = await publishV2(manifest);
    expect(result.txs).toEqual([]);
    expect(result.calls).toHaveLength(4);
    expect(result.created).toEqual({ model: true, version: true });
    expect(result.setup).toEqual([]);
    expect(result.calls.every((c) => !c.description.startsWith("setup:"))).toBe(true);
    expect(result.calls[0]?.description).toMatch(/deployProxy\(UserRegistryImpl/);
    expect(result.calls[1]?.description).toMatch(/Registry\.register\(tiny-model/);
    expect(result.calls[2]?.description).toMatch(/Registry\.register\(v1-0-0/);
    expect(result.calls[3]?.description).toMatch(/multicall/);
  });

  it("plan for a first-time publisher includes setup deploys plus setSubregistry and setResolver", async () => {
    nameStateV2.mockImplementation(async (_c: unknown, _cfg: unknown, name: string) => {
      if (name === PUBLISHER_NAME) {
        return ownedPublisher({ subregistry: zeroAddress, resolver: zeroAddress });
      }
      return emptyState(name);
    });
    findExactRegistry.mockResolvedValue(zeroAddress);
    const manifest = validateManifest(tinyManifest());
    const result = await publishV2(manifest);
    expect(result.created).toEqual({ model: true, version: true });
    const setup = result.calls.filter((c) => c.description.startsWith("setup:"));
    expect(setup.length).toBeGreaterThanOrEqual(4);
    const text = setup.map((c) => c.description).join("\n");
    expect(text).toMatch(/deployProxy\(UserRegistryImpl/);
    expect(text).toMatch(/setSubregistry/);
    expect(text).toMatch(/deployProxy\(PermissionedResolverImpl/);
    expect(text).toMatch(/setResolver/);
    expect(result.setup).toHaveLength(setup.length);
  });

  it("createPublisher with ensVersion v2 dispatches to the v2 path", async () => {
    nameStateV2.mockImplementation(async (_c: unknown, _cfg: unknown, name: string) => {
      if (name === PUBLISHER_NAME) {
        return ownedPublisher({ owner: ACCOUNT1.address });
      }
      return emptyState(name);
    });
    const manifest = validateManifest(tinyManifest());
    const cid = await manifestCid(canonicalJson(manifest));
    const pub = createPublisher({
      client: mockClient(),
      account: ACCOUNT0,
      ensVersion: "v2",
    });
    await expect(
      pub.publish({
        manifest,
        manifestCid: cid,
        chain: "sepolia",
        dryRun: true,
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH",
      message: `not the owner of ${PUBLISHER_NAME}`,
    });
  });
});
