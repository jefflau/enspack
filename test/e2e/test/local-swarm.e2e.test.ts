import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Manifest,
  canonicalJson,
  createManifestStore,
  createPublisher,
  encodeIpfsContenthash,
  magnetFor,
  manifestCid,
  namehashOf,
  validateLock,
  validateManifest,
} from "@enspack/core";
import { createTorrent } from "@enspack/torrent";
import type { Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ForkPublicClient,
  type ForkWalletClient,
  MODEL_NAME,
  PUBLISHER_NAME,
  VERSION_NAME,
  provisionPublisherName,
  startAnvil,
} from "./helpers/anvil.js";
import { anvilBin, aria2cAvailable, cliBuilt, killPid, spawnSeeder } from "./helpers/bins.js";
import { lastJsonObject, spawnCli } from "./helpers/cli.js";
import { startPinnerGateway } from "./helpers/gateway.js";
import { fixtureDir, fixtureFiles } from "./helpers/paths.js";
import { getFreePort } from "./helpers/ports.js";
import { startTracker } from "./helpers/tracker.js";
import { startHttpsWebseed } from "./helpers/webseed.js";

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
] as const;

const skip = !anvilBin || !aria2cAvailable() || !cliBuilt;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileRole(name: string): "config" | "tokenizer" | "weight" {
  if (name === "config.json") return "config";
  if (name === "tokenizer.json") return "tokenizer";
  return "weight";
}

