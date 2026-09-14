import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
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
import { ENS_REGISTRY } from "../../src/constants.js";
import { ensRegistryAbi } from "../../src/ens/abis.js";

/** Anvil account 0 (Foundry default, not a secret). */
export const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** Anvil account 1 (Foundry default, not a secret). */
export const ANVIL_1_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

/**
 * Fork sources: `ETH_RPC_URL` when set, otherwise public endpoints tried in
 * rotation. Public RPCs are load-balanced and lag each other, so forks are
 * pinned a few blocks behind head to avoid "block not found" during genesis.
 */
export const FORK_URLS: readonly string[] =
  process.env.ETH_RPC_URL !== undefined && process.env.ETH_RPC_URL !== ""
    ? [process.env.ETH_RPC_URL]
    : ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth", "https://eth.drpc.org"];
export const FORK_URL = FORK_URLS[0] ?? "";
const FORK_BLOCK_LAG = 64;

type ForkTransport = ReturnType<typeof http>;
export type ForkPublicClient = PublicClient<ForkTransport, typeof mainnet>;
export type ForkWalletClient = WalletClient<ForkTransport, typeof mainnet, PrivateKeyAccount>;

export function resolveAnvilBin(): string | null {
  const fromHome = join(homedir(), ".foundry/bin/anvil");
  if (existsSync(fromHome)) {
    return fromHome;
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const candidate = join(dir, "anvil");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export const anvilBin = resolveAnvilBin();
export const anvilAvailable = anvilBin !== null;

function redact(text: string): string {
  let out = text;
  for (const url of FORK_URLS) {
    out = out.split(url).join("[fork-url]");
  }
  return out;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        const { port } = addr;
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve(port);
          }
        });
      } else {
        server.close();
        reject(new Error("listen returned no address"));
      }
    });
  });
}

export function killPid(proc: ChildProcess): void {
  if (proc.pid !== undefined && proc.exitCode === null) {
    proc.kill("SIGTERM");
  }
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
      // fork source not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("anvil fork did not become ready");
}

async function forkBlockNumber(forkUrl: string): Promise<number> {
  const res = await fetch(forkUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { result?: unknown };
  if (typeof json.result !== "string") {
    throw new Error("fork source did not return eth_blockNumber");
  }
  return Math.max(0, Number.parseInt(json.result, 16) - FORK_BLOCK_LAG);
}

export async function startAnvil(bin: string): Promise<{ proc: ChildProcess; url: string }> {
  let lastError: unknown;
  const attempts = Math.max(3, FORK_URLS.length * 2);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const forkUrl = FORK_URLS[(attempt - 1) % FORK_URLS.length] ?? FORK_URL;
    let blockNumber: number;
    try {
      blockNumber = await forkBlockNumber(forkUrl);
    } catch (err) {
      lastError = new Error(
        `anvil fork start attempt ${attempt}/${attempts}: fork source unavailable: ${redact(String(err))}`,
      );
      continue;
    }
    const port = await getFreePort();
    const proc = spawn(
      bin,
      [
        "--fork-url",
        forkUrl,
        "--fork-block-number",
        String(blockNumber),
        "--retries",
        "5",
        "--timeout",
        "20000",
        "--port",
        String(port),
        "--silent",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
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
        `anvil fork start attempt ${attempt}/${attempts} failed: ${redact(String(err))}${stderr ? ` stderr=${stderr}` : ""}`,
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

export async function setSubnode(
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
