import { labelhash, namehash, normalize } from "viem/ens";
import { EnspackError } from "./error.js";

/** SPEC §1.3: ref parsed into the ENS name to resolve and optional version. */
export interface ParsedRef {
  name: string;
  version?: string;
}

/**
 * SPEC §1.2: lowercase, replace non `[a-z0-9-]` with `-`, collapse `-` runs, trim edges.
 */
export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * SPEC §1.2: normalize org and repo separately, join with `--` (collapse never crosses the join).
 */
export function mirrorLabel(org: string, repo: string): string {
  return `${normalizeLabel(org)}--${normalizeLabel(repo)}`;
}

/**
 * SPEC §1.2: version labels are `v` + semver with `.` → `-`.
 */
export function versionLabel(semver: string): string {
  return `v${semver.replace(/\./g, "-")}`;
}

/**
 * SPEC §1.2: true when `label` looks like a version label (`vMAJOR-MINOR-PATCH…`).
 */
export function isVersionLabel(label: string): boolean {
  return /^v\d+(?:-\d+){2}(?:-[0-9a-z]+)*$/.test(label);
}

/**
 * SPEC §1.3 / §4 step 1: parse a client ref; fail closed if any label is changed by normalize().
 */
export function parseRef(ref: string): ParsedRef {
  const trimmed = ref.trim();
  if (trimmed === "") {
    throw new EnspackError("RESOLVE", "empty ref");
  }

  const at = trimmed.lastIndexOf("@");
  let name: string;
  let version: string | undefined;
  if (at >= 0) {
    const namePart = trimmed.slice(0, at);
    const versionPart = trimmed.slice(at + 1);
    if (namePart === "" || versionPart === "") {
      throw new EnspackError("RESOLVE", `invalid ref "${ref}"`);
    }
    name = `${versionLabel(versionPart)}.${namePart}`;
    version = versionPart;
  } else {
    name = trimmed;
  }

  const labels = name.split(".");
  if (labels.length < 2) {
    throw new EnspackError("RESOLVE", `name "${name}" has fewer than 2 labels`);
  }

  for (const label of labels) {
    if (label === "") {
      throw new EnspackError("RESOLVE", `name "${name}" contains an empty label`);
    }
    let normalized: string;
    try {
      normalized = normalize(label);
    } catch (cause) {
      throw new EnspackError("RESOLVE", `label "${label}" failed ENS normalization`, cause);
    }
    if (normalized !== label) {
      throw new EnspackError(
        "RESOLVE",
        `normalization changes label "${label}" to "${normalized}"`,
      );
    }
  }

  if (version !== undefined) {
    return { name, version };
  }
  return { name };
}

/**
 * SPEC §2.3: `namehash(manifest.name)` is compared to the on-chain event node.
 */
export function namehashOf(name: string): `0x${string}` {
  return namehash(name);
}

/**
 * SPEC §7 / §8: `labelhash(label)` is the subnode key passed to the registry.
 */
export function labelhashOf(label: string): `0x${string}` {
  return labelhash(label);
}
