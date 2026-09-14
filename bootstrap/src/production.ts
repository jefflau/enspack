import {
  EnspackError,
  type Pinner,
  createManifestStore,
  createPublisher,
  createResolver,
  kuboPinner,
  publicClientFor,
  seedNodePinner,
} from "@enspack/core";
import { HfClient, HuggingBayClient, hfWebseed } from "@enspack/hf";
import { Aria2Downloader, Sha256Verifier } from "@enspack/torrent";
import { http, type Hex, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import type { BootstrapDeps } from "./deps.js";
import { wrapHuggingBay } from "./hb-wrap.js";
import { stderrLogger } from "./log.js";
import { createSeedClient } from "./seed-client.js";

function operatorKey(env: NodeJS.ProcessEnv): Hex {
  const raw = env.ENSPACK_OPERATOR_KEY;
  if (raw === undefined || raw === "") {
    throw new EnspackError("PUBLISH", "ENSPACK_OPERATOR_KEY is not set");
  }
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new EnspackError("PUBLISH", "ENSPACK_OPERATOR_KEY is not a 32-byte hex key");
  }
  return hex as Hex;
}

function rpcUrl(chain: "mainnet" | "sepolia", env: NodeJS.ProcessEnv): string {
  const key = chain === "sepolia" ? "SEPOLIA_RPC_URL" : "ETH_RPC_URL";
  const url = env[key];
  if (url === undefined || url === "") {
    throw new EnspackError("RESOLVE", `${key} is not set`);
  }
  return url;
}

export interface ProductionOpts {
  chain: "mainnet" | "sepolia";
  env: NodeJS.ProcessEnv;
  pin: "kubo" | "seed";
  seedNode?: string;
  dryRun: boolean;
}

/**
 * Wire production HF / torrent / ENS / IPFS clients. Keys and RPC URLs stay in env.
 */
export function createProductionDeps(opts: ProductionOpts): BootstrapDeps {
  const env = opts.env;
  const url = rpcUrl(opts.chain, env);
  const client = publicClientFor(opts.chain, url);
  const account = privateKeyToAccount(operatorKey(env));
  const chainObj = opts.chain === "sepolia" ? sepolia : mainnet;
  const publisher = opts.dryRun
    ? createPublisher({ client, account })
    : createPublisher({
        client,
        wallet: createWalletClient({ account, chain: chainObj, transport: http(url) }),
      });

  const seedUrl = opts.seedNode ?? env.ENSPACK_SEED_NODE;
  const kubo = env.ENSPACK_KUBO_API ?? "http://127.0.0.1:5001";
  let pinner: Pinner;
  if (opts.dryRun) {
    pinner = {
      name: "noop",
      async pin(_bytes, cid) {
        return cid;
      },
    };
  } else if (opts.pin === "kubo") {
    pinner = kuboPinner({ apiUrl: kubo });
  } else if (seedUrl === undefined || seedUrl === "") {
    throw new EnspackError("PUBLISH", "ENSPACK_SEED_NODE / --seed-node is required for --pin seed");
  } else {
    pinner = seedNodePinner({ baseUrl: seedUrl });
  }

  const store = createManifestStore({ pinner });
  const resolver = createResolver({ client, store });
  const hfToken = env.HF_TOKEN;
  const hf = hfToken !== undefined ? new HfClient({ token: hfToken }) : new HfClient();

  const seedNode =
    seedUrl !== undefined
      ? createSeedClient(seedUrl)
      : {
          async seed(): Promise<{ infohash: string; state: string }> {
            throw new EnspackError("FETCH", "no seed node URL configured");
          },
          async status(): Promise<{ progress: number }> {
            throw new EnspackError("FETCH", "no seed node URL configured");
          },
        };

  return {
    hf,
    hb: wrapHuggingBay(new HuggingBayClient()),
    store,
    publisher,
    downloader: new Aria2Downloader(),
    verifier: new Sha256Verifier(),
    seedNode,
    resolver,
    now: () => new Date().toISOString(),
    hfWebseed,
    log: stderrLogger(),
  };
}
