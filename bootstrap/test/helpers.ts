import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EnspackError,
  type Manifest,
  type ManifestFile,
  type PublishInput,
  type PublishResult,
  type Resolved,
  SPEC_STRING,
  manifestCid,
  namehashOf,
  validateManifest,
} from "@enspack/core";
import { type HbLock, type HfModelInfo, type HfTreeEntry, fileRole } from "@enspack/hf";
import type { BootstrapDeps, BootstrapHf, SeedNode } from "../src/deps.js";
import type { ModelsConfig } from "../src/types.js";
import { parseModelsYaml } from "../src/yaml.js";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const fixtureDir = join(repoRoot, "test/fixtures/tiny-model");
export const fixtureManifestPath = join(repoRoot, "test/fixtures/tiny-model.enspack.json");
export const modelsYamlPath = fileURLToPath(new URL("./fixtures/models.yaml", import.meta.url));

export const TINY_REPO = "enspack/tiny-model";
export const TINY_SHORT = "abcdef12";
export const TINY_SHA = "abcdef1200000000000000000000000000000000";
export const ZERO_ADDR = "0x0000000000000000000000000000000000000001" as const;
export const TX = `0x${"ab".repeat(32)}` as `0x${string}`;

export function silentLog(): BootstrapDeps["log"] {
  return { info() {}, warn() {} };
}

export function loadFixtureManifest(): Manifest {
  return JSON.parse(readFileSync(fixtureManifestPath, "utf8")) as Manifest;
}

export function loadTinyFiles(): { path: string; bytes: Buffer; sha256: string; size: number }[] {
  const names = ["config.json", "model.safetensors", "tokenizer.json"];
  return names.map((path) => {
    const bytes = readFileSync(join(fixtureDir, path));
    return {
      path,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength,
    };
  });
}

export function tinyModelFiles(): ManifestFile[] {
  return loadTinyFiles().map((f) => ({
    path: f.path,
    size: f.size,
    sha256: f.sha256,
    role: fileRole(f.path),
  }));
}

export function loadModels(): ModelsConfig {
  return parseModelsYaml(readFileSync(modelsYamlPath, "utf8"));
}

export function fakeHf(overrides: Partial<HfModelInfo> & { sha?: string } = {}): BootstrapHf {
  const files = loadTinyFiles();
  const sha = overrides.sha ?? TINY_SHA;
  const info: HfModelInfo = {
    gated: overrides.gated ?? false,
    private: overrides.private ?? false,
    license: overrides.license === undefined ? "apache-2.0" : overrides.license,
    sha,
    cardData: { license: overrides.license === undefined ? "apache-2.0" : overrides.license },
  };
  return {
    async info() {
      return info;
    },
    async resolveRevision() {
      return sha;
    },
    async tree(): Promise<HfTreeEntry[]> {
      return files.map((f) => ({ path: f.path, size: f.size, oid: f.sha256 }));
    },
    async buildFiles(): Promise<ManifestFile[]> {
      return tinyModelFiles();
    },
  };
}

export function recordingPublisher(publishes: PublishInput[]): BootstrapDeps["publisher"] {
  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      publishes.push(input);
      const gas = 100_000n;
      const calls = input.dryRun
        ? [
            { to: ZERO_ADDR, data: "0x" as `0x${string}`, description: "setSubnodeRecord", gas },
            { to: ZERO_ADDR, data: "0x" as `0x${string}`, description: "setSubnodeRecord", gas },
            { to: ZERO_ADDR, data: "0x" as `0x${string}`, description: "multicall", gas },
          ]
        : [];
      return {
        name: input.manifest.name,
        model: input.manifest.model,
        cid: input.manifestCid,
        txs: input.dryRun ? [] : [TX],
        calls,
        created: { model: true, version: true },
      };
    },
  };
}

export function emptyHb(): BootstrapDeps["hb"] {
  return {
    async resolve() {
      return null;
    },
    async lock(): Promise<HbLock> {
      return { files: [], raw: {} };
    },
    async submitFallback() {
      return {};
    },
  };
}

export function disagreeingHb(): BootstrapDeps["hb"] {
  return {
    async resolve() {
      return {
        id: "hf-model-enspack-tiny-model",
        repo: TINY_REPO,
        digest: "aa".repeat(32),
        raw: {},
      };
    },
    async lock(): Promise<HbLock> {
      return {
        files: [{ path: "config.json", size: 1, sha256: "ff".repeat(32) }],
        raw: {},
      };
    },
    async submitFallback() {
      throw new Error("should not submit");
    },
  };
}

export function throwingNetwork(name: string): never {
  throw new Error(`unexpected network: ${name}`);
}

export async function fakeStore(): Promise<{
  store: BootstrapDeps["store"];
  puts: Uint8Array[];
}> {
  const puts: Uint8Array[] = [];
  return {
    puts,
    store: {
      async put(bytes: Uint8Array) {
        puts.push(bytes);
        return manifestCid(bytes);
      },
      async getVerified() {
        throw new Error("unused");
      },
    },
  };
}

export function resolverThatThrows(): BootstrapDeps["resolver"] {
  return {
    async resolve(ref) {
      throw new EnspackError("RESOLVE", `unresolved ${ref}`);
    },
  };
}

export function confirmingResolver(getCid: () => string | null): BootstrapDeps["resolver"] {
  return {
    async resolve(ref): Promise<Resolved> {
      const cid = getCid();
      if (cid === null) {
        throw new EnspackError("RESOLVE", `unresolved ${ref}`);
      }
      return {
        name: ref,
        node: namehashOf(ref),
        cid,
        magnet: null,
        spec: SPEC_STRING,
        manifest: null,
        manifestBytes: null,
      };
    },
  };
}

export function startWebseed(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
      const abs = normalize(join(root, rel));
      const relToRoot = relative(root, abs);
      if (relToRoot.startsWith("..") || relToRoot.split(sep).includes("..")) {
        res.statusCode = 403;
        res.end();
        return;
      }
      try {
        const buf = readFileSync(abs);
        res.statusCode = 200;
        res.setHeader("Content-Length", buf.length);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(buf);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () =>
          new Promise((r, j) => {
            server.close((err) => (err ? j(err) : r()));
          }),
      });
    });
  });
}

export function startFakeSeed(): Promise<{
  url: string;
  close: () => Promise<void>;
  names: string[];
}> {
  const names: string[] = [];
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "POST" && u.pathname === "/v1/seed") {
        let body = "";
        req.on("data", (c) => {
          body += c;
        });
        req.on("end", () => {
          const parsed = JSON.parse(body) as { name?: string };
          if (parsed.name !== undefined) names.push(parsed.name);
          res.statusCode = 202;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ infohash: "00".repeat(20), state: "downloading" }));
        });
        return;
      }
      if (req.method === "GET" && u.pathname.startsWith("/v1/status/")) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ state: "seeding", progress: 1, peers: 1, uploaded: 0 }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        names,
        close: () =>
          new Promise((r, j) => {
            server.close((err) => (err ? j(err) : r()));
          }),
      });
    });
  });
}

export function seedClientFrom(server: { url: string }): SeedNode {
  return {
    async seed(name: string) {
      const res = await fetch(`${server.url}/v1/seed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as { infohash: string; state: string };
      return body;
    },
    async status(infohash: string) {
      const res = await fetch(`${server.url}/v1/status/${infohash}`);
      return (await res.json()) as { progress: number; state: string };
    },
  };
}

export { validateManifest };
