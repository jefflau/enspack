import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  createManifestStore,
  createPublisher,
  createResolver,
  isEnspackError,
  kuboPinner,
  magnetFor,
  manifestCid,
  publicClientFor,
  seedNodePinner,
  validateManifest,
  versionLabel,
} from "@enspack/core";
import { createTorrent } from "@enspack/torrent";
import { http, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { afterAll, describe, expect, it } from "vitest";
import { cliBuilt } from "./helpers/bins.js";
import { lastJsonObject, spawnCli } from "./helpers/cli.js";
import { fixtureDir, fixtureFiles } from "./helpers/paths.js";
import { shouldSkipSepolia } from "./helpers/skip.js";

const MIRROR = "mirrors.enspack.eth";
const MODEL = `tiny-model.${MIRROR}`;

const skip = shouldSkipSepolia() || !cliBuilt;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileRole(name: string): "config" | "tokenizer" | "weight" {
  if (name === "config.json") return "config";
  if (name === "tokenizer.json") return "tokenizer";
  return "weight";
}

function isPrivateKey(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function bumpPatch(version: string): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    return "1.0.1";
  }
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function pinKind(env: NodeJS.ProcessEnv): "seed" | "kubo" | null {
  if (env.ENSPACK_SEED_NODE !== undefined && env.ENSPACK_SEED_NODE !== "") {
    return "seed";
  }
  if (env.ENSPACK_KUBO_API !== undefined && env.ENSPACK_KUBO_API !== "") {
    return "kubo";
  }
  return null;
}

/**
 * Live Sepolia E2E (MVP.md WP-13 / WP-08). Unproven until secrets are supplied.
 * Never sends mainnet transactions. Publishes only under `*.mirrors.enspack.eth`.
 */
describe.skipIf(skip)("sepolia e2e", { timeout: 600_000 }, () => {
  const tmps: string[] = [];
  let publishedName = process.env.ENSPACK_E2E_NAME ?? MODEL;

  afterAll(async () => {
    await Promise.all(tmps.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("publishes the tiny-model fixture under mirrors.enspack.eth when a pinner is configured", async () => {
    const env = process.env;
    const kind = pinKind(env);
    const rpc = env.SEPOLIA_RPC_URL;
    const key = env.ENSPACK_PUBLISHER_KEY;
    if (rpc === undefined || key === undefined || !isPrivateKey(key)) {
      return;
    }
    if (kind === null) {
      if (env.ENSPACK_E2E_NAME !== undefined && env.ENSPACK_E2E_NAME !== "") {
        publishedName = env.ENSPACK_E2E_NAME;
        return;
      }
      throw new Error(
        "set ENSPACK_SEED_NODE or ENSPACK_KUBO_API to publish, or ENSPACK_E2E_NAME to get an existing name",
      );
    }

    const client = publicClientFor("sepolia", rpc);
    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({
      account,
      chain: sepolia,
      transport: http(rpc),
    });
    const pinner =
      kind === "seed"
        ? seedNodePinner({ baseUrl: env.ENSPACK_SEED_NODE ?? "" })
        : kuboPinner({ apiUrl: env.ENSPACK_KUBO_API ?? "" });
    const extraGw = env.ENSPACK_IPFS_GATEWAYS;
    const gateways =
      extraGw !== undefined && extraGw !== ""
        ? extraGw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : undefined;
    const store = createManifestStore({
      pinner,
      ...(gateways !== undefined ? { gateways } : {}),
    });
    const resolver = createResolver({ chain: "sepolia", rpcUrl: rpc, store });

    let version = "1.0.0";
    try {
      const existing = await resolver.resolve(MODEL, { chain: "sepolia" });
      if (existing.manifest !== null) {
        version = bumpPatch(existing.manifest.version);
      }
    } catch (err) {
      if (!isEnspackError(err) || (err.code !== "RESOLVE" && err.code !== "FETCH")) {
        throw err;
      }
    }

    const torrent = await createTorrent(fixtureDir, {
      name: "tiny-model",
      webseeds: ["https://example.invalid/tiny-model/"],
    });
    const torrentCid = await store.put(torrent.metainfo, "application/x-bittorrent");
    const files = fixtureFiles.map((name) => ({
      path: name,
      size: statSync(join(fixtureDir, name)).size,
      sha256: sha256File(join(fixtureDir, name)),
      role: fileRole(name),
    }));
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    const createdAt = new Date().toISOString();
    const versionName = `${versionLabel(version)}.${MODEL}`;
    const placeholderCid = `bafkrei${"p".repeat(52)}`;
    const first = validateManifest({
      spec: "enspack/0.1",
      name: versionName,
      model: MODEL,
      publisher: MIRROR,
      version,
      createdAt,
      displayName: "tiny-model",
      license: "apache-2.0",
      distribution: {
        infohash: torrent.infohash,
        magnet: magnetFor(torrent.infohash, "tiny-model"),
        torrent: { cid: torrentCid },
        webseeds: ["https://example.invalid/tiny-model/"],
      },
      files,
      totalSize,
      versions: [{ version, name: versionName, cid: placeholderCid, createdAt }],
    });
    const firstCid = await manifestCid(canonicalJson(first));
    const last = first.versions[first.versions.length - 1];
    if (last !== undefined) {
      last.cid = firstCid;
    }
    const manifest = validateManifest(first);
    const C = await store.put(canonicalJson(manifest), "application/json");
    const result = await createPublisher({ client, wallet, account }).publish({
      manifest,
      manifestCid: C,
      chain: "sepolia",
    });
    expect(result.txs.length).toBeGreaterThanOrEqual(2);
    publishedName = MODEL;
  });

  it("enspack get --json from a fresh HF_HOME, then verify", async () => {
    const hfHome = await mkdtemp(join(tmpdir(), "enspack-sepolia-hf-"));
    tmps.push(hfHome);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HF_HOME: hfHome,
    };
    const got = await spawnCli(
      ["get", publishedName, "--json", "--chain", "sepolia"],
      env,
      hfHome,
      300_000,
    );
    expect(got.code, got.stderr).toBe(0);
    const payload = lastJsonObject(got.stdout) as {
      name: string;
      cid: string | null;
      verified: boolean;
      installedPath: string;
    };
    expect(payload.verified).toBe(true);
    expect(payload.cid).not.toBeNull();
    expect(existsSync(payload.installedPath)).toBe(true);

    const verified = await spawnCli(
      ["verify", publishedName, payload.installedPath, "--json", "--chain", "sepolia"],
      env,
      hfHome,
    );
    expect(verified.code, verified.stderr).toBe(0);
    expect(lastJsonObject(verified.stdout)).toEqual({ ok: true });
  });
});
