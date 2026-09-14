import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnspackError } from "@enspack/core";
import type { Downloader, Manifest, Progress } from "@enspack/core";
import { httpFallbackSources } from "./http-fallback.js";
import { checkMagnet, injectWebseeds, parseTorrent } from "./metainfo.js";
import type { ParsedTorrent } from "./metainfo.js";
import { nodeSpawn, runAria2 } from "./run.js";
import type { RunAria2Options, SpawnImpl } from "./run.js";
import { isSelectAll, matchesSelect } from "./select.js";
import { stripTorrentTopDir } from "./walk.js";

/** SPEC §4 step 7: constructor options for the aria2c-backed Downloader. */
export interface Aria2DownloaderOptions {
  aria2cPath?: string;
  env?: NodeJS.ProcessEnv;
  dht?: boolean;
  btStopTimeout?: number;
  seedTime?: number;
  maxConnections?: number;
  extraArgs?: string[];
  onLine?: (line: string) => void;
  /** Test hook: inject spawn. Never used as a shell. */
  spawnImpl?: SpawnImpl;
}

/** SPEC §4 step 7: extra fetch options beyond MVP.md `Downloader.fetch`. */
export interface FetchOptions {
  select?: string[];
  httpOnly?: boolean;
  onProgress?: (p: Progress) => void;
  /** SPEC §4 step 7a: verified metainfo bytes (from `distribution.torrent`). */
  metainfo?: Uint8Array;
  webseeds?: string[];
  signal?: AbortSignal;
}

function selectFileArg(parsed: ParsedTorrent, select: string[] | undefined): string | undefined {
  if (isSelectAll(select)) return undefined;
  const indexes: number[] = [];
  for (let i = 0; i < parsed.files.length; i++) {
    const file = parsed.files[i];
    if (file === undefined) continue;
    const rel = stripTorrentTopDir(file.path, parsed.name);
    if (matchesSelect(rel, select)) {
      indexes.push(i + 1);
    }
  }
  if (indexes.length === 0) {
    throw new EnspackError("VERIFY", `no torrent files matched select ${JSON.stringify(select)}`);
  }
  return indexes.join(",");
}

async function flattenTopDir(dest: string, topName: string): Promise<void> {
  const top = join(dest, topName);
  let entries: string[];
  try {
    entries = await readdir(top);
  } catch {
    return;
  }
  for (const name of entries) {
    const from = join(top, name);
    const to = join(dest, name);
    await rm(to, { recursive: true, force: true });
    await rename(from, to);
  }
  await rm(top, { recursive: true, force: true });
}

/**
 * aria2c materialises pieces that straddle a selected/unselected boundary, so
 * unselected torrent files can appear as partial files. Only paths listed in the
 * metainfo are removed; anything else in `dest` is left alone.
 */
async function removeUnselected(
  dest: string,
  parsed: ParsedTorrent,
  select: string[] | undefined,
): Promise<void> {
  if (isSelectAll(select)) return;
  for (const file of parsed.files) {
    const rel = stripTorrentTopDir(file.path, parsed.name);
    if (matchesSelect(rel, select)) continue;
    await rm(join(dest, rel), { force: true });
    const parent = rel.includes("/") ? join(dest, rel.slice(0, rel.lastIndexOf("/"))) : undefined;
    if (parent !== undefined) {
      try {
        if ((await readdir(parent)).length === 0)
          await rm(parent, { recursive: true, force: true });
      } catch {
        /* parent already gone */
      }
    }
  }
}

/**
 * SPEC §4 step 7: acquire bytes via (a) metainfo, (b) magnet then metainfo,
 * or (c) `--http-only` multi-source HTTP. aria2c is always spawned with an argv
 * array and a literal `--` before every positional (torrent path, magnet, URL).
 *
 * Magnet path: aria2c cannot attach webseeds to a magnet, so we first download
 * metainfo with `--bt-metadata-only=true --bt-save-metadata=true`, then run the
 * torrent path with the saved file and `webseeds[]` as extra URIs.
 */
export class Aria2Downloader implements Downloader {
  private readonly aria2cPath: string;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly dht: boolean;
  private readonly btStopTimeout: number;
  private readonly seedTime: number;
  private readonly maxConnections: number;
  private readonly extraArgs: string[];
  private readonly onLine: ((line: string) => void) | undefined;
  private readonly spawnImpl: SpawnImpl;

  constructor(opts: Aria2DownloaderOptions = {}) {
    this.aria2cPath = opts.aria2cPath ?? "aria2c";
    this.env = opts.env;
    this.dht = opts.dht ?? true;
    this.btStopTimeout = opts.btStopTimeout ?? 120;
    this.seedTime = opts.seedTime ?? 0;
    this.maxConnections = opts.maxConnections ?? 16;
    this.extraArgs = opts.extraArgs ?? [];
    this.onLine = opts.onLine;
    this.spawnImpl = opts.spawnImpl ?? nodeSpawn;
  }

  async fetch(manifest: Manifest, dest: string, opts: FetchOptions = {}): Promise<void> {
    await mkdir(dest, { recursive: true });
    const webseeds = opts.webseeds ?? manifest.distribution.webseeds;
    if (opts.httpOnly === true) {
      await this.fetchHttp(manifest, dest, opts, webseeds);
      return;
    }
    if (opts.metainfo !== undefined) {
      await this.fetchTorrent(opts.metainfo, dest, opts, webseeds);
      return;
    }
    const magnet = checkMagnet(manifest.distribution.magnet);
    const metainfo = await this.fetchMagnetMetainfo(magnet, opts);
    await this.fetchTorrent(metainfo, dest, opts, webseeds);
  }

