import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ENS_REGISTRY, type EnsV2Config, type EnsVersion } from "@enspack/core";
import type { FetchLike } from "@enspack/hf";
import { type Address, type Hex, keccak256, namehash, toBytes, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type RegistrarDeps, createApp } from "../src/app.js";
import type { RegistrarChain } from "../src/chain.js";
import { type Db, createDb } from "../src/db.js";

/** Anvil account 0 (Foundry default, not a secret). */
export const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
/** Anvil account 1 — operator in tests. */
export const ANVIL_1_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
/** Anvil account 2 — claimant in tests. */
export const ANVIL_2_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

export const OPERATOR = privateKeyToAccount(ANVIL_1_KEY).address;
export const CLAIMANT = privateKeyToAccount(ANVIL_2_KEY);
export const FAKE_RESOLVER = "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63" as Address;
export const FAKE_ROOT_REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
export const FAKE_V2_CONFIG = {
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
} as EnsV2Config;

function testLabelId(label: string): bigint {
  return BigInt(keccak256(toBytes(label)));
}

export const PUBLIC_DIR = dirname(fileURLToPath(new URL("../public/index.html", import.meta.url)));

export const FIXED_RANDOM = Uint8Array.from({ length: 32 }, () => 0xab);

export type HfState = {
  namespace: string;
  name: string;
  file: string | null;
  sha: string;
  private: boolean;
};

export function createFakeHf(state: HfState): FetchLike {
  return async (input) => {
    const url = String(input);
    const repo = `${state.namespace}/${state.name}`;
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (
      url.includes(`/api/models/${repo}`) &&
      !url.includes("/tree/") &&
      !url.includes("/revision/")
    ) {
      return json(200, {
        private: state.private,
        gated: false,
        sha: state.sha,
        cardData: {},
        author: state.namespace,
        id: repo,
      });
    }
    if (url.includes("/api/datasets/") || url.includes("/api/spaces/")) {
      return json(404, { error: "not found" });
    }
    if (url.includes("enspack-verify.txt")) {
      if (state.file === null) {
        return new Response("missing", { status: 404 });
      }
      return new Response(state.file, {
        status: 200,
        headers: { "x-repo-commit": state.sha },
      });
    }
    return json(404, { error: "not found" });
  };
}

export function createFakeChain(opts?: {
  taken?: Set<string>;
  approved?: boolean;
  ensVersion?: EnsVersion;
  registrarApproved?: boolean;
  resolverApproved?: boolean;
  texts?: Map<string, { hf: string; spec: string }>;
}): RegistrarChain {
  const taken = opts?.taken ?? new Set<string>();
  const approved = opts?.approved ?? true;
  const ensVersion: EnsVersion = opts?.ensVersion ?? "v1";
  const registrarApproved = opts?.registrarApproved ?? approved;
  const resolverApproved = opts?.resolverApproved ?? approved;
  const texts = opts?.texts ?? new Map<string, { hf: string; spec: string }>();
  let n = 0;
  const rootName = "enspack.eth";
  const SET_TEXT = 1n << 4n;
  const client = {
    chain: undefined,
    async readContract({
      functionName,
      args,
    }: {
      functionName: string;
      args?: readonly unknown[];
    }) {
      if (functionName === "resolver") {
        return FAKE_RESOLVER;
      }
      if (functionName === "owner") {
        const node = args?.[0];
        for (const label of taken) {
          if (namehash(`${label}.${rootName}`) === node) {
            return OPERATOR;
          }
        }
        return zeroAddress;
      }
      if (functionName === "isApprovedForAll") {
        return approved;
      }
      if (functionName === "getOwner") {
        const id = args?.[0];
        for (const label of taken) {
          if (testLabelId(label) === id) {
            return OPERATOR;
          }
        }
        return zeroAddress;
      }
      if (functionName === "getStatus") {
        const id = args?.[0];
        for (const label of taken) {
          if (testLabelId(label) === id) {
            return 2;
          }
        }
        return 0;
      }
      if (functionName === "hasRootRoles") {
        const roleBitmap = args?.[0] as bigint;
        if ((roleBitmap & SET_TEXT) === SET_TEXT) {
          return resolverApproved;
        }
        return registrarApproved;
      }
      if (functionName === "text") {
        const node = args?.[0];
        const key = args?.[1];
        for (const [label, rec] of texts) {
          if (namehash(`${label}.${rootName}`) === node) {
            if (key === "com.enspack.hf") {
              return rec.hf;
            }
            if (key === "com.enspack.spec") {
              return rec.spec;
            }
          }
        }
        return "";
      }
      throw new Error(`unexpected readContract ${functionName}`);
    },
    async estimateContractGas() {
      return 21_000n;
    },
    async estimateGas() {
      return 21_000n;
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
    async writeContract() {
      n += 1;
      return `0x${n.toString(16).padStart(64, "0")}` as Hex;
    },
    async sendTransaction() {
      n += 1;
      return `0x${n.toString(16).padStart(64, "0")}` as Hex;
    },
  };
  return {
    client,
    wallet,
    operator: OPERATOR,
    registry: ENS_REGISTRY,
    rootName,
    ensVersion,
    ...(ensVersion === "v2" ? { ensV2: FAKE_V2_CONFIG } : {}),
  } as unknown as RegistrarChain;
}

export async function createTestApp(opts?: {
  now?: () => Date;
  hf?: HfState;
  chain?: RegistrarChain;
  ensVersion?: EnsVersion;
}): Promise<{ app: ReturnType<typeof createApp>; db: Db; hf: HfState }> {
  const db = await createDb();
  const hf: HfState = opts?.hf ?? {
    namespace: "alice",
    name: "proof",
    file: null,
    sha: "a".repeat(40),
    private: false,
  };
  const app = createApp({
    db,
    hf: { fetch: createFakeHf(hf) },
    chain: opts?.chain ?? createFakeChain({ ensVersion: opts?.ensVersion ?? "v1" }),
    now: opts?.now ?? (() => new Date("2026-09-14T00:00:00.000Z")),
    random: () => FIXED_RANDOM,
    publicDir: PUBLIC_DIR,
    chainName: "mainnet",
  } satisfies RegistrarDeps);
  return { app, db, hf };
}