describe.skipIf(skip)("local swarm e2e (anvil + aria2c)", { timeout: 300_000 }, () => {
  let rpcUrl = "";
  let gatewayTemplate = "";
  let cid = "";
  let cid2 = "";
  let env: NodeJS.ProcessEnv = {};
  let publicResolver!: Address;
  let publicClient!: ForkPublicClient;
  let wallet0!: ForkWalletClient;
  let webClose: (() => Promise<void>) | undefined;
  const tmps: string[] = [];
  const closers: Array<() => Promise<void> | void> = [];

  beforeAll(async () => {
    if (anvilBin === null) {
      return;
    }
    const started = await startAnvil(anvilBin);
    closers.push(() => killPid(started.proc));
    rpcUrl = started.url;

    const provisioned = await provisionPublisherName(rpcUrl);
    publicResolver = provisioned.publicResolver;
    publicClient = provisioned.publicClient;
    wallet0 = provisioned.wallet0;

    const seedPort = await getFreePort();
    const tracker = await startTracker("127.0.0.1", seedPort);
    closers.push(() => tracker.close());

    const web = await startHttpsWebseed(fixtureDir);
    webClose = web.close;
    closers.push(async () => {
      if (webClose !== undefined) {
        await webClose();
        webClose = undefined;
      }
    });

    const gateway = await startPinnerGateway();
    closers.push(() => gateway.close());
    gatewayTemplate = gateway.gatewayTemplate;

    const torrent = await createTorrent(fixtureDir, {
      name: "tiny-model",
      webseeds: [web.url],
      announce: [tracker.url],
    });

    const store = createManifestStore({
      gateways: [gateway.gatewayTemplate],
      pinner: {
        name: "local-http",
        async pin(bytes) {
          const res = await fetch(`${gateway.origin}/pin`, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: bytes,
          });
          if (!res.ok) {
            throw new Error(`local pin HTTP ${res.status}`);
          }
          const json = (await res.json()) as { cid: string };
          return json.cid;
        },
      },
    });
    const torrentCid = await store.put(torrent.metainfo, "application/x-bittorrent");

    const files = fixtureFiles.map((name) => ({
      path: name,
      size: statSync(join(fixtureDir, name)).size,
      sha256: sha256File(join(fixtureDir, name)),
      role: fileRole(name),
    }));
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    const createdAt = "2026-09-14T00:00:00Z";
    const placeholderCid = `bafkrei${"p".repeat(52)}`;
    const first = validateManifest({
      spec: "enspack/0.1",
      name: VERSION_NAME,
      model: MODEL_NAME,
      publisher: PUBLISHER_NAME,
      version: "1.0.0",
      createdAt,
      displayName: "tiny-model",
      license: "apache-2.0",
      distribution: {
        infohash: torrent.infohash,
        magnet: magnetFor(torrent.infohash, "tiny-model"),
        torrent: { cid: torrentCid },
        webseeds: [web.url],
      },
      files,
      totalSize,
      versions: [
        {
          version: "1.0.0",
          name: VERSION_NAME,
          cid: placeholderCid,
          createdAt,
        },
      ],
    });
    const firstCid = await manifestCid(canonicalJson(first));
    const last = first.versions[first.versions.length - 1];
    if (last !== undefined) {
      last.cid = firstCid;
    }
    const manifest = validateManifest(first);
    const manifestBytes = canonicalJson(manifest);
    cid = await store.put(manifestBytes, "application/json");

    const published = await createPublisher({
      client: publicClient,
      wallet: wallet0,
      account: provisioned.account0,
    }).publish({
      manifest,
      manifestCid: cid,
      chain: "mainnet",
    });
    expect(published.txs).toHaveLength(3);

    const other = validateManifest({ ...manifest, displayName: "tiny-model-repoint" });
    cid2 = await store.put(canonicalJson(other), "application/json");

    const seedRoot = await mkdtemp(join(tmpdir(), "enspack-e2e-seed-"));
    tmps.push(seedRoot);
    await mkdir(join(seedRoot, "tiny-model"), { recursive: true });
    for (const name of fixtureFiles) {
      await cp(join(fixtureDir, name), join(seedRoot, "tiny-model", name));
    }
    const torrentFile = join(seedRoot, "swarm.torrent");
    await writeFile(torrentFile, torrent.metainfo);
    const seeder = spawnSeeder([
      `--dir=${seedRoot}`,
      "--seed-ratio=0.0",
      "--seed-time=120",
      `--listen-port=${seedPort}`,
      "--enable-dht=false",
      "--enable-peer-exchange=false",
      "--bt-enable-lpd=false",
      "--bt-external-ip=127.0.0.1",
      "--check-integrity=true",
      "--bt-seed-unverified=true",
      "--file-allocation=none",
      "--summary-interval=1",
      "--console-log-level=notice",
      "--allow-overwrite=true",
      "--",
      torrentFile,
    ]);
    closers.push(() => killPid(seeder));
    await new Promise((r) => setTimeout(r, 1500));

    env = {
      ...process.env,
      ETH_RPC_URL: rpcUrl,
      ENSPACK_IPFS_GATEWAYS: gatewayTemplate,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      ENSPACK_ARIA2_EXTRA:
        "--check-certificate=false,--bt-external-ip=127.0.0.1,--enable-dht=false,--bt-stop-timeout=45",
    };
    env.SEPOLIA_RPC_URL = undefined;
  }, 180_000);

  afterAll(async () => {
    while (closers.length > 0) {
      const close = closers.pop();
      try {
        await close?.();
      } catch {
        /* still tear down the rest */
      }
    }
    await Promise.all(tmps.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("inspect --json returns the published manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-e2e-inspect-"));
    tmps.push(dir);
    const r = await spawnCli(["inspect", MODEL_NAME, "--json", "--chain", "mainnet"], env, dir);
    expect(r.code, r.stderr).toBe(0);
    const payload = lastJsonObject(r.stdout) as Manifest;
    expect(payload.model).toBe(MODEL_NAME);
    expect(payload.name).toBe(VERSION_NAME);
    expect(payload.spec).toBe("enspack/0.1");
  });

  it("versions --json marks the latest entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-e2e-versions-"));
    tmps.push(dir);
    const r = await spawnCli(["versions", MODEL_NAME, "--json", "--chain", "mainnet"], env, dir);
    expect(r.code, r.stderr).toBe(0);
    const payload = lastJsonObject(r.stdout) as {
      versions: Array<{ version: string; latest: boolean; name: string }>;
    };
    expect(payload.versions.length).toBeGreaterThanOrEqual(1);
    const last = payload.versions[payload.versions.length - 1];
    expect(last?.latest).toBe(true);
    expect(last?.version).toBe("1.0.0");
    expect(last?.name).toBe(VERSION_NAME);
  });

  it("get --http-only --dir against the local HTTPS webseed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-e2e-get-"));
    tmps.push(dir);
    const r = await spawnCli(
      ["get", MODEL_NAME, "--http-only", "--dir", dir, "--json", "--chain", "mainnet"],
      env,
      dir,
    );
    expect(r.code, r.stderr).toBe(0);
    const payload = lastJsonObject(r.stdout) as {
      cid: string;
      verified: boolean;
      files: number;
    };
    expect(payload.cid).toBe(cid);
    expect(payload.verified).toBe(true);
    expect(payload.files).toBe(3);
    for (const name of fixtureFiles) {
      expect(sha256File(join(dir, name))).toBe(sha256File(join(fixtureDir, name)));
    }

    const verified = await spawnCli(
      ["verify", MODEL_NAME, dir, "--json", "--chain", "mainnet"],
      env,
      dir,
    );
    expect(verified.code, verified.stderr).toBe(0);
    expect(lastJsonObject(verified.stdout)).toEqual({ ok: true });
  });

  it("add + install --frozen reproduces the lockfile", async () => {
    const project = await mkdtemp(join(tmpdir(), "enspack-e2e-lock-"));
    tmps.push(project);
    const added = await spawnCli(["add", MODEL_NAME, "--json", "--chain", "mainnet"], env, project);
    expect(added.code, added.stderr).toBe(0);
    const before = await readFile(join(project, "enspack.lock"), "utf8");
    const lock = validateLock(JSON.parse(before));
    expect(lock.models[MODEL_NAME]?.cid).toBe(cid);

    const out = join(project, "models");
    const installed = await spawnCli(
      ["install", "--frozen", "--http-only", "--dir", out, "--json", "--chain", "mainnet"],
      env,
      project,
    );
    expect(installed.code, installed.stderr).toBe(0);
    const after = await readFile(join(project, "enspack.lock"), "utf8");
    expect(after).toBe(before);
    for (const name of fixtureFiles) {
      expect(existsSync(join(out, name))).toBe(true);
      expect(sha256File(join(out, name))).toBe(sha256File(join(fixtureDir, name)));
    }
  });

  it("get without --http-only completes via the in-process tracker swarm", async () => {
    if (webClose !== undefined) {
      await webClose();
      webClose = undefined;
    }
    const dir = await mkdtemp(join(tmpdir(), "enspack-e2e-swarm-"));
    tmps.push(dir);
    const swarmEnv: NodeJS.ProcessEnv = {
      ...env,
      ENSPACK_ARIA2_EXTRA: "--bt-external-ip=127.0.0.1,--enable-dht=false,--bt-stop-timeout=45",
    };
    const r = await spawnCli(
      ["get", MODEL_NAME, "--dir", dir, "--json", "--chain", "mainnet"],
      swarmEnv,
      dir,
      150_000,
    );
    expect(r.code, r.stderr).toBe(0);
    const payload = lastJsonObject(r.stdout) as { cid: string; verified: boolean; files: number };
    expect(payload.cid).toBe(cid);
    expect(payload.verified).toBe(true);
    expect(payload.files).toBe(3);
    for (const name of fixtureFiles) {
      expect(sha256File(join(dir, name))).toBe(sha256File(join(fixtureDir, name)));
    }
  });

  it("install exits 3 after the model name is repointed to a second CID", async () => {
    const hash = await wallet0.writeContract({
      address: publicResolver,
      abi: publicResolverWriteAbi,
      functionName: "setContenthash",
      args: [namehashOf(MODEL_NAME), encodeIpfsContenthash(cid2)],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const project = await mkdtemp(join(tmpdir(), "enspack-e2e-mismatch-"));
    tmps.push(project);
    const added = await spawnCli(["add", MODEL_NAME, "--json", "--chain", "mainnet"], env, project);
    expect(added.code, added.stderr).toBe(0);
    const lock = validateLock(JSON.parse(await readFile(join(project, "enspack.lock"), "utf8")));
    expect(lock.models[MODEL_NAME]?.cid).toBe(cid);

    const r = await spawnCli(
      [
        "install",
        "--frozen",
        "--http-only",
        "--dir",
        join(project, "out"),
        "--json",
        "--chain",
        "mainnet",
      ],
      env,
      project,
    );
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toMatch(/enspack update|pins/);
  });
});
