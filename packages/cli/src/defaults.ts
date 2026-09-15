import {
  EnspackError,
  type Pinner,
  createInstaller,
  createManifestStore,
  createPublisher,
  createResolver,
  ensV2ConfigFor,
  gatewaysFromEnv,
  planEnsSetup,
  publicClientFor,
  runEnsSetup,
} from "@enspack/core";
import { HfClient, HuggingBayClient, licenseGate } from "@enspack/hf";
import { Aria2Downloader, Sha256Verifier } from "@enspack/torrent";
import { http, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { ensOptsFor } from "./ens.js";
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

/** Secret stores often strip the `0x`; accept both forms, never log the value. */
function normalizePrivateKey(value: string): `0x${string}` | null {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? `0x${hex}` : null;
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
    const normalized = normalizePrivateKey(key);
    if (normalized === null) {
      throw new EnspackError("PUBLISH", "ENSPACK_PUBLISHER_KEY must be a 32-byte hex private key");
    }
    const account = privateKeyToAccount(normalized);
    const viemChain = chain === "sepolia" ? sepolia : mainnet;
    const client = publicClientFor(chain, rpcUrl);
    const wallet = createWalletClient({
      account,
      chain: viemChain,
      transport: http(rpcUrl),
    });
    const ens = ensOptsFor(chain, env);
    return createPublisher({
      client,
      wallet,
      account,
      ensVersion: ens.ensVersion,
      ...(ens.ensV2 !== undefined ? { ensV2: ens.ensV2 } : {}),
    });
  };
}

/**
 * WP-18: signer is `ENSPACK_OPERATOR_KEY`, falling back to `ENSPACK_PUBLISHER_KEY`.
 * Keys are never logged.
 */
function operatorKeyFromEnv(env: NodeJS.ProcessEnv): `0x${string}` {
  const operator = env.ENSPACK_OPERATOR_KEY;
  const publisher = env.ENSPACK_PUBLISHER_KEY;
  const key =
    operator !== undefined && operator !== ""
      ? operator
      : publisher !== undefined && publisher !== ""
        ? publisher
        : undefined;
  if (key === undefined || key === "") {
    throw new EnspackError(
      "PUBLISH",
      "ENSPACK_OPERATOR_KEY is not set (falls back to ENSPACK_PUBLISHER_KEY)",
    );
  }
  const normalized = normalizePrivateKey(key);
  if (normalized === null) {
    throw new EnspackError(
      "PUBLISH",
      "ENSPACK_OPERATOR_KEY (or ENSPACK_PUBLISHER_KEY) must be a 32-byte hex private key",
    );
  }
  return normalized;
}

function ensSetupFromEnv(env: NodeJS.ProcessEnv): NonNullable<CliDeps["ensSetupFactory"]> {
  return (chain, rpcUrl) => {
    const key = operatorKeyFromEnv(env);
    const account = privateKeyToAccount(key);
    const viemChain = chain === "sepolia" ? sepolia : mainnet;
    const client = publicClientFor(chain, rpcUrl);
    const wallet = createWalletClient({
      account,
      chain: viemChain,
      transport: http(rpcUrl),
    });
    const cfg = ensV2ConfigFor(chain, env);
    const assertChain = async (): Promise<void> => {
      let id: number;
      try {
        id = await client.getChainId();
      } catch (cause) {
        throw new EnspackError("RESOLVE", `RPC for ${chain} is unreachable`, cause);
      }
      if (id !== viemChain.id) {
        throw new EnspackError(
          "RESOLVE",
          `RPC for ${chain} reports chain id ${id}, expected ${viemChain.id}; check ${chain === "sepolia" ? "SEPOLIA_RPC_URL" : "ETH_RPC_URL"}`,
        );
      }
    };
    return {
      account: account.address,
      plan: async (input) => {
        await assertChain();
        return planEnsSetup(client, cfg, { ...input, account: account.address });
      },
      run: async (input, opts) => {
        await assertChain();
        return runEnsSetup(client, wallet, cfg, { ...input, account: account.address }, opts);
      },
    };
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
  const gateways = gatewaysFromEnv(env);
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
    resolverFactory: (chain, rpcUrl) => {
      const ens = ensOptsFor(chain, env);
      return createResolver({
        chain,
        rpcUrl,
        store,
        ensVersion: ens.ensVersion,
        ...(ens.ensV2 !== undefined ? { ensV2: ens.ensV2 } : {}),
      });
    },
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
    ensSetupFactory: ensSetupFromEnv(env),
    stdout,
    stderr,
    env,
    cwd: opts.cwd ?? process.cwd(),
    fetch: globalThis.fetch.bind(globalThis),
    storeWithPinner: (pinner: Pinner) => createManifestStore({ gateways, pinner }),
  };
}
