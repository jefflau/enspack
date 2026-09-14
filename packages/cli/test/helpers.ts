import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EnspackError,
  type Manifest,
  type Publisher,
  type Resolved,
  canonicalJson,
  createInstaller,
  manifestCid,
  namehashOf,
  parseRef,
  validateManifest,
} from "@enspack/core";
import { licenseGate } from "@enspack/hf";
import { Sha256Verifier } from "@enspack/torrent";
import { createCli } from "../src/index.js";
import type { CliDeps, CliHf, Writer } from "../src/types.js";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const fixtureDir = join(repoRoot, "test/fixtures/tiny-model");
export const fixtureManifestPath = join(repoRoot, "test/fixtures/tiny-model.enspack.json");
export const fixtureTorrentPath = join(repoRoot, "test/fixtures/tiny-model.torrent");
export const fixtureFiles = ["config.json", "model.safetensors", "tokenizer.json"] as const;

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function loadFixtureManifest(): Manifest {
  return validateManifest(JSON.parse(readFileSync(fixtureManifestPath, "utf8")));
}

export async function loadTorrentBytes(): Promise<Uint8Array> {
  return readFile(fixtureTorrentPath);
}

export function capturingWriter(): Writer & { text: () => string } {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
    },
    text: () => chunks.join(""),
  };
}

export async function copyFixture(dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const name of fixtureFiles) {
    await copyFile(join(fixtureDir, name), join(dest, name));
  }
}

export function fakeResolver(
  manifest: Manifest,
  cid: string,
  nameOverride?: string,
): CliDeps["resolverFactory"] {
  return () => ({
    async resolve(ref: string): Promise<Resolved> {
      const name = nameOverride ?? parseRef(ref).name;
      return {
        name,
        node: namehashOf(name),
        cid,
        magnet: manifest.distribution.magnet,
        spec: manifest.spec,
        manifest,
        manifestBytes: canonicalJson(manifest),
      };
    },
  });
}

export function magnetOnlyResolver(name: string, magnet: string): CliDeps["resolverFactory"] {
  return () => ({
    async resolve(): Promise<Resolved> {
      return {
        name,
        node: namehashOf(name),
        cid: null,
        magnet,
        spec: "enspack/0.1",
        manifest: null,
        manifestBytes: null,
      };
    },
  });
}

export function throwingResolver(
  code: "RESOLVE" | "FETCH",
  message: string,
): CliDeps["resolverFactory"] {
  return () => ({
    async resolve(): Promise<Resolved> {
      throw new EnspackError(code, message);
    },
  });
}

export function fakeStore(manifest: Manifest, torrentBytes: Uint8Array) {
  const torrentCid = manifest.distribution.torrent?.cid;
  return {
    async getVerified(cid: string): Promise<Uint8Array> {
      if (torrentCid !== undefined && cid === torrentCid) {
        return torrentBytes;
      }
      return canonicalJson(manifest);
    },
    async put(bytes: Uint8Array): Promise<string> {
      return manifestCid(bytes);
    },
  };
}

export function copyDownloader() {
  return {
    async fetch(_m: Manifest, dest: string): Promise<void> {
      await copyFixture(dest);
    },
  };
}

export function stubHf(): CliHf {
  return {
    async info() {
      return {
        gated: false,
        private: false,
        license: "apache-2.0",
        sha: "a".repeat(40),
        cardData: { license: "apache-2.0" },
      };
    },
    async resolveRevision() {
      return "a".repeat(40);
    },
    async buildFiles() {
      return [];
    },
    licenseGate: (license, opts) => licenseGate(license, opts),
    huggingBay: {
      async resolve() {
        return null;
      },
      async lock() {
        return { files: [], raw: {} };
      },
      async submitFallback() {
        return {};
      },
    },
  };
}

export function stubPublisher(
  result?: Partial<Awaited<ReturnType<Publisher["publish"]>>>,
): Publisher {
  return {
    async publish(input) {
      return {
        name: input.manifest.name,
        model: input.manifest.model,
        cid: input.manifestCid,
        txs: input.dryRun === true ? [] : ["0xabc"],
        calls: [
          {
            to: "0x0000000000000000000000000000000000000001",
            data: "0x",
            description: "multicall",
            gas: 123456n,
          },
        ],
        created: { model: true, version: true },
        ...result,
      };
    },
  };
}

export async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "enspack-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runCli(
  deps: CliDeps,
  argv: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = capturingWriter();
  const stderr = capturingWriter();
  const { run } = createCli({ deps: { ...deps, stdout, stderr } });
  const code = await run(["node", "enspack", ...argv]);
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

export async function baseDeps(tmp: string): Promise<{
  deps: CliDeps;
  manifest: Manifest;
  cid: string;
}> {
  const manifest = loadFixtureManifest();
  const cid = await manifestCid(canonicalJson(manifest));
  const torrentBytes = await loadTorrentBytes();
  const hfHome = join(tmp, "hf");
  const deps: CliDeps = {
    resolverFactory: fakeResolver(manifest, cid),
    store: fakeStore(manifest, torrentBytes),
    downloader: copyDownloader(),
    verifier: new Sha256Verifier(),
    installer: createInstaller(),
    hf: stubHf(),
    publisherFactory: () => stubPublisher(),
    stdout: capturingWriter(),
    stderr: capturingWriter(),
    env: { ETH_RPC_URL: "http://127.0.0.1:1", HF_HOME: hfHome },
    cwd: tmp,
    now: () => new Date("2026-09-14T00:00:00.000Z"),
    fetch: async () => new Response("{}", { status: 404 }),
  };
  return { deps, manifest, cid };
}
