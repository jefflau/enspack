import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  EnspackError,
  type Manifest,
  type ManifestStore,
  canonicalJson,
  encodeIpfsContenthash,
  manifestCid,
  namehashOf,
  validateManifest,
} from "@enspack/core";

const FIXTURE = fileURLToPath(
  new URL("../../../test/fixtures/tiny-model.enspack.json", import.meta.url),
);

export type BuiltManifest = {
  manifest: Manifest;
  bytes: Uint8Array;
  cid: string;
  versionNode: `0x${string}`;
  modelNode: `0x${string}`;
  publisherNode: `0x${string}`;
};

export async function buildManifest(opts?: {
  publisher?: string;
  modelLabel?: string;
  version?: string;
  displayName?: string;
  upstream?: Manifest["upstream"];
}): Promise<BuiltManifest> {
  const base = JSON.parse(await readFile(FIXTURE, "utf8")) as Manifest;
  const publisher = opts?.publisher ?? base.publisher;
  const model = `${opts?.modelLabel ?? "tiny-model"}.${publisher}`;
  const version = opts?.version ?? base.version;
  const name = `v1-0-0.${model}`;
  const lastCid = base.versions[0]?.cid;
  if (lastCid === undefined) {
    throw new Error("fixture missing versions[0].cid");
  }
  const draft: Manifest = {
    ...base,
    name,
    model,
    publisher,
    version,
    versions: [{ version, name, cid: lastCid, createdAt: base.createdAt }],
  };
  if (opts?.displayName !== undefined) {
    draft.displayName = opts.displayName;
  }
  if (opts?.upstream !== undefined) {
    draft.upstream = opts.upstream;
  }
  const manifest = validateManifest(draft);
  const bytes = canonicalJson(manifest);
  const cid = await manifestCid(bytes);
  return {
    manifest,
    bytes,
    cid,
    versionNode: namehashOf(manifest.name),
    modelNode: namehashOf(manifest.model),
    publisherNode: namehashOf(manifest.publisher),
  };
}

export function fakeStore(map: Map<string, Uint8Array>, failCid?: string): ManifestStore {
  return {
    async getVerified(cid) {
      if (failCid !== undefined && cid === failCid) {
        throw new EnspackError("FETCH", "hash mismatch");
      }
      const bytes = map.get(cid);
      if (bytes === undefined) {
        throw new EnspackError("FETCH", `no bytes for ${cid}`);
      }
      return bytes;
    },
    async put() {
      throw new EnspackError("PUBLISH", "not implemented");
    },
  };
}

export function ipfsHash(cid: string): `0x${string}` {
  return encodeIpfsContenthash(cid);
}

export const TX_A = `0x${"11".repeat(32)}` as `0x${string}`;
export const TX_B = `0x${"22".repeat(32)}` as `0x${string}`;
export const TX_C = `0x${"33".repeat(32)}` as `0x${string}`;
export const RESOLVER = `0x${"44".repeat(20)}` as `0x${string}`;
