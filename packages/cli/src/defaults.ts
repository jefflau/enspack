import {
  DEFAULT_GATEWAYS,
  EnspackError,
  type Pinner,
  createInstaller,
  createManifestStore,
  createPublisher,
  createResolver,
  publicClientFor,
} from "@enspack/core";
import { HfClient, HuggingBayClient, licenseGate } from "@enspack/hf";
import { Aria2Downloader, Sha256Verifier } from "@enspack/torrent";
import { http, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import type { CliDeps, CliHf, Writer } from "./types.js";

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

function isPrivateKey(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * SPEC §8 step 5 / MVP.md WP-08: wallet from `ENSPACK_PUBLISHER_KEY` (never logged).
 */
function publisherFromEnv(env: NodeJS.ProcessEnv): CliDeps["publisherFactory"] {
  return (chain, rpcUrl) => {
    const key = env.ENSPACK_PUBLISHER_KEY;
    if (key === undefined || key === "") {
      return {
        async publish() {
          throw new EnspackError("PUBLISH", "ENSPACK_PUBLISHER_KEY is not set");
        },
      };
    }
    if (!isPrivateKey(key)) {
      throw new EnspackError("PUBLISH", "ENSPACK_PUBLISHER_KEY must be a 32-byte hex private key");
    }
    const account = privateKeyToAccount(key);
    const viemChain = chain === "sepolia" ? sepolia : mainnet;
    const client = publicClientFor(chain, rpcUrl);
    const wallet = createWalletClient({
      account,
      chain: viemChain,
      transport: http(rpcUrl),
    });
    return createPublisher({ client, wallet, account });
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
    downloader: new Aria2Downloader({
      extraArgs:
        env.ENSPACK_ARIA2_EXTRA !== undefined && env.ENSPACK_ARIA2_EXTRA !== ""
          ? env.ENSPACK_ARIA2_EXTRA.split(",").filter((s) => s.length > 0)
          : [],
    }),
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
