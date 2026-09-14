import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Manifest,
  canonicalJson,
  createManifestStore,
  createPublisher,
  ensV2ConfigFor,
  manifestCid,
  validateLock,
  validateManifest,
  versionLabel,
} from "@enspack/core";
import { createTorrent, magnetFor } from "@enspack/torrent";
import { http, createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ANVIL_0_KEY,
  provisionV2Name,
  startSepoliaAnvil,
} from "../../../packages/core/test/chain/v2-helpers.js";
import { anvilBin, aria2cAvailable, cliBuilt, killPid } from "./helpers/bins.js";
import { lastJsonObject, spawnCli } from "./helpers/cli.js";
import { startPinnerGateway } from "./helpers/gateway.js";
import { fixtureDir, fixtureFiles } from "./helpers/paths.js";
import { startHttpsWebseed } from "./helpers/webseed.js";

const PUBLISHER_NAME = "enspack-test.eth";
const MODEL_NAME = "tiny-model.enspack-test.eth";
const VERSION_NAME = "v1-0-0.tiny-model.enspack-test.eth";
const VERSION_110_NAME = "v1-1-0.tiny-model.enspack-test.eth";

const skip = !anvilBin || !aria2cAvailable() || !cliBuilt;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileRole(name: string): "config" | "tokenizer" | "weight" {
  if (name === "config.json") return "config";
  if (name === "tokenizer.json") return "tokenizer";
  return "weight";
}

/**
 * WP-17: Sepolia ENSv2 fork e2e. Runs in CI when anvil + aria2c are present.
 * Version names are immutable, so the model pointer is moved by publishing 1.1.0.
 */
