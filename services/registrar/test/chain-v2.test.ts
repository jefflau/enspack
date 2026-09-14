import {
  type EnsV2Config,
  NAME_OWNER_ROLES,
  SPEC_STRING,
  TEXT_KEYS,
  hasRootRolesV2,
  labelId,
  nameStateV2,
  namehashOf,
  permissionedResolverAbi,
  registryV2Abi,
} from "@enspack/core";
import { type Address, type Hex, decodeFunctionData, zeroAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLabelTakenOnChainV2, issuePublisherSubnameV2 } from "../src/chain-v2.js";
import { createRegistrarChain, issuePublisherSubname, readOperatorApproval } from "../src/chain.js";
import {
  CLAIMANT,
  FAKE_RESOLVER,
  FAKE_ROOT_REGISTRY,
  FAKE_V2_CONFIG,
  OPERATOR,
} from "./helpers.js";

vi.mock("@enspack/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enspack/core")>();
  return {
    ...actual,
    nameStateV2: vi.fn(),
    hasRootRolesV2: vi.fn(),
  };
});

const ROOT_NAME = "enspack.eth";
const EXPIRY = 2_000_000_000n;

type Sent = { to: Address; data: Hex };

function rootState(overrides?: {
  subregistry?: Address;
  resolver?: Address;
  expiry?: bigint;
  owner?: Address;
}): {
  name: string;
  label: string;
  parentRegistry: Address;
  tokenIdOrLabelId: bigint;
  owner: Address;
  expiry: bigint;
  resolver: Address;
  subregistry: Address;
  status: number;
} {
  return {
    name: ROOT_NAME,
    label: "enspack",
    parentRegistry: "0x2222222222222222222222222222222222222222",
    tokenIdOrLabelId: 0n,
    owner: OPERATOR,
    expiry: overrides?.expiry ?? EXPIRY,
    resolver: overrides?.resolver ?? FAKE_RESOLVER,
    subregistry: overrides?.subregistry ?? FAKE_ROOT_REGISTRY,
    status: 2,
  };
}

function mockNameState(overrides?: Parameters<typeof rootState>[0]): ReturnType<typeof rootState> {
  const state = rootState(overrides);
  vi.mocked(nameStateV2).mockResolvedValue(state as never);
  return state;
}

function makeChain(opts?: {
  owner?: Address;
  status?: number;
  texts?: { hf: string; spec: string };
  sent?: Sent[];
}): ReturnType<typeof createRegistrarChain> & { sent: Sent[] } {
  const sent = opts?.sent ?? [];
  let n = 0;
  const owner = opts?.owner ?? zeroAddress;
  const status = opts?.status ?? 0;
  const texts = opts?.texts ?? { hf: "", spec: "" };
  const client = {
    chain: undefined,
    async readContract({
      functionName,
      args,
    }: {
      functionName: string;
      args?: readonly unknown[];
    }) {
      if (functionName === "getOwner") {
        return owner;
      }
      if (functionName === "getStatus") {
        return status;
      }
      if (functionName === "text") {
        const key = args?.[1];
        if (key === TEXT_KEYS.hf) {
          return texts.hf;
        }
        if (key === TEXT_KEYS.spec) {
          return texts.spec;
        }
        return "";
      }
      throw new Error(`unexpected readContract ${functionName}`);
    },
    async estimateGas() {
      return 80_000n;
    },
    async waitForTransactionReceipt({ hash }: { hash: Hex }) {
      return { status: "success" as const, transactionHash: hash };
    },
    async getBalance() {
      return 10n ** 18n;
    },
  };
  const wallet = {
    account: { address: OPERATOR },
    async sendTransaction(req: { to: Address; data: Hex }) {
      sent.push({ to: req.to, data: req.data });
      n += 1;
      return `0x${n.toString(16).padStart(64, "0")}` as Hex;
    },
  };
  const chain = createRegistrarChain({
    client: client as never,
    wallet: wallet as never,
    operator: OPERATOR,
    ensVersion: "v2",
    ensV2: FAKE_V2_CONFIG as EnsV2Config,
    rootName: ROOT_NAME,
  });
  return Object.assign(chain, { sent });
}

afterEach(() => {
  vi.mocked(nameStateV2).mockReset();
  vi.mocked(hasRootRolesV2).mockReset();
});

describe("isLabelTakenOnChainV2", () => {
  it("throws ROOT_REGISTRY_MISSING when the root subregistry is zero", async () => {
    mockNameState({ subregistry: zeroAddress });
    const chain = makeChain();
    await expect(isLabelTakenOnChainV2(chain, "alice")).rejects.toMatchObject({
      status: 503,
      code: "ROOT_REGISTRY_MISSING",
    });
  });

  it("is taken when getOwner(labelId) is non-zero", async () => {
    mockNameState();
    const chain = makeChain({ owner: CLAIMANT.address, status: 2 });
    expect(await isLabelTakenOnChainV2(chain, "alice")).toBe(true);
  });

  it("is taken when status is RESERVED even if owner is zero", async () => {
    mockNameState();
    const chain = makeChain({ owner: zeroAddress, status: 1 });
    expect(await isLabelTakenOnChainV2(chain, "alice")).toBe(true);
  });

  it("is available when owner is zero and status is AVAILABLE", async () => {
    mockNameState();
    const chain = makeChain({ owner: zeroAddress, status: 0 });
    expect(await isLabelTakenOnChainV2(chain, "alice")).toBe(false);
  });
});

