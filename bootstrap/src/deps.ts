import type {
  Manifest,
  ManifestFile,
  PinContentType,
  Progress,
  Publisher,
  Resolver,
  Verifier,
} from "@enspack/core";
import type { HbArtifact, HbFallbackInput, HbLock, HfModelInfo, HfTreeEntry } from "@enspack/hf";
import type { ModelEntry, ModelsConfig } from "./types.js";

/** BOOTSTRAP.md §5: HF surface the runner actually calls. */
export interface BootstrapHf {
  info(repo: string): Promise<HfModelInfo>;
  resolveRevision(repo: string, ref: string): Promise<string>;
  tree(repo: string, revision: string): Promise<HfTreeEntry[]>;
  buildFiles(repo: string, revision: string): Promise<ManifestFile[]>;
}

export interface BootstrapHb {
  resolve(repo: string): Promise<HbArtifact | null>;
  lock(artifactId: string): Promise<HbLock | null>;
  submitFallback(
    artifactId: string,
    input: HbFallbackInput & { sourceUrl?: string; filePath?: string },
  ): Promise<unknown>;
}

export interface BootstrapStore {
  put(bytes: Uint8Array, contentType?: PinContentType): Promise<string>;
  getVerified(cid: string): Promise<Uint8Array>;
}

export interface BootstrapDownloader {
  fetch(
    m: Manifest,
    dest: string,
    opts: {
      httpOnly?: boolean;
      webseeds?: string[];
      onProgress?: (p: Progress) => void;
    },
  ): Promise<void>;
}

export interface BootstrapVerifier extends Verifier {
  quarantine(
    dir: string,
    infohash: string,
    failures: { path: string; reason: "missing" | "size" | "sha256" }[],
  ): Promise<string>;
}

export interface SeedNode {
  seed(name: string): Promise<{ infohash: string; state: string }>;
  status(infohash: string): Promise<{ progress: number; state?: string }>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface BootstrapDeps {
  hf: BootstrapHf;
  hb: BootstrapHb;
  store: BootstrapStore;
  publisher: Publisher;
  downloader: BootstrapDownloader;
  verifier: BootstrapVerifier;
  seedNode: SeedNode;
  resolver: Resolver;
  now: () => string;
  hfWebseed: (repo: string, revision: string) => string;
  /** Override download URLs (tests use a local HTTP server). Defaults to `[hfWebseed]`. */
  downloadWebseeds?: (repo: string, revision: string) => string[];
  log: Logger;
}

export interface RunOptions {
  config: ModelsConfig;
  entries: ModelEntry[];
  statePath: string;
  downloads: string;
  chain: "mainnet" | "sepolia";
  resume: boolean;
  submitHb: boolean;
  seedTimeoutMs?: number;
  seedPollMs?: number;
}