describe.skipIf(skip)("sepolia fork e2e (anvil + ENSv2)", { timeout: 300_000 }, () => {
  let rpcUrl = "";
  let gatewayTemplate = "";
  let gatewayOrigin = "";
  let cid = "";
  let manifest100!: Manifest;
  let env: NodeJS.ProcessEnv = {};
  const tmps: string[] = [];
  const closers: Array<() => Promise<void> | void> = [];

  beforeAll(async () => {
    if (anvilBin === null) {
      return;
    }
    const started = await startSepoliaAnvil(anvilBin);
    closers.push(() => killPid(started.proc));
    rpcUrl = started.url;

    const cfg = ensV2ConfigFor("sepolia");
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const account0 = privateKeyToAccount(ANVIL_0_KEY);
    const wallet0 = createWalletClient({
      account: account0,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    await provisionV2Name(publicClient, wallet0, cfg, { label: "enspack-test", rpcUrl });

    const web = await startHttpsWebseed(fixtureDir);
    closers.push(() => web.close());

    const gateway = await startPinnerGateway();
    closers.push(() => gateway.close());
    gatewayTemplate = gateway.gatewayTemplate;
    gatewayOrigin = gateway.origin;

    const torrent = await createTorrent(fixtureDir, {
      name: "tiny-model",
      webseeds: [web.url],
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
      versions: [{ version: "1.0.0", name: VERSION_NAME, cid: placeholderCid, createdAt }],
    });
    const firstCid = await manifestCid(canonicalJson(first));
    const last = first.versions[first.versions.length - 1];
    if (last !== undefined) {
      last.cid = firstCid;
    }
    manifest100 = validateManifest(first);
    cid = await store.put(canonicalJson(manifest100), "application/json");

    const published = await createPublisher({
      client: publicClient,
      wallet: wallet0,
      account: account0,
      ensVersion: "v2",
      ensV2: cfg,
    }).publish({
      manifest: manifest100,
      manifestCid: cid,
      chain: "sepolia",
    });
    expect(published.txs).toHaveLength(4);
    expect(published.created).toEqual({ model: true, version: true });

    env = {
      ...process.env,
      SEPOLIA_RPC_URL: rpcUrl,
      ENSPACK_IPFS_GATEWAYS: gatewayTemplate,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      ENSPACK_ARIA2_EXTRA: "--check-certificate=false,--bt-stop-timeout=45",
    };
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

  it("inspect --json includes ensVersion v2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-e2e-v2-inspect-"));
    tmps.push(dir);
    const r = await spawnCli(["inspect", MODEL_NAME, "--json", "--chain", "sepolia"], env, dir);
    expect(r.code, r.stderr).toBe(0);
    const payload = lastJsonObject(r.stdout) as Manifest & { ensVersion: string };
    expect(payload.ensVersion).toBe("v2");
    expect(payload.model).toBe(MODEL_NAME);
    expect(payload.name).toBe(VERSION_NAME);
    expect(payload.spec).toBe("enspack/0.1");
  });

  it("versions --json marks the latest entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-e2e-v2-versions-"));
    tmps.push(dir);
    const r = await spawnCli(["versions", MODEL_NAME, "--json", "--chain", "sepolia"], env, dir);
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
    const dir = await mkdtemp(join(tmpdir(), "enspack-e2e-v2-get-"));
    tmps.push(dir);
    const r = await spawnCli(
      ["get", MODEL_NAME, "--http-only", "--dir", dir, "--json", "--chain", "sepolia"],
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
  });

  it("add + install --frozen reproduces the lockfile", async () => {
    const project = await mkdtemp(join(tmpdir(), "enspack-e2e-v2-lock-"));
    tmps.push(project);
    const added = await spawnCli(["add", MODEL_NAME, "--json", "--chain", "sepolia"], env, project);
    expect(added.code, added.stderr).toBe(0);
    const before = await readFile(join(project, "enspack.lock"), "utf8");
    const lock = validateLock(JSON.parse(before));
    expect(lock.models[MODEL_NAME]?.cid).toBe(cid);

    const out = join(project, "models");
    const installed = await spawnCli(
      ["install", "--frozen", "--http-only", "--dir", out, "--json", "--chain", "sepolia"],
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

  it("install exits 3 after publishing 1.1.0 which moves the model pointer", async () => {
    const project = await mkdtemp(join(tmpdir(), "enspack-e2e-v2-mismatch-"));
    tmps.push(project);
    const added = await spawnCli(["add", MODEL_NAME, "--json", "--chain", "sepolia"], env, project);
    expect(added.code, added.stderr).toBe(0);
    const lock = validateLock(JSON.parse(await readFile(join(project, "enspack.lock"), "utf8")));
    expect(lock.models[MODEL_NAME]?.cid).toBe(cid);

    const cfg = ensV2ConfigFor("sepolia");
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const account0 = privateKeyToAccount(ANVIL_0_KEY);
    const wallet0 = createWalletClient({
      account: account0,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    const store = createManifestStore({
      gateways: [gatewayTemplate],
      pinner: {
        name: "local-http",
        async pin(bytes) {
          const res = await fetch(`${gatewayOrigin}/pin`, {
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

    const createdAt110 = "2026-09-14T00:01:00Z";
    const placeholderCid = `bafkrei${"q".repeat(52)}`;
    const second = validateManifest({
      ...manifest100,
      name: VERSION_110_NAME,
      version: "1.1.0",
      createdAt: createdAt110,
      displayName: "tiny-model-repoint",
      previous: cid,
      versions: [
        { version: "1.0.0", name: VERSION_NAME, cid, createdAt: "2026-09-14T00:00:00Z" },
        { version: "1.1.0", name: VERSION_110_NAME, cid: placeholderCid, createdAt: createdAt110 },
      ],
    });
    const secondCid = await manifestCid(canonicalJson(second));
    const last110 = second.versions[second.versions.length - 1];
    if (last110 !== undefined) {
      last110.cid = secondCid;
    }
    const manifest110 = validateManifest(second);
    const cid110 = await store.put(canonicalJson(manifest110), "application/json");
    const published = await createPublisher({
      client: publicClient,
      wallet: wallet0,
      account: account0,
      ensVersion: "v2",
      ensV2: cfg,
    }).publish({
      manifest: manifest110,
      manifestCid: cid110,
      chain: "sepolia",
    });
    expect(published.txs).toHaveLength(2);
    expect(versionLabel("1.1.0")).toBe("v1-1-0");

    const r = await spawnCli(
      [
        "install",
        "--frozen",
        "--http-only",
        "--dir",
        join(project, "out"),
        "--json",
        "--chain",
        "sepolia",
      ],
      env,
      project,
    );
    expect(r.code, r.stderr).toBe(3);
    expect(r.stderr).toMatch(/enspack update|pins/);
  });
});
