import {
  MIRROR_NAMESPACE,
  type Manifest,
  type ManifestFile,
  SPEC_STRING,
  canonicalJson,
} from "@enspack/core";
import { magnetFor } from "@enspack/torrent";
import { PLACEHOLDER_CID, PLACEHOLDER_INFOHASH, PLACEHOLDER_MAGNET } from "./constants.js";
import { canonicalNameFor, modelNameFor, versionNameFor } from "./names.js";

function hasLicenseFile(files: ManifestFile[]): boolean {
  return files.some((f) => {
    const base = (f.path.split("/").pop() ?? f.path).toLowerCase();
    return base === "license" || base.startsWith("license.") || f.role === "license";
  });
}

export interface AssembleInput {
  org: string;
  repoName: string;
  repo: string;
  revision: string;
  license: string;
  displayName: string;
  files: ManifestFile[];
  infohash: string;
  magnet: string;
  torrentCid: string;
  webseeds: string[];
  version: string;
  createdAt: string;
  previousVersions?: Manifest["versions"];
  previous?: string;
  hb?: string;
}

/**
 * SPEC §3 / BOOTSTRAP.md §5 step 6: assemble a mirror manifest under `mirrors.enspack.eth`.
 */
export function assembleManifest(input: AssembleInput): Manifest {
  const model = modelNameFor(input.org, input.repoName);
  const name = versionNameFor(input.version, input.org, input.repoName);
  const totalSize = input.files.reduce((sum, f) => sum + f.size, 0);
  const thisVersion = {
    version: input.version,
    name,
    cid: PLACEHOLDER_CID,
    createdAt: input.createdAt,
  };
  const versions =
    input.previousVersions !== undefined ? [...input.previousVersions, thisVersion] : [thisVersion];

  const distribution: Manifest["distribution"] = {
    infohash: input.infohash,
    magnet: input.magnet,
    torrent: { cid: input.torrentCid },
    webseeds: input.webseeds,
  };
  if (input.hb !== undefined) distribution.hb = input.hb;

  const manifest: Manifest = {
    spec: SPEC_STRING,
    name,
    model,
    publisher: MIRROR_NAMESPACE,
    version: input.version,
    createdAt: input.createdAt,
    displayName: input.displayName,
    license: input.license,
    upstream: {
      provider: "huggingface",
      repo: input.repo,
      url: `https://huggingface.co/${input.repo}`,
      revision: input.revision,
    },
    canonical: canonicalNameFor(input.org, input.repoName),
    distribution,
    files: input.files as Manifest["files"],
    totalSize,
    versions: versions as Manifest["versions"],
  };
  if (hasLicenseFile(input.files)) {
    manifest.licenseUrl = `https://huggingface.co/${input.repo}/blob/${input.revision}/LICENSE`;
  }
  if (input.previous !== undefined) {
    manifest.previous = input.previous;
  }
  return manifest;
}

/** SPEC §4 step 7c: draft used only to drive `Aria2Downloader` (`httpOnly`). */
export function draftManifestForDownload(
  files: ManifestFile[],
  webseeds: string[],
  name: string,
  model: string,
): Manifest {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const createdAt = "2026-01-01T00:00:00Z";
  return {
    spec: SPEC_STRING,
    name,
    model,
    publisher: MIRROR_NAMESPACE,
    version: "0.0.0",
    createdAt,
    license: "mit",
    distribution: {
      infohash: PLACEHOLDER_INFOHASH,
      magnet: PLACEHOLDER_MAGNET,
      webseeds,
    },
    files: files as Manifest["files"],
    totalSize,
    versions: [{ version: "0.0.0", name, cid: PLACEHOLDER_CID, createdAt }],
  };
}

export function magnetForInfohash(infohash: string, displayName: string): string {
  return magnetFor(infohash, displayName);
}

export { canonicalJson };
