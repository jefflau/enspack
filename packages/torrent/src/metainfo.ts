import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { EnspackError, MAGNET_RE, TORRENT_MAX_BYTES } from "@enspack/core";
import type { Manifest } from "@enspack/core";
import createTorrentCb from "create-torrent";
import parseTorrentLib, { toTorrentFile } from "parse-torrent";
import calcPieceLength from "piece-length";
import { posixPath, stripTorrentTopDir, walkFiles } from "./walk.js";

const GIB = 1024 ** 3;
const PIECE_LENGTH_LARGE = 4 * 1024 * 1024;
const INFOHASH_RE = /^[0-9a-f]{40}$/;

/** SPEC §8 step 2: options for BitTorrent v1 metainfo. */
export interface CreateTorrentOptions {
  name?: string;
  webseeds: string[];
  pieceLength?: number;
  comment?: string;
  announce?: string[];
}

export interface TorrentFile {
  path: string;
  size: number;
}

export interface CreateTorrentResult {
  metainfo: Uint8Array;
  infohash: string;
  files: TorrentFile[];
}

export interface ParsedTorrent {
  infohash: string;
  name: string;
  files: TorrentFile[];
  webseeds: string[];
  pieceLength: number;
  totalSize: number;
}

function assertWebseeds(webseeds: string[]): void {
  for (const url of webseeds) {
    if (!url.endsWith("/")) {
      throw new EnspackError("VERIFY", `webseed must be a BEP 19 base URL ending in "/": ${url}`);
    }
  }
}

function choosePieceLength(totalSize: number, override: number | undefined): number {
  if (override !== undefined) return override;
  if (totalSize > GIB) return PIECE_LENGTH_LARGE;
  return Math.min(calcPieceLength(totalSize), PIECE_LENGTH_LARGE);
}

function createTorrentBuffer(
  input: Array<NodeJS.ReadableStream>,
  opts: {
    name: string;
    announce: string[];
    urlList: string[];
    pieceLength: number;
    comment?: string;
  },
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    createTorrentCb(input, opts, (err, torrent) => {
      if (err) reject(err);
      else resolve(torrent);
    });
  });
}

/**
 * SPEC §8 step 2: BitTorrent v1 metainfo with `url-list` = webseeds, 4 MiB pieces
 * when the folder is larger than 1 GiB. File order is sorted by path (byte order)
 * so the infohash is reproducible. `private` is omitted. Trackers are off unless
 * `announce` is passed.
 */
export async function createTorrent(
  dir: string,
  opts: CreateTorrentOptions,
): Promise<CreateTorrentResult> {
  assertWebseeds(opts.webseeds);
  const walked = await walkFiles(dir);
  if (walked.length === 0) {
    throw new EnspackError("VERIFY", `no files in ${dir}`);
  }
  const totalSize = walked.reduce((sum, f) => sum + f.size, 0);
  const name = opts.name ?? basename(dir);
  const pieceLength = choosePieceLength(totalSize, opts.pieceLength);

  // Prefix paths with the torrent name so create-torrent keeps a single top
  // directory and does not strip a nested common prefix.
  const streams = walked.map((f) => {
    const stream = createReadStream(f.abs);
    Object.assign(stream, { name: `${name}/${f.path}` });
    return stream;
  });

  const ctOpts: {
    name: string;
    announce: string[];
    urlList: string[];
    pieceLength: number;
    comment?: string;
  } = {
    name,
    announce: opts.announce ?? [],
    urlList: opts.webseeds,
    pieceLength,
  };
  if (opts.comment !== undefined) {
    ctOpts.comment = opts.comment;
  }

  const metainfo = await createTorrentBuffer(streams, ctOpts);
  const parsed = await parseTorrent(metainfo);
  return {
    metainfo,
    infohash: parsed.infohash,
    files: walked.map((f) => ({ path: f.path, size: f.size })),
  };
}

/**
 * SPEC §4 step 7a: decode a `.torrent` file. Throws VERIFY on garbage or when
 * the bytes exceed `TORRENT_MAX_BYTES`.
 */
