import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { createServer as createNetServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENS_REGISTRY,
  SPEC_STRING,
  TEXT_KEYS,
  canonicalJson,
  encodeIpfsContenthash,
  manifestCid,
  namehashOf,
  validateManifest,
} from "@enspack/core";
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
import { afterAll, describe, expect, it } from "vitest";
import { fixtureDir, fixtureManifestPath, fixtureTorrentPath } from "./helpers.js";

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

const publicResolverWriteAbi = [
  {
    type: "function",
    name: "setContenthash",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "hash", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

const ANVIL_0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FORK_URL = process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
const PUBLISHER_NAME = "enspack-test.eth";
const MODEL_NAME = "tiny-model.enspack-test.eth";
const VERSION_NAME = "v1-0-0.tiny-model.enspack-test.eth";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const enspackBin = join(cliRoot, "bin/enspack.js");
const ensgetBin = join(cliRoot, "bin/ensget.js");
const distReady = existsSync(join(cliRoot, "dist/index.js"));

function resolveAnvilBin(): string | null {
  const fromHome = join(homedir(), ".foundry/bin/anvil");
  if (existsSync(fromHome)) return fromHome;
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const candidate = join(dir, "anvil");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function aria2cAvailable(): boolean {
  try {
    return spawnSync("aria2c", ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}

const anvilBin = resolveAnvilBin();
const skip = !anvilBin || !aria2cAvailable() || !distReady;

function redact(text: string): string {
  return text.split(FORK_URL).join("[fork-url]");
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        const { port } = addr;
        server.close((err) => (err ? reject(err) : resolve(port)));
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
      /* not ready */
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
      lastError = new Error(
        `anvil fork start attempt ${attempt}/3 failed: ${redact(String(err))}${
          stderrChunks.length > 0
            ? ` stderr=${redact(Buffer.concat(stderrChunks).toString("utf8"))}`
            : ""
        }`,
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

function startGateway(
  blobs: Map<string, Uint8Array>,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const m = u.pathname.match(/^\/ipfs\/([^/]+)/);
      const cid = m?.[1];
      const bytes = cid !== undefined ? blobs.get(cid) : undefined;
      if (bytes === undefined) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/vnd.ipld.raw");
      res.setHeader("content-length", bytes.byteLength);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(Buffer.from(bytes));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/ipfs/{cid}`,
        close: () =>
          new Promise((r, j) => {
            server.close((err) => (err ? j(err) : r()));
          }),
      });
    });
  });
}

function selfSignedTls(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "enspack-tls-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  const r = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=127.0.0.1",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`openssl failed: ${r.stderr}`);
  }
  return { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
}

function startWebseed(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const tls = selfSignedTls();
  return new Promise((resolve, reject) => {
    const server = createHttpsServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      const u = new URL(req.url ?? "/", "https://127.0.0.1");
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
      if (rel.startsWith("tiny-model/")) rel = rel.slice("tiny-model/".length);
      const abs = join(root, rel);
      if (!abs.startsWith(root) || !existsSync(abs)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const buf = readFileSync(abs);
      res.statusCode = 200;
      res.setHeader("content-length", buf.length);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(buf);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `https://127.0.0.1:${addr.port}/`,
        close: () =>
          new Promise((r, j) => {
            server.close((err) => (err ? j(err) : r()));
          }),
      });
    });
  });
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function spawnCli(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => {
      out.push(c);
    });
    child.stderr.on("data", (c: Buffer) => {
      err.push(c);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

describe.skipIf(skip)("enspack get e2e (anvil + local gateway)", { timeout: 180_000 }, () => {
  let proc: ChildProcess | undefined;
  let rpcUrl: string;
  let gatewayClose: (() => Promise<void>) | undefined;
  let webseedClose: (() => Promise<void>) | undefined;
  let gatewayTemplate: string;
  let cid: string;
  let manifestFiles: { path: string; sha256: string; size: number }[];
  const tmps: string[] = [];

  beforeAllMaybe();

  function beforeAllMaybe(): void {
    afterAll(async () => {
      if (proc !== undefined) killPid(proc);
      await gatewayClose?.();
      await webseedClose?.();
      await Promise.all(tmps.map((d) => rm(d, { recursive: true, force: true })));
    });
  }

  it("provisions names and runs get / ensget / HF cache", async () => {
    if (anvilBin === null) return;
    const started = await startAnvil(anvilBin);
    proc = started.proc;
    rpcUrl = started.url;

    const webseed = await startWebseed(fixtureDir);
    webseedClose = webseed.close;

    const torrentBytes = new Uint8Array(readFileSync(fixtureTorrentPath));
    const torrentCid = await manifestCid(torrentBytes);
    const raw = JSON.parse(readFileSync(fixtureManifestPath, "utf8")) as Record<string, unknown>;
    const dist = raw.distribution as Record<string, unknown>;
    dist.webseeds = [webseed.url];
    dist.torrent = { cid: torrentCid };
    raw.name = VERSION_NAME;
    raw.model = MODEL_NAME;
    raw.publisher = PUBLISHER_NAME;
    const versions = raw.versions as Array<Record<string, unknown>>;
    const last = versions[0];
    if (last !== undefined) {
      last.name = VERSION_NAME;
    }
    const manifest = validateManifest(raw);
    const manifestBytes = canonicalJson(manifest);
    cid = await manifestCid(manifestBytes);
    manifestFiles = manifest.files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.size }));

    const blobs = new Map<string, Uint8Array>([
      [cid, manifestBytes],
      [torrentCid, torrentBytes],
    ]);
    const gateway = await startGateway(blobs);
    gatewayClose = gateway.close;
    gatewayTemplate = gateway.url;

    const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const account0 = privateKeyToAccount(ANVIL_0_KEY);
    const ethOwner = await publicClient.readContract({
      address: ENS_REGISTRY,
      abi: ensRegistryAbi,
      functionName: "owner",
      args: [namehash("eth")],
    });
    if (ethOwner === zeroAddress) throw new Error("registry owner(eth) is zero");
    const publicResolver = await getEnsResolver(publicClient, { name: "ens.eth" });
    if (publicResolver === zeroAddress) throw new Error("could not discover PublicResolver");

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

    const contenthash = encodeIpfsContenthash(cid);
    const versionNode = namehashOf(VERSION_NAME);
    const modelNode = namehashOf(MODEL_NAME);
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
        args: [versionNode, TEXT_KEYS.magnet, manifest.distribution.magnet],
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
        args: [modelNode, TEXT_KEYS.magnet, manifest.distribution.magnet],
      }),
    ];
    const multicallHash = await wallet0.writeContract({
      address: publicResolver,
      abi: publicResolverWriteAbi,
      functionName: "multicall",
      args: [calls],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: multicallHash });
    if (receipt.status !== "success") throw new Error("resolver multicall failed");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ETH_RPC_URL: rpcUrl,
      ENSPACK_IPFS_GATEWAYS: gatewayTemplate,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      ENSPACK_ARIA2_EXTRA: "--check-certificate=false",
    };
    env.SEPOLIA_RPC_URL = undefined;

    const dir = await mkdtemp(join(tmpdir(), "enspack-e2e-dir-"));
    tmps.push(dir);
    const got = await spawnCli(
      enspackBin,
      ["get", MODEL_NAME, "--http-only", "--dir", dir, "--json", "--chain", "mainnet"],
      env,
      dir,
    );
    expect(got.code, got.stderr).toBe(0);
    const payload = JSON.parse(got.stdout) as {
      name: string;
      cid: string;
      verified: boolean;
      installedPath: string;
      files: number;
    };
    expect(payload.cid).toBe(cid);
    expect(payload.verified).toBe(true);
    expect(payload.files).toBe(3);
    for (const file of manifestFiles) {
      expect(sha256File(join(dir, file.path))).toBe(file.sha256);
    }

    const dir2 = await mkdtemp(join(tmpdir(), "enspack-e2e-ensget-"));
    tmps.push(dir2);
    const alias = await spawnCli(
      ensgetBin,
      [MODEL_NAME, "--http-only", "--dir", dir2, "--json", "--chain", "mainnet"],
      env,
      dir2,
    );
    expect(alias.code, alias.stderr).toBe(0);
    expect(JSON.parse(alias.stdout).cid).toBe(cid);
    for (const file of manifestFiles) {
      expect(sha256File(join(dir2, file.path))).toBe(file.sha256);
    }

    const hfHome = await mkdtemp(join(tmpdir(), "enspack-e2e-hf-"));
    tmps.push(hfHome);
    const hf = await spawnCli(
      enspackBin,
      ["get", MODEL_NAME, "--http-only", "--json", "--chain", "mainnet"],
      { ...env, HF_HOME: hfHome },
      hfHome,
    );
    expect(hf.code, hf.stderr).toBe(0);
    const hfPayload = JSON.parse(hf.stdout) as { installedPath: string };
    const snapshot = hfPayload.installedPath;
    expect(snapshot.includes(join("hub", "models--enspack--tiny-model", "snapshots"))).toBe(true);
    const refs = await readFile(
      join(hfHome, "hub", "models--enspack--tiny-model", "refs", "main"),
      "utf8",
    );
    expect(refs).toBe(`enspack-${manifest.distribution.infohash}`);
    for (const file of manifestFiles) {
      expect(sha256File(join(snapshot, file.path))).toBe(file.sha256);
    }
  }, 180_000);
});
