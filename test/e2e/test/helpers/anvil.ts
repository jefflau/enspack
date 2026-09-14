import { type ChildProcess, spawn } from "node:child_process";
import { ENS_REGISTRY } from "@enspack/core";
import {
  http,
  type Account,
  type Address,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  namehash,
  parseEther,
  zeroAddress,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { getEnsResolver, labelhash } from "viem/ens";
import { killPid } from "./bins.js";
import { getFreePort } from "./ports.js";

/** Anvil account 0 (Foundry default, not a secret). */
export const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const FORK_URL = process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com";

export const PUBLISHER_NAME = "enspack-test.eth";
export const MODEL_NAME = "tiny-model.enspack-test.eth";
export const VERSION_NAME = "v1-0-0.tiny-model.enspack-test.eth";

type ForkTransport = ReturnType<typeof http>;
export type ForkPublicClient = PublicClient<ForkTransport, typeof mainnet>;
export type ForkWalletClient = WalletClient<ForkTransport, typeof mainnet, PrivateKeyAccount>;

const ensRegistryAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

function redact(text: string): string {
  return text.split(FORK_URL).join("[fork-url]");
}

async function waitForRpc(url: string, proc: ChildProcess, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) {
      throw new Error(`anvil exited early with code ${proc.exitCode}`);
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      });
      const json: unknown = await res.json();
      if (typeof json === "object" && json !== null && "result" in json) {
        return;
      }
    } catch {
      /* fork source not ready yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("anvil fork did not become ready");
}

export async function startAnvil(bin: string): Promise<{ proc: ChildProcess; url: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const port = await getFreePort();
    const proc = spawn(bin, ["--fork-url", FORK_URL, "--port", String(port), "--silent"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    proc.stderr?.on("data", (c: Buffer) => {
      stderrChunks.push(c);
    });
    const url = `http://127.0.0.1:${port}`;
    try {
      await waitForRpc(url, proc, 45_000);
      return { proc, url };
    } catch (err) {
      killPid(proc);
      const stderr = redact(Buffer.concat(stderrChunks).toString("utf8"));
      lastError = new Error(
        `anvil fork start attempt ${attempt}/3 failed: ${redact(String(err))}${
          stderr ? ` stderr=${stderr}` : ""
        }`,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("anvil fork failed");
}

export async function anvilRpc(url: string, method: string, params: unknown[]): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json: unknown = await res.json();
  if (typeof json === "object" && json !== null && "error" in json) {
    throw new Error(`rpc ${method} failed`);
  }
}

async function setSubnode(
  wallet: WalletClient<ForkTransport, typeof mainnet, Account | undefined>,
  publicClient: ForkPublicClient,
  account: Address | PrivateKeyAccount,
  parent: string,
  label: string,
  owner: Address,
  resolver: Address,
): Promise<void> {
  const hash = await wallet.writeContract({
    account,
    chain: mainnet,
    address: ENS_REGISTRY,
    abi: ensRegistryAbi,
    functionName: "setSubnodeRecord",
    args: [namehash(parent), labelhash(label), owner, resolver, 0n],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`setSubnodeRecord ${label}.${parent} failed`);
  }
}

/** Hand `enspack-test.eth` to Anvil account 0 using a PublicResolver discovered at runtime. */
export async function provisionPublisherName(rpcUrl: string): Promise<{
  account0: PrivateKeyAccount;
  publicResolver: Address;
  publicClient: ForkPublicClient;
  wallet0: ForkWalletClient;
}> {
  const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  const account0 = privateKeyToAccount(ANVIL_0_KEY);

  const ethOwner = await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: ensRegistryAbi,
    functionName: "owner",
    args: [namehash("eth")],
  });
  if (ethOwner === zeroAddress) {
    throw new Error("registry owner(eth) is zero");
  }

  const discovered = await getEnsResolver(publicClient, { name: "ens.eth" });
  if (discovered === zeroAddress) {
    throw new Error("could not discover a PublicResolver from ens.eth");
  }

  await anvilRpc(rpcUrl, "anvil_impersonateAccount", [ethOwner]);
  await anvilRpc(rpcUrl, "anvil_setBalance", [ethOwner, `0x${parseEther("100").toString(16)}`]);
  await anvilRpc(rpcUrl, "anvil_setBalance", [
    account0.address,
    `0x${parseEther("100").toString(16)}`,
  ]);

  const ethOwnerWallet = createWalletClient({
    account: ethOwner,
    chain: mainnet,
    transport: http(rpcUrl),
  });
  const wallet0 = createWalletClient({
    account: account0,
    chain: mainnet,
    transport: http(rpcUrl),
  });

  await setSubnode(
    ethOwnerWallet,
    publicClient,
    ethOwner,
    "eth",
    "enspack-test",
    account0.address,
    discovered,
  );

  return { account0, publicResolver: discovered, publicClient, wallet0 };
}
