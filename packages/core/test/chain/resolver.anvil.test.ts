import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  http,
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  namehash,
  parseEther,
  zeroAddress,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { getEnsResolver, labelhash } from "viem/ens";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensRegistryAbi, publicResolverWriteAbi } from "../../src/ens/abis.js";
import {
  ENS_REGISTRY,
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

const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FORK_URL = process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
const MAGNET_ONLY_NAME = "magnet-only.enspack-test.eth";
const EMPTY_NAME = "empty-records.enspack-test.eth";
const UNREGISTERED = "child.unregistered-parent-zzx.eth";

function resolveAnvilBin(): string | null {
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

const anvilBin = resolveAnvilBin();
const anvilAvailable = anvilBin !== null;

function redact(text: string): string {
  return text.split(FORK_URL).join("[fork-url]");
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

function killPid(proc: ChildProcess): void {
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

async function startAnvil(bin: string): Promise<{ proc: ChildProcess; url: string }> {
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
        `anvil fork start attempt ${attempt}/3 failed: ${redact(String(err))}${stderr ? ` stderr=${stderr}` : ""}`,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("anvil fork failed");
}

async function anvilRpc(url: string, method: string, params: unknown[]): Promise<void> {
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
  wallet: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
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

    const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    account0 = privateKeyToAccount(ANVIL_0_KEY);

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
    publicResolver = discovered;

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
      publicResolver,
    );
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
