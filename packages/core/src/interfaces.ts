import type { Manifest } from "./types.js";

/** MVP.md §2: result of resolving an enspack ref. */
export interface Resolved {
  name: string;
  node: `0x${string}`;
  cid: string | null;
  magnet: string | null;
  spec: string | null;
  manifest: Manifest | null;
  manifestBytes: Uint8Array | null;
}

/** MVP.md §2: ENS read path (SPEC §4 steps 1–6). */
export interface Resolver {
  resolve(ref: string, opts?: { chain?: "mainnet" | "sepolia" }): Promise<Resolved>;
}

/** MVP.md §2: IPFS put / verified-fetch for manifests and torrents. */
export interface ManifestStore {
  put(bytes: Uint8Array): Promise<string>;
  getVerified(cid: string): Promise<Uint8Array>;
}

/** SPEC §8 step 5 / MVP.md WP-04: input to on-chain publish. */
export interface PublishInput {
  manifest: Manifest;
  manifestCid: string;
  chain: "mainnet" | "sepolia";
  dryRun?: boolean;
}

/** One unsigned call the publisher will send (or print in dry-run). */
export interface PublishCall {
  to: `0x${string}`;
  data: `0x${string}`;
  description: string;
  gas?: bigint;
}

/** SPEC §8 / MVP.md §2: result of Publisher.publish. */
export interface PublishResult {
  name: string;
  model: string;
  cid: string;
  txs: `0x${string}`[];
  calls: PublishCall[];
  created: { model: boolean; version: boolean };
}

/** MVP.md §2: ENS write path (SPEC §8 step 5). */
export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>;
}

/** Download / verify progress callback payload (MVP.md §2 Downloader). */
export interface Progress {
  phase: "metainfo" | "download" | "verify";
  bytesDone: number;
  bytesTotal: number;
  path?: string;
  peers?: number;
  speed?: number;
}

/** MVP.md §2: torrent / HTTP fetch of manifest files. */
export interface Downloader {
  fetch(
    m: Manifest,
    dest: string,
    opts: { select?: string[]; httpOnly?: boolean; onProgress?: (p: Progress) => void },
  ): Promise<void>;
}

/** SPEC §4 step 8: per-file verification outcome. */
export type VerifyResult =
  | { ok: true }
  | { ok: false; failures: { path: string; reason: "missing" | "size" | "sha256" }[] };

/** MVP.md §2: size then SHA-256 of every selected files[] entry. */
export interface Verifier {
  verify(m: Manifest, dir: string, select?: string[]): Promise<VerifyResult>;
}

/** SPEC §5: HF cache layout or a flat directory copy. */
export type InstallTarget = { kind: "hf-cache"; hfHome?: string } | { kind: "dir"; path: string };

/** MVP.md §2 / SPEC §5: copy verified files into the install layout. */
export interface Installer {
  install(m: Manifest, srcDir: string, target: InstallTarget): Promise<{ path: string }>;
}
