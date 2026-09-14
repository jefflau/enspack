import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  EnspackError,
  type InstallTarget,
  type IpfsManifestStore,
  type Manifest,
  type Resolved,
  addToLock,
  assertLockMatch,
  fetchTorrentVerified,
  lockEntryFrom,
  lockKeyFor,
  matchesSelect,
  readLock,
  updateLock,
  writeLock,
} from "@enspack/core";
import { metainfoMatchesManifest, parseTorrent } from "@enspack/torrent";
import { human } from "./io.js";
import { createProgressWriter, rpcUrlFor, selectOf } from "./opts.js";
import type { CliDeps, CliVerifier, GetJson } from "./types.js";

export interface PipelineOptions {
  ref: string;
  dir?: string;
  select?: string[];
  httpOnly?: boolean;
  allowUnverified?: boolean;
  emitModelfile?: boolean;
  update?: boolean;
  save?: boolean;
  chain: "mainnet" | "sepolia";
  /** When set, used instead of `lockKeyFor(ref)` (install walks lock keys). */
  lockKey?: string;
  writeLock?: boolean;
  frozen?: boolean;
}

export interface PipelineResult extends GetJson {
  manifest: Manifest | null;
}

function absFromCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

async function dirFileCount(dir: string): Promise<{ files: number; totalSize: number }> {
  let files = 0;
  let totalSize = 0;
  const walk = async (root: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === ".enspack-staging" || name === ".enspack-quarantine") {
        continue;
      }
      const abs = join(root, name);
      const st = await stat(abs);
      if (st.isDirectory()) {
        await walk(abs);
      } else if (st.isFile()) {
        files += 1;
        totalSize += st.size;
      }
    }
  };
  await walk(dir);
  return { files, totalSize };
}

async function copyTree(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
}

async function quarantineTo(
  verifier: CliVerifier,
  staging: string,
  targetRoot: string,
  infohash: string,
  failures: { path: string; reason: "missing" | "size" | "sha256" }[],
): Promise<string> {
  const dest = join(targetRoot, ".enspack-quarantine", infohash);
  await mkdir(join(targetRoot, ".enspack-quarantine"), { recursive: true });
  await rm(dest, { recursive: true, force: true });
  if (typeof verifier.quarantine === "function") {
    const inner = await verifier.quarantine(staging, infohash, failures);
    try {
      await rename(inner, dest);
    } catch {
      await copyTree(inner, dest);
      await rm(inner, { recursive: true, force: true });
    }
    return dest;
  }
  try {
    await rename(staging, dest);
  } catch {
    await copyTree(staging, dest);
    await rm(staging, { recursive: true, force: true });
  }
  return dest;
}

function asIpfsStore(store: CliDeps["store"]): IpfsManifestStore {
  return store as IpfsManifestStore;
}

async function maybeWriteLockEntry(
  deps: CliDeps,
  opts: PipelineOptions,
  resolved: Resolved & { manifest: Manifest },
): Promise<void> {
  if (opts.writeLock === false || opts.frozen === true) {
    return;
  }
  const path = join(deps.cwd, "enspack.lock");
  const lock = await readLock(path);
  const key = opts.lockKey ?? lockKeyFor(opts.ref);
  const select = selectOf(opts.select);
  const entry = lockEntryFrom(resolved, select);
  if (lock.models[key] !== undefined) {
    await writeLock(updateLock(lock, key, entry), path);
    return;
  }
  if (opts.save === true) {
    await writeLock(addToLock(lock, key, entry), path);
  }
}

function magnetInfohash(magnet: string): string {
  const m = magnet.match(/xt=urn:btih:([0-9a-fA-F]{40})/i);
  const hex = m?.[1];
  if (hex === undefined) {
    throw new EnspackError("VERIFY", "magnet has no btih infohash");
  }
  return hex.toLowerCase();
}

/**
 * SPEC §4: resolve → lock → metainfo → download → verify → install.
 * Shared by `get` and `install`.
 */
