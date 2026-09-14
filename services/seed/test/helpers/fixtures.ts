import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Manifest,
  type Resolved,
  canonicalJson,
  manifestCid,
  namehashOf,
  validateManifest,
} from "@enspack/core";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const fixtureManifestPath = join(repoRoot, "test/fixtures/tiny-model.enspack.json");
export const fixtureTorrentPath = join(repoRoot, "test/fixtures/tiny-model.torrent");

export interface TinyFixture {
  manifest: Manifest;
  manifestBytes: Uint8Array;
  cid: string;
  torrentBytes: Uint8Array;
  torrentCid: string;
  infohash: string;
  resolved: Resolved;
}

export async function loadTinyFixture(overrides?: {
  name?: string;
  model?: string;
  publisher?: string;
  license?: string;
}): Promise<TinyFixture> {
  const torrentBytes = new Uint8Array(readFileSync(fixtureTorrentPath));
  const torrentCid = await manifestCid(torrentBytes);
  const raw = JSON.parse(readFileSync(fixtureManifestPath, "utf8")) as Manifest;
  const name = overrides?.name ?? raw.name;
  const model = overrides?.model ?? raw.model;
  const publisher = overrides?.publisher ?? raw.publisher;
  const license = overrides?.license ?? raw.license;
  const obj = {
    ...raw,
    name,
    model,
    publisher,
    license,
    distribution: {
      ...raw.distribution,
      torrent: { cid: torrentCid },
    },
    versions: raw.versions.map((v, i, arr) => (i === arr.length - 1 ? { ...v, name } : v)),
  };
  const manifestBytes = canonicalJson(obj);
  const manifest = validateManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));
  const cid = await manifestCid(manifestBytes);
  const resolved: Resolved = {
    name,
    node: namehashOf(name),
    cid,
    magnet: manifest.distribution.magnet,
    spec: manifest.spec,
    manifest,
    manifestBytes,
  };
  return {
    manifest,
    manifestBytes,
    cid,
    torrentBytes,
    torrentCid,
    infohash: manifest.distribution.infohash,
    resolved,
  };
}