  private commonBtArgs(dest: string): string[] {
    return [
      `--dir=${dest}`,
      `--seed-time=${this.seedTime}`,
      `--bt-stop-timeout=${this.btStopTimeout}`,
      `--bt-tracker-connect-timeout=${this.btStopTimeout}`,
      `--enable-dht=${this.dht ? "true" : "false"}`,
      "--check-integrity=true",
      "--file-allocation=none",
      "--summary-interval=1",
      "--console-log-level=notice",
      "--allow-overwrite=true",
      "--auto-file-renaming=false",
      `--bt-max-peers=${this.maxConnections}`,
      ...this.extraArgs,
    ];
  }

  private async run(args: string[], opts: FetchOptions, phase: Progress["phase"]): Promise<void> {
    const onProgress =
      opts.onProgress === undefined
        ? undefined
        : (p: Progress) => {
            opts.onProgress?.({ ...p, phase });
          };
    const runOpts: RunAria2Options = {
      command: this.aria2cPath,
      args,
      spawnImpl: this.spawnImpl,
      stallTimeoutMs: (this.btStopTimeout + 30) * 1000,
    };
    if (this.env !== undefined) runOpts.env = this.env;
    if (opts.signal !== undefined) runOpts.signal = opts.signal;
    if (this.onLine !== undefined) runOpts.onLine = this.onLine;
    if (onProgress !== undefined) runOpts.onProgress = onProgress;
    await runAria2(runOpts);
  }

  /**
   * Magnet → metainfo file. Webseeds are applied on the subsequent torrent run.
   */
  private async fetchMagnetMetainfo(magnet: string, opts: FetchOptions): Promise<Uint8Array> {
    const tmp = await mkdtemp(join(tmpdir(), "enspack-magnet-"));
    try {
      opts.onProgress?.({ phase: "metainfo", bytesDone: 0, bytesTotal: 0 });
      const args = [
        `--dir=${tmp}`,
        "--bt-metadata-only=true",
        "--bt-save-metadata=true",
        `--bt-stop-timeout=${this.btStopTimeout}`,
        `--bt-tracker-connect-timeout=${this.btStopTimeout}`,
        `--enable-dht=${this.dht ? "true" : "false"}`,
        "--summary-interval=1",
        "--console-log-level=notice",
        ...this.extraArgs,
        "--",
        magnet,
      ];
      await this.run(args, opts, "metainfo");
      const names = (await readdir(tmp)).filter((n) => n.endsWith(".torrent"));
      const torrentName = names[0];
      if (torrentName === undefined || names.length !== 1) {
        throw new EnspackError("DOWNLOAD", "aria2c did not save magnet metainfo");
      }
      return await readFile(join(tmp, torrentName));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  private async fetchTorrent(
    metainfo: Uint8Array,
    dest: string,
    opts: FetchOptions,
    webseeds: string[],
  ): Promise<void> {
    const parsed = await parseTorrent(metainfo);
    const selectFile = selectFileArg(parsed, opts.select);
    const tmp = await mkdtemp(join(tmpdir(), "enspack-torrent-"));
    const torrentPath = join(tmp, `${parsed.infohash}.torrent`);
    try {
      const withSeeds = await injectWebseeds(metainfo, webseeds);
      await writeFile(torrentPath, withSeeds);
      const args = [
        ...this.commonBtArgs(dest),
        ...(selectFile !== undefined
          ? [`--select-file=${selectFile}`, "--bt-remove-unselected-file=true"]
          : []),
        "--",
        torrentPath,
      ];
      await this.run(args, opts, "download");
      await flattenTopDir(dest, parsed.name);
      await removeUnselected(dest, parsed, opts.select);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  private async fetchHttp(
    manifest: Manifest,
    dest: string,
    opts: FetchOptions,
    webseeds: string[],
  ): Promise<void> {
    const files = manifest.files.filter((f) => matchesSelect(f.path, opts.select));
    if (files.length === 0) {
      throw new EnspackError("VERIFY", `no files matched select ${JSON.stringify(opts.select)}`);
    }
    const tmp = await mkdtemp(join(tmpdir(), "enspack-http-"));
    const listPath = join(tmp, "aria2.in");
    const lines: string[] = [];
    for (const file of files) {
      const sources =
        webseeds.length > 0
          ? webseeds.map((ws) => `${ws}${file.path}`)
          : httpFallbackSources(manifest, file.path);
      if (sources.length === 0) {
        throw new EnspackError("DOWNLOAD", `no webseeds for ${file.path}`);
      }
      const parts = file.path.split("/");
      const out = parts[parts.length - 1] ?? file.path;
      const subdir = parts.length > 1 ? join(dest, parts.slice(0, -1).join("/")) : dest;
      lines.push(sources.join(" "));
      lines.push(`  out=${out}`);
      lines.push(`  dir=${subdir}`);
    }
    try {
      await writeFile(listPath, `${lines.join("\n")}\n`);
      const args = [
        `--dir=${dest}`,
        "--max-connection-per-server=4",
        "--split=8",
        "--min-split-size=8M",
        "--continue=true",
        "--allow-overwrite=true",
        "--auto-file-renaming=false",
        "--summary-interval=1",
        "--console-log-level=notice",
        "--file-allocation=none",
        ...this.extraArgs,
        "-i",
        listPath,
        "--",
      ];
      await this.run(args, opts, "download");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}
