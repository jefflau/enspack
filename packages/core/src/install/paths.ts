import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { EnspackError } from "../error.js";
import { hfCacheRepoDir } from "../hf-cache.js";
import type { Manifest } from "../types.js";

/**
 * SPEC §5: snapshot folder name is `upstream.revision` when present; otherwise
 * `"enspack-" + distribution.infohash` so a host-less manifest still has a
 * deterministic HF-cache revision.
 */
export function snapshotRevision(m: Manifest): string {
  const rev = m.upstream?.revision;
  if (rev !== undefined && rev !== "") {
    return rev;
  }
  return `enspack-${m.distribution.infohash}`;
}

/**
 * SPEC §5: Hugging Face home directory (`HF_HOME`), defaulting to
 * `~/.cache/huggingface`.
 */
export function resolveHfHome(hfHome?: string): string {
  if (hfHome !== undefined && hfHome !== "") {
    return hfHome;
  }
  const env = process.env.HF_HOME;
  if (env !== undefined && env !== "") {
    return env;
  }
  return resolve(homedir(), ".cache/huggingface");
}

/**
 * SPEC §5: `$HF_HOME/hub/models--{org}--{repo}` (or `models--enspack--{label}`).
 */
export function hfCacheRepoRoot(m: Manifest, hfHome?: string): string {
  return resolve(resolveHfHome(hfHome), "hub", hfCacheRepoDir(m));
}

/**
 * SPEC §3 / §5: refuse `files[].path` that would escape `root` (absolute, `..`,
 * empty segments, NUL). Schema already forbids this; re-check anyway.
 */
export function resolveSafeInstallPath(root: string, rel: string): string {
  if (
    rel === "" ||
    rel.includes("\0") ||
    rel.includes("\\") ||
    isAbsolute(rel) ||
    rel.startsWith("/")
  ) {
    throw new EnspackError("VERIFY", `files[].path escapes the install directory: ${rel}`);
  }
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new EnspackError("VERIFY", `files[].path escapes the install directory: ${rel}`);
  }
  const abs = resolve(root, ...parts);
  const relToRoot = relative(root, abs);
  if (relToRoot === "" || relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
    throw new EnspackError("VERIFY", `files[].path escapes the install directory: ${rel}`);
  }
  return abs;
}
