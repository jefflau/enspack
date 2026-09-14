import { canonicalJson, isEnspackError, type Manifest, validateManifest } from "@enspack/core";
import type { BootstrapDeps } from "../deps.js";
import { assembleManifest } from "../manifest.js";
import { bumpMinor, modelNameFor, versionNameFor } from "../names.js";
import type { EntrySnapshot, ModelEntry, StepOutcome } from "../types.js";

/**
 * BOOTSTRAP.md §5 step 6 / SPEC §8 steps 3–4: pin `.torrent`, assemble and pin the manifest.
 */
export async function stepPin(
  entry: ModelEntry,
  snap: EntrySnapshot,
  deps: Pick<BootstrapDeps, "store" | "resolver" | "now" | "hfWebseed">,
  chain: "mainnet" | "sepolia",
): Promise<StepOutcome> {
  const torrentB64 = snap.torrentB64;
  const files = snap.files;
  const revision = snap.revision;
  const license = snap.license;
  const infohash = snap.infohash;
  const magnet = snap.magnet;
  const webseeds = snap.webseeds;
  if (
    torrentB64 === undefined ||
    files === undefined ||
    revision === undefined ||
    license === undefined ||
    infohash === undefined ||
    magnet === undefined ||
    webseeds === undefined
  ) {
    return { outcome: "failed", reason: "pin requires torrent, files, revision, license, magnet" };
  }

  const modelName = modelNameFor(snap.org, snap.repoName);
  let version = "1.0.0";
  let previousVersions: Manifest["versions"] | undefined;
  let previous: string | undefined;
  try {
    const resolved = await deps.resolver.resolve(modelName, { chain });
    if (resolved.manifest !== null && resolved.cid !== null) {
      previousVersions = resolved.manifest.versions;
      previous = resolved.cid;
      const last = resolved.manifest.versions[resolved.manifest.versions.length - 1];
      version = bumpMinor(last?.version ?? resolved.manifest.version);
    }
  } catch (err) {
    if (!isEnspackError(err) || err.code !== "RESOLVE") {
      throw err;
    }
  }

  const torrentBytes = Buffer.from(torrentB64, "base64");
  const torrentCid = await deps.store.put(
    new Uint8Array(torrentBytes),
    "application/x-bittorrent",
  );

  let hb: string | undefined;
  if (snap.hbDigest !== undefined && /^[0-9a-f]{64}$/.test(snap.hbDigest)) {
    hb = `hb://${entry.repo}@sha256:${snap.hbDigest}`;
  }

  const createdAt = deps.now();
  const assemble: Parameters<typeof assembleManifest>[0] = {
    org: snap.org,
    repoName: snap.repoName,
    repo: entry.repo,
    revision,
    license,
    displayName: snap.repoName,
    files,
    infohash,
    magnet,
    torrentCid,
    webseeds,
    version,
    createdAt,
  };
  if (previousVersions !== undefined) assemble.previousVersions = previousVersions;
  if (previous !== undefined) assemble.previous = previous;
  if (hb !== undefined) assemble.hb = hb;

  const manifest = assembleManifest(assemble);
  validateManifest(manifest);
  const bytes = canonicalJson(manifest);
  const manifestCid = await deps.store.put(bytes, "application/json");

  const data: Partial<EntrySnapshot> = {
    torrentCid,
    manifestCid,
    version,
    versionName: versionNameFor(version, snap.org, snap.repoName),
    modelName,
  };
  if (previous !== undefined) data.previous = previous;
  data.manifest = manifest;
  return { outcome: "ok", data };
}