export async function parseTorrent(bytes: Uint8Array): Promise<ParsedTorrent> {
  if (bytes.byteLength > TORRENT_MAX_BYTES) {
    throw new EnspackError(
      "VERIFY",
      `torrent metainfo exceeds TORRENT_MAX_BYTES (${TORRENT_MAX_BYTES})`,
    );
  }
  let parsed: Awaited<ReturnType<typeof parseTorrentLib>>;
  try {
    parsed = await parseTorrentLib(bytes);
  } catch (cause) {
    throw new EnspackError("VERIFY", "invalid torrent metainfo", cause);
  }
  if (parsed.infoHash === undefined || parsed.files === undefined) {
    throw new EnspackError("VERIFY", "invalid torrent metainfo");
  }
  return {
    infohash: parsed.infoHash.toLowerCase(),
    name: parsed.name,
    files: parsed.files.map((f) => ({ path: posixPath(f.path), size: f.length })),
    webseeds: parsed.urlList ?? [],
    pieceLength: parsed.pieceLength,
    totalSize: parsed.length,
  };
}

/** SPEC §3: v1 infohash of metainfo bytes, lowercase hex. */
export async function infohash(bytes: Uint8Array): Promise<string> {
  return (await parseTorrent(bytes)).infohash;
}

/**
 * SPEC §2.1 / §3: `magnet:?xt=urn:btih:<40 hex>&dn=<encoded>`.
 */
export function magnetFor(infohashHex: string, name?: string): string {
  const hex = infohashHex.toLowerCase();
  if (!INFOHASH_RE.test(hex)) {
    throw new EnspackError("VERIFY", `infohash must be 40 hex characters, got "${infohashHex}"`);
  }
  if (name === undefined || name.length === 0) {
    return `magnet:?xt=urn:btih:${hex}`;
  }
  return `magnet:?xt=urn:btih:${hex}&dn=${encodeURIComponent(name)}`;
}

/**
 * SPEC §4 last paragraph: return `s` if it matches `MAGNET_RE`, else VERIFY.
 * Callers MUST pass the returned string after a `--` argv separator.
 */
export function checkMagnet(s: string): string {
  if (!MAGNET_RE.test(s)) {
    throw new EnspackError("VERIFY", `magnet does not match MAGNET_RE: ${s}`);
  }
  return s;
}

/**
 * SPEC §3: the torrent's file tree MUST equal `files[]` exactly (same paths,
 * same sizes) under a single top-level directory whose name is irrelevant.
 */
export function metainfoMatchesManifest(parsed: ParsedTorrent, manifest: Manifest): void {
  const tops = new Set<string>();
  for (const f of parsed.files) {
    const top = posixPath(f.path).split("/")[0];
    if (top !== undefined && top.length > 0) tops.add(top);
  }
  if (tops.size !== 1) {
    throw new EnspackError(
      "VERIFY",
      `torrent must have a single top-level directory (found ${[...tops].join(", ") || "none"})`,
    );
  }
  const torrentName = parsed.name;
  const torrentMap = new Map<string, number>();
  for (const f of parsed.files) {
    torrentMap.set(stripTorrentTopDir(f.path, torrentName), f.size);
  }
  const manifestMap = new Map<string, number>();
  for (const f of manifest.files) {
    manifestMap.set(f.path, f.size);
  }

  const diffs: string[] = [];
  for (const [path, size] of torrentMap) {
    const mSize = manifestMap.get(path);
    if (mSize === undefined) {
      diffs.push(`extra in torrent: ${path} (${size})`);
    } else if (mSize !== size) {
      diffs.push(`size mismatch: ${path} torrent=${size} manifest=${mSize}`);
    }
  }
  for (const [path, size] of manifestMap) {
    if (!torrentMap.has(path)) {
      diffs.push(`missing from torrent: ${path} (${size})`);
    }
  }
  if (diffs.length > 0) {
    throw new EnspackError(
      "VERIFY",
      `metainfo does not match manifest files[]: ${diffs.join("; ")}`,
    );
  }
}

/**
 * Merge BEP 19 webseeds into metainfo `url-list`. url-list is outside `info`,
 * so the infohash is unchanged. aria2c treats extra positional URIs as
 * separate downloads, so we must not pass them on argv.
 */
export async function injectWebseeds(bytes: Uint8Array, webseeds: string[]): Promise<Uint8Array> {
  if (webseeds.length === 0) return bytes;
  const parsed = await parseTorrentLib(bytes);
  const existing = parsed.urlList ?? [];
  const merged = [...new Set([...existing, ...webseeds])];
  parsed.urlList = merged;
  return toTorrentFile(parsed);
}
