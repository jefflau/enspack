import { EnspackError, mirrorLabel, normalizeLabel, versionLabel } from "@enspack/core";
import { MIRROR_NAMESPACE } from "@enspack/core";

/**
 * SPEC §1.2 / BOOTSTRAP.md §1: split `org/repo` for mirror labels.
 */
export function splitRepo(repo: string): { org: string; repoName: string } {
  const i = repo.indexOf("/");
  if (i <= 0 || i === repo.length - 1) {
    throw new EnspackError("VERIFY", `invalid HF repo "${repo}"`);
  }
  if (repo.indexOf("/", i + 1) !== -1) {
    throw new EnspackError("VERIFY", `invalid HF repo "${repo}"`);
  }
  return { org: repo.slice(0, i), repoName: repo.slice(i + 1) };
}

/** SPEC §1.1: `<org>--<repo>.mirrors.enspack.eth`. */
export function modelNameFor(org: string, repoName: string): string {
  return `${mirrorLabel(org, repoName)}.${MIRROR_NAMESPACE}`;
}

/** SPEC §1.2: `v<semver>.<model>.mirrors.enspack.eth`. */
export function versionNameFor(version: string, org: string, repoName: string): string {
  return `${versionLabel(version)}.${modelNameFor(org, repoName)}`;
}

/** BOOTSTRAP.md §1 / SPEC §3: `canonical` reserved for the real publisher. */
export function canonicalNameFor(org: string, repoName: string): string {
  return `${normalizeLabel(repoName)}.${normalizeLabel(org)}.enspack.eth`;
}

/** BOOTSTRAP.md §5 step 3: download directory name `<org>--<repo>`. */
export function downloadDirName(org: string, repoName: string): string {
  return `${org}--${repoName}`;
}

/** BOOTSTRAP.md §5: a new upstream revision becomes 1.1.0, 1.2.0, … never an overwrite. */
export function bumpMinor(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (m === null || m[1] === undefined || m[2] === undefined) {
    return "1.1.0";
  }
  return `${m[1]}.${Number(m[2]) + 1}.0`;
}
