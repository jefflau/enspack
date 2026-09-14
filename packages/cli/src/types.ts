import type {
  Downloader,
  EnspackChainName,
  InstallTarget,
  Installer,
  IpfsManifestStore,
  Manifest,
  ManifestFile,
  ManifestStore,
  Pinner,
  Progress,
  Publisher,
  Resolver,
  Verifier,
  VerifyResult,
} from "@enspack/core";
import type {
  HbArtifact,
  HbFallbackInput,
  HbLock,
  HfModelInfo,
  LicenseGateOptions,
} from "@enspack/hf";

/** Writable used by the CLI (tests inject string buffers). */
export interface Writer {
  write(chunk: string): void;
  readonly isTTY?: boolean;
}

/** Hugging Face + Hugging Bay surface the publish command needs (WP-05). */
export interface CliHf {
  info(repo: string): Promise<HfModelInfo>;
  resolveRevision(repo: string, ref?: string): Promise<string>;
  buildFiles(repo: string, revision: string): Promise<ManifestFile[]>;
  licenseGate(license: string | null | undefined, opts?: LicenseGateOptions): void;
  huggingBay: {
    resolve(repo: string): Promise<HbArtifact | null>;
    lock(artifactId: string): Promise<HbLock>;
    submitFallback(artifactId: string, input: HbFallbackInput): Promise<unknown>;
  };
}

/** Downloader plus the torrent metainfo option WP-06 adds beyond MVP.md §2. */
export interface CliDownloader {
  fetch(
    m: Manifest,
    dest: string,
    opts: {
      select?: string[];
      httpOnly?: boolean;
      onProgress?: (p: Progress) => void;
      metainfo?: Uint8Array;
      webseeds?: string[];
    },
  ): Promise<void>;
}

/** Verifier plus SPEC §4 step 8 quarantine (implemented by `Sha256Verifier`). */
export interface CliVerifier extends Verifier {
  quarantine?(
    dir: string,
    infohash: string,
    failures: Extract<VerifyResult, { ok: false }>["failures"],
  ): Promise<string>;
}

/** Installer plus SPEC §5 Modelfile / ready-to-run helpers. */
export interface CliInstaller extends Installer {
  emitModelfile?(m: Manifest, dir: string, select?: string[]): Promise<string>;
  readyToRunLines?(m: Manifest, installedPath: string, target: InstallTarget): string[];
}

/**
 * SPEC §4 / MVP.md WP-08: injected collaborators so unit tests never touch the
 * network. `bin/enspack.js` wires real implementations from env.
 */
export interface CliDeps {
  resolverFactory: (chain: EnspackChainName, rpcUrl: string) => Resolver;
  store: ManifestStore | IpfsManifestStore;
  downloader: CliDownloader | Downloader;
  verifier: CliVerifier;
  installer: CliInstaller;
  hf: CliHf;
  publisherFactory: (chain: EnspackChainName, rpcUrl: string) => Publisher;
  stdout: Writer;
  stderr: Writer;
  env: NodeJS.ProcessEnv;
  cwd: string;
  now?: () => Date;
  fetch?: typeof fetch;
  /** Real bin: build a pinning store for `publish --pin`. Tests omit this and use `store.put`. */
  storeWithPinner?: (pinner: Pinner) => ManifestStore | IpfsManifestStore;
}

export interface GetJson {
  name: string;
  node: string;
  cid: string | null;
  infohash: string;
  installedPath: string;
  files: number;
  totalSize: number;
  verified: boolean;
}

export type { EnspackChainName, Manifest };
