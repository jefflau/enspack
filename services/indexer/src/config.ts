import {
  type EnspackChainName,
  ROOT_NAME,
  publicClientFor,
  readResolverAddress,
} from "@enspack/core";
import { createConfig } from "ponder";
import { getAddress, zeroAddress } from "viem";
import { publicResolverAbi } from "./abi.js";

/** Mainnet ~Q1 2026; enspack names did not exist before this project. Override with ENSPACK_INDEXER_START_BLOCK_MAINNET. */
export const DEFAULT_START_BLOCK_MAINNET = 23_000_000;

/** Sepolia recent default (~2025/2026). Override with ENSPACK_INDEXER_START_BLOCK_SEPOLIA. */
export const DEFAULT_START_BLOCK_SEPOLIA = 8_000_000;

const CHAIN_ID: Record<EnspackChainName, number> = {
  mainnet: 1,
  sepolia: 11155111,
};

const RPC_ENV: Record<EnspackChainName, string> = {
  mainnet: "ETH_RPC_URL",
  sepolia: "SEPOLIA_RPC_URL",
};

const OVERRIDE_ENV: Record<EnspackChainName, string> = {
  mainnet: "ENSPACK_INDEXER_RESOLVERS_MAINNET",
  sepolia: "ENSPACK_INDEXER_RESOLVERS_SEPOLIA",
};

const START_BLOCK_ENV: Record<EnspackChainName, string> = {
  mainnet: "ENSPACK_INDEXER_START_BLOCK_MAINNET",
  sepolia: "ENSPACK_INDEXER_START_BLOCK_SEPOLIA",
};

const DEFAULT_START_BLOCK: Record<EnspackChainName, number> = {
  mainnet: DEFAULT_START_BLOCK_MAINNET,
  sepolia: DEFAULT_START_BLOCK_SEPOLIA,
};

const NETWORKS: EnspackChainName[] = ["mainnet", "sepolia"];

/** Used only when no RPC URLs are set so `ponder codegen` can run without network. */
export const PLACEHOLDER_RPC = "http://127.0.0.1:1";
export const PLACEHOLDER_RESOLVER = "0x0000000000000000000000000000000000000001" as const;

/**
 * SPEC / AGENTS.md: parse extra public resolvers from a comma-separated env override.
 */
export function parseResolverOverrides(raw: string | undefined): `0x${string}`[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const out: `0x${string}`[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") {
      continue;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      throw new Error("invalid resolver address in override");
    }
    const addr = getAddress(trimmed);
    if (addr !== zeroAddress) {
      out.push(addr);
    }
  }
  return out;
}

/**
 * Start block for a network from env, or the documented recent default.
 */
export function startBlockFor(network: EnspackChainName, env: NodeJS.ProcessEnv): number {
  const raw = env[START_BLOCK_ENV[network]];
  if (raw === undefined || raw === "") {
    return DEFAULT_START_BLOCK[network];
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`invalid ${START_BLOCK_ENV[network]}`);
  }
  return n;
}

function uniqueAddresses(addrs: readonly `0x${string}`[]): `0x${string}`[] {
  const seen = new Set<string>();
  const out: `0x${string}`[] = [];
  for (const addr of addrs) {
    const lower = addr.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    out.push(getAddress(addr));
  }
  return out;
}

/**
 * AGENTS.md: discover the resolver of `enspack.eth` at runtime and union optional env overrides.
 * Returns `null` when the network's RPC env var is missing (skip that network).
 */
export async function discoverResolvers(
  network: EnspackChainName,
  env: NodeJS.ProcessEnv,
): Promise<`0x${string}`[] | null> {
  const rpcUrl = env[RPC_ENV[network]];
  if (rpcUrl === undefined || rpcUrl === "") {
    return null;
  }

  const overrides = parseResolverOverrides(env[OVERRIDE_ENV[network]]);
  const found: `0x${string}`[] = [...overrides];
  try {
    const client = publicClientFor(network, rpcUrl);
    const discovered = await readResolverAddress(client, ROOT_NAME);
    if (discovered !== zeroAddress) {
      found.push(discovered);
    }
  } catch (cause) {
    if (found.length === 0) {
      throw new Error(`failed to discover resolver for ${ROOT_NAME} on ${network}`, { cause });
    }
  }

  const unique = uniqueAddresses(found);
  if (unique.length === 0) {
    throw new Error(`no resolvers to index on ${network}`);
  }
  return unique;
}

type ChainEntry = { id: number; rpc: string };
type ContractChainEntry = { address: `0x${string}`[]; startBlock: number };

/**
 * Static createConfig shape so `ponder:registry` sees PublicResolver events (SPEC §2.3).
 * Runtime config still skips networks without RPC URLs.
 */
export function typedIndexerConfig() {
  return createConfig({
    ordering: "multichain",
    chains: {
      mainnet: { id: 1, rpc: PLACEHOLDER_RPC },
      sepolia: { id: 11155111, rpc: PLACEHOLDER_RPC },
    },
    contracts: {
      PublicResolver: {
        abi: publicResolverAbi,
        chain: {
          mainnet: { address: [PLACEHOLDER_RESOLVER], startBlock: DEFAULT_START_BLOCK_MAINNET },
          sepolia: { address: [PLACEHOLDER_RESOLVER], startBlock: DEFAULT_START_BLOCK_SEPOLIA },
        },
      },
    },
  });
}

export type IndexerPonderConfig = ReturnType<typeof typedIndexerConfig>;

/**
 * Build the Ponder config: skip networks without RPC URLs; never default credentials.
 */
export async function buildIndexerPonderConfig(
  env: NodeJS.ProcessEnv,
): Promise<IndexerPonderConfig> {
  const chains: Partial<Record<EnspackChainName, ChainEntry>> = {};
  const contractChains: Partial<Record<EnspackChainName, ContractChainEntry>> = {};

  for (const network of NETWORKS) {
    const resolvers = await discoverResolvers(network, env);
    const rpcUrl = env[RPC_ENV[network]];
    if (resolvers === null || rpcUrl === undefined || rpcUrl === "") {
      continue;
    }
    chains[network] = { id: CHAIN_ID[network], rpc: rpcUrl };
    contractChains[network] = {
      address: resolvers,
      startBlock: startBlockFor(network, env),
    };
  }

  if (Object.keys(chains).length === 0) {
    process.stderr.write(
      "enspack indexer: no ETH_RPC_URL or SEPOLIA_RPC_URL; using codegen placeholder (indexes nothing)\n",
    );
    chains.mainnet = { id: 1, rpc: PLACEHOLDER_RPC };
    contractChains.mainnet = {
      address: [PLACEHOLDER_RESOLVER],
      startBlock: DEFAULT_START_BLOCK_MAINNET,
    };
  }

  return createConfig({
    ordering: "multichain",
    chains: chains as Record<string, ChainEntry>,
    contracts: {
      PublicResolver: {
        abi: publicResolverAbi,
        chain: contractChains as Record<string, ContractChainEntry>,
      },
    },
  }) as IndexerPonderConfig;
}