export async function runPipeline(deps: CliDeps, opts: PipelineOptions): Promise<PipelineResult> {
  const chain = opts.chain;
  const rpcUrl = rpcUrlFor(chain, deps.env);
  const resolver = deps.resolverFactory(chain, rpcUrl);
  const resolved = await resolver.resolve(opts.ref, { chain });
  const lockPath = join(deps.cwd, "enspack.lock");
  const lock = await readLock(lockPath);

  if (resolved.cid !== null) {
    assertLockMatch(lock, resolved.name, resolved.cid, { update: opts.update === true });
  }

  if (resolved.cid === null || resolved.manifest === null) {
    if (opts.allowUnverified !== true) {
      throw new EnspackError(
        "VERIFY",
        `${resolved.name} has no contenthash (no manifest CID). Pass --allow-unverified to download via magnet with torrent-piece verification only.`,
      );
    }
    const magnet = resolved.magnet;
    if (magnet === null || magnet === "") {
      throw new EnspackError("RESOLVE", `${resolved.name} has no magnet`);
    }
    human(
      deps.stderr,
      "WARNING: downloading without a manifest CID; only torrent piece hashes will be checked. File SHA-256 verification is skipped.",
    );
    const infohash = magnetInfohash(magnet);
    const dest =
      opts.dir !== undefined ? absFromCwd(deps.cwd, opts.dir) : join(deps.cwd, resolved.name);
    await mkdir(dest, { recursive: true });
    const stub = {
      spec: "enspack/0.1",
      name: resolved.name,
      model: resolved.name,
      publisher: resolved.name,
      version: "0.0.0",
      createdAt: "1970-01-01T00:00:00Z",
      license: "unknown",
      distribution: {
        infohash,
        magnet,
        webseeds: [],
      },
      files: [{ path: ".enspack-unverified", size: 0, sha256: "0".repeat(64) }],
      totalSize: 0,
      versions: [
        {
          version: "0.0.0",
          name: resolved.name,
          cid: `bafkrei${"u".repeat(52)}`,
          createdAt: "1970-01-01T00:00:00Z",
        },
      ],
    } as unknown as Manifest;
    const fetchOpts: {
      httpOnly?: boolean;
      onProgress: ReturnType<typeof createProgressWriter>;
    } = { onProgress: createProgressWriter(deps.stderr) };
    if (opts.httpOnly === true) {
      fetchOpts.httpOnly = true;
    }
    await deps.downloader.fetch(stub, dest, fetchOpts);
    const counts = await dirFileCount(dest);
    return {
      name: resolved.name,
      node: resolved.node,
      cid: null,
      infohash,
      installedPath: dest,
      files: counts.files,
      totalSize: counts.totalSize,
      verified: false,
      manifest: null,
    };
  }

  const manifest = resolved.manifest;
  if (manifest.canonical !== undefined && manifest.canonical !== "") {
    human(deps.stderr, `a publisher-verified name exists: ${manifest.canonical}`);
  }

  const metainfo = await fetchTorrentVerified(asIpfsStore(deps.store), manifest, deps.fetch);
  if (metainfo !== null) {
    const parsed = await parseTorrent(metainfo);
    if (parsed.infohash !== manifest.distribution.infohash) {
      throw new EnspackError(
        "VERIFY",
        `torrent infohash ${parsed.infohash} !== manifest.distribution.infohash ${manifest.distribution.infohash}`,
      );
    }
    metainfoMatchesManifest(parsed, manifest);
  }

  const infohash = manifest.distribution.infohash;
  const installTarget: InstallTarget =
    opts.dir !== undefined
      ? { kind: "dir", path: absFromCwd(deps.cwd, opts.dir) }
      : deps.env.HF_HOME !== undefined && deps.env.HF_HOME !== ""
        ? { kind: "hf-cache", hfHome: deps.env.HF_HOME }
        : { kind: "hf-cache" };

  const staging =
    installTarget.kind === "dir"
      ? join(installTarget.path, ".enspack-staging", infohash)
      : join(tmpdir(), `enspack-${infohash}-${process.pid}`);
  await mkdir(staging, { recursive: true });

  const select = selectOf(opts.select);
  const fetchOpts: {
    select?: string[];
    httpOnly?: boolean;
    onProgress: ReturnType<typeof createProgressWriter>;
    metainfo?: Uint8Array;
  } = { onProgress: createProgressWriter(deps.stderr) };
  if (select !== undefined) {
    fetchOpts.select = select;
  }
  if (opts.httpOnly === true) {
    fetchOpts.httpOnly = true;
  } else if (metainfo !== null) {
    fetchOpts.metainfo = metainfo;
  }

  try {
    await deps.downloader.fetch(manifest, staging, fetchOpts);
  } catch (cause) {
    if (cause instanceof EnspackError) {
      throw cause;
    }
    throw new EnspackError("DOWNLOAD", "download failed", cause);
  }

  const verified = await deps.verifier.verify(manifest, staging, select);
  if (!verified.ok) {
    const targetRoot = installTarget.kind === "dir" ? installTarget.path : tmpdir();
    await mkdir(targetRoot, { recursive: true });
    const quarantined = await quarantineTo(
      deps.verifier,
      staging,
      targetRoot,
      infohash,
      verified.failures,
    );
    for (const f of verified.failures) {
      human(deps.stderr, `${f.path}: ${f.reason}`);
    }
    throw new EnspackError(
      "VERIFY",
      `verification failed (${verified.failures.map((f) => f.path).join(", ")}); quarantined to ${quarantined}`,
    );
  }

  const installOpts =
    select !== undefined
      ? { ...installTarget, select, move: true as const }
      : { ...installTarget, move: true as const };
  const { path: installedPath } = await deps.installer.install(manifest, staging, installOpts);
  await rm(staging, { recursive: true, force: true }).catch(() => undefined);

  if (opts.emitModelfile === true && deps.installer.emitModelfile !== undefined) {
    await deps.installer.emitModelfile(manifest, installedPath, select);
  }

  if (deps.installer.readyToRunLines !== undefined) {
    for (const line of deps.installer.readyToRunLines(manifest, installedPath, installTarget)) {
      human(deps.stderr, line);
    }
  }

  const selectedFiles = manifest.files.filter((f) => matchesSelect(f.path, select));

  await maybeWriteLockEntry(deps, opts, { ...resolved, manifest, cid: resolved.cid });

  return {
    name: resolved.name,
    node: resolved.node,
    cid: resolved.cid,
    infohash,
    installedPath,
    files: selectedFiles.length,
    totalSize: selectedFiles.reduce((s, f) => s + f.size, 0),
    verified: true,
    manifest,
  };
}
