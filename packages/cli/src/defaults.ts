import * as core from "@enspack/core";
import {
  DEFAULT_GATEWAYS,
  type EnspackChainName,
  EnspackError,
  type Pinner,
  type Publisher,
  createInstaller,
  createManifestStore,
  createResolver,
} from "@enspack/core";
import { HfClient, HuggingBayClient, licenseGate } from "@enspack/hf";
import { Aria2Downloader, Sha256Verifier } from "@enspack/torrent";
import { httpOnlyFetch } from "./http-download.js";
import type { CliDeps, CliDownloader, CliHf, Writer } from "./types.js";

function asWriter(stream: NodeJS.WritableStream): Writer {
  const tty = "isTTY" in stream && Boolean((stream as NodeJS.WriteStream).isTTY);
  const writer: Writer = {
    write(chunk: string) {
      stream.write(chunk);
    },
  };
  if (tty) {
    return { ...writer, isTTY: true };
  }
  return writer;
}

function parseGateways(env: NodeJS.ProcessEnv): string[] {
  const extra = env.ENSPACK_IPFS_GATEWAYS;
  const extras =
    extra !== undefined && extra !== ""
      ? extra
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
  return [...extras, ...DEFAULT_GATEWAYS];
}

function stubPublisher(): Publisher {
  return {
    async publish() {
      throw new EnspackError("PUBLISH", "on-chain publisher not available in this build");
    },
  };
}

function loadCreatePublisher():
  | ((opts: {
      privateKey: `0x${string}`;
      rpcUrl: string;
      chain: EnspackChainName;
    }) => Publisher)
  | undefined {
  const fn = (core as unknown as { createPublisher?: unknown }).createPublisher;
  if (typeof fn === "function") {
    return fn as (opts: {
      privateKey: `0x${string}`;
      rpcUrl: string;
      chain: EnspackChainName;
    }) => Publisher;
  }
  return undefined;
}

function publisherFromEnv(env: NodeJS.ProcessEnv): CliDeps["publisherFactory"] {
  const create = loadCreatePublisher();
  return (chain, rpcUrl) => {
    if (create === undefined) {
      return stubPublisher();
    }
    const key = env.ENSPACK_PUBLISHER_KEY;
    if (key === undefined || key === "") {
      return {
        async publish() {
          throw new EnspackError("PUBLISH", "ENSPACK_PUBLISHER_KEY is not set");
        },
      };
    }
    return create({ privateKey: key as `0x${string}`, rpcUrl, chain });
  };
}

function hfFromEnv(env: NodeJS.ProcessEnv): CliHf {
  const token = env.HF_TOKEN;
  const hf = token !== undefined && token !== "" ? new HfClient({ token }) : new HfClient();
  const hb = new HuggingBayClient();
  return {
    info: (repo) => hf.info(repo),
    resolveRevision: (repo, ref) => hf.resolveRevision(repo, ref),
    buildFiles: (repo, revision) => hf.buildFiles(repo, revision),
    licenseGate: (license, opts) => licenseGate(license, opts),
    huggingBay: {
      resolve: (repo) => hb.resolve(repo),
      lock: (id) => hb.lock(id),
      submitFallback: (id, input) => hb.submitFallback(id, input),
    },
  };
}

export interface DefaultDepsOpts {
  stdout?: NodeJS.WritableStream | Writer;
  stderr?: NodeJS.WritableStream | Writer;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

function isWriter(value: NodeJS.WritableStream | Writer): value is Writer {
  return !("end" in value);
}

function wrapDownloader(inner: Aria2Downloader): CliDownloader {
  return {
    async fetch(m, dest, opts) {
      if (opts.httpOnly === true) {
        const httpOpts: {
          select?: string[];
          onProgress?: (p: import("@enspack/core").Progress) => void;
        } = {};
        if (opts.select !== undefined) httpOpts.select = opts.select;
        if (opts.onProgress !== undefined) httpOpts.onProgress = opts.onProgress;
        await httpOnlyFetch(m, dest, httpOpts);
        return;
      }
      await inner.fetch(m, dest, opts);
    },
  };
}

/**
 * MVP.md WP-08: wire real implementations from env for `bin/enspack.js`.
 * RPC URLs and keys are read here and never logged.
 */
export function createDefaultDeps(opts: DefaultDepsOpts = {}): CliDeps {
  const env = opts.env ?? process.env;
  const gateways = parseGateways(env);
  const store = createManifestStore({ gateways });
  const stdout =
    opts.stdout === undefined
      ? asWriter(process.stdout)
      : isWriter(opts.stdout)
        ? opts.stdout
        : asWriter(opts.stdout);
  const stderr =
    opts.stderr === undefined
      ? asWriter(process.stderr)
      : isWriter(opts.stderr)
        ? opts.stderr
        : asWriter(opts.stderr);
  return {
    resolverFactory: (chain, rpcUrl) => createResolver({ chain, rpcUrl, store }),
    store,
    downloader: wrapDownloader(
      new Aria2Downloader({
        extraArgs:
          env.ENSPACK_ARIA2_EXTRA !== undefined && env.ENSPACK_ARIA2_EXTRA !== ""
            ? env.ENSPACK_ARIA2_EXTRA.split(",").filter((s) => s.length > 0)
            : [],
      }),
    ),
    verifier: new Sha256Verifier(),
    installer: createInstaller(),
    hf: hfFromEnv(env),
    publisherFactory: publisherFromEnv(env),
    stdout,
    stderr,
    env,
    cwd: opts.cwd ?? process.cwd(),
    fetch: globalThis.fetch.bind(globalThis),
    storeWithPinner: (pinner: Pinner) => createManifestStore({ gateways, pinner }),
  };
}