describe("readOperatorApproval v2", () => {
  it("exposes both role flags plus rootRegistry and resolver", async () => {
    mockNameState();
    vi.mocked(hasRootRolesV2).mockResolvedValue(true);
    const chain = makeChain();
    const approval = await readOperatorApproval(chain);
    expect(approval.approved).toBe(true);
    expect(approval.registrarApproved).toBe(true);
    expect(approval.resolverApproved).toBe(true);
    expect(approval.rootRegistry).toBe(FAKE_ROOT_REGISTRY);
    expect(approval.resolver).toBe(FAKE_RESOLVER);
    expect(vi.mocked(hasRootRolesV2)).toHaveBeenCalled();
  });

  it("approved is false when the resolver role is missing", async () => {
    mockNameState();
    vi.mocked(hasRootRolesV2).mockImplementation(async (_client, contract) => {
      return contract === FAKE_ROOT_REGISTRY;
    });
    const chain = makeChain();
    const approval = await readOperatorApproval(chain);
    expect(approval.registrarApproved).toBe(true);
    expect(approval.resolverApproved).toBe(false);
    expect(approval.approved).toBe(false);
  });
});

describe("issuePublisherSubname v2", () => {
  it("encodes register(NAME_OWNER_ROLES, expiry) then multicall(setText hf + spec)", async () => {
    mockNameState();
    vi.mocked(hasRootRolesV2).mockResolvedValue(true);
    const chain = makeChain();
    const txs = await issuePublisherSubnameV2(chain, {
      label: "alice",
      hfNamespace: "alice",
      address: CLAIMANT.address,
    });
    expect(txs).toHaveLength(2);
    expect(chain.sent).toHaveLength(2);

    const register = decodeFunctionData({ abi: registryV2Abi, data: chain.sent[0]?.data ?? "0x" });
    expect(register.functionName).toBe("register");
    expect(register.args[0]).toBe("alice");
    expect(register.args[1]).toBe(CLAIMANT.address);
    expect(register.args[2]).toBe(zeroAddress);
    expect(register.args[3]).toBe(FAKE_RESOLVER);
    expect(register.args[4]).toBe(NAME_OWNER_ROLES);
    expect(register.args[5]).toBe(EXPIRY);
    expect(chain.sent[0]?.to).toBe(FAKE_ROOT_REGISTRY);

    const multicall = decodeFunctionData({
      abi: permissionedResolverAbi,
      data: chain.sent[1]?.data ?? "0x",
    });
    expect(multicall.functionName).toBe("multicall");
    const inner = multicall.args[0] as readonly Hex[];
    expect(inner).toHaveLength(2);
    const node = namehashOf("alice.enspack.eth");
    const first = decodeFunctionData({ abi: permissionedResolverAbi, data: inner[0] ?? "0x" });
    const second = decodeFunctionData({ abi: permissionedResolverAbi, data: inner[1] ?? "0x" });
    expect(first.functionName).toBe("setText");
    expect(first.args).toEqual([node, TEXT_KEYS.hf, "alice"]);
    expect(second.functionName).toBe("setText");
    expect(second.args).toEqual([node, TEXT_KEYS.spec, SPEC_STRING]);
    expect(chain.sent[1]?.to).toBe(FAKE_RESOLVER);
    expect(labelId("alice")).toBeGreaterThan(0n);
  });

  it("uses now+365 days when the root expiry is 0", async () => {
    mockNameState({ expiry: 0n });
    vi.mocked(hasRootRolesV2).mockResolvedValue(true);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const chain = makeChain();
    await issuePublisherSubname(chain, {
      label: "alice",
      hfNamespace: "alice",
      address: CLAIMANT.address,
    });
    const register = decodeFunctionData({ abi: registryV2Abi, data: chain.sent[0]?.data ?? "0x" });
    expect(register.args[5]).toBe(BigInt(Math.floor(now / 1000) + 365 * 24 * 60 * 60));
    vi.spyOn(Date, "now").mockRestore();
  });

  it("returns [] when the label is already owned by the claimant with matching texts", async () => {
    mockNameState();
    vi.mocked(hasRootRolesV2).mockResolvedValue(true);
    const chain = makeChain({
      owner: CLAIMANT.address,
      status: 2,
      texts: { hf: "alice", spec: SPEC_STRING },
    });
    const txs = await issuePublisherSubnameV2(chain, {
      label: "alice",
      hfNamespace: "alice",
      address: CLAIMANT.address,
    });
    expect(txs).toEqual([]);
    expect(chain.sent).toHaveLength(0);
  });

  it("does not send register when the operator lacks ROLE_SET_TEXT", async () => {
    mockNameState();
    vi.mocked(hasRootRolesV2).mockImplementation(async (_client, contract) => {
      return contract === FAKE_ROOT_REGISTRY;
    });
    const chain = makeChain();
    await expect(
      issuePublisherSubnameV2(chain, {
        label: "bob",
        hfNamespace: "bob",
        address: CLAIMANT.address,
      }),
    ).rejects.toMatchObject({ status: 503, code: "OPERATOR_NOT_APPROVED" });
    expect(chain.sent).toHaveLength(0);
  });
});
