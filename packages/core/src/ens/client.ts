import {
  http,
  type Chain,
  type PublicClient,
  type Transport,
  createPublicClient,
  zeroAddress,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import { getEnsResolver, namehash } from "viem/ens";
import { ENS_REGISTRY } from "../constants.js";
import { ensRegistryAbi } from "./abis.js";

export type EnspackChainName = "mainnet" | "sepolia";

/** SPEC §4: construct a public client; the RPC URL is supplied by the caller, never from disk. */
export function publicClientFor(
  chain: EnspackChainName,
  rpcUrl: string,
): PublicClient<Transport, Chain> {
  return createPublicClient({
    chain: chain === "sepolia" ? sepolia : mainnet,
    transport: http(rpcUrl),
  });
}

export function chainOf(name: EnspackChainName): Chain {
  return name === "sepolia" ? sepolia : mainnet;
}

export function ensUniversalResolverAddress(chain: Chain | undefined): `0x${string}` | undefined {
  const contract = chain?.contracts?.ensUniversalResolver;
  if (contract === undefined || !("address" in contract)) {
    return undefined;
  }
  const address = contract.address;
  if (typeof address !== "string" || !address.startsWith("0x")) {
    return undefined;
  }
  return address;
}

async function resolverFromRegistry(
  client: PublicClient<Transport, Chain | undefined>,
  name: string,
  registry: `0x${string}`,
): Promise<`0x${string}`> {
  const labels = name.split(".");
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join(".");
    const resolver = await client.readContract({
      address: registry,
      abi: ensRegistryAbi,
      functionName: "resolver",
      args: [namehash(suffix)],
    });
    if (resolver !== zeroAddress) {
      return resolver;
    }
  }
  return zeroAddress;
}

/**
 * SPEC §8 / AGENTS.md: read the resolver for `name` at runtime (ENSIP-10); do not hardcode PublicResolver.
 */
export async function readResolverAddress(
  client: PublicClient<Transport, Chain | undefined>,
  name: string,
  registry: `0x${string}` = ENS_REGISTRY,
): Promise<`0x${string}`> {
  if (ensUniversalResolverAddress(client.chain) !== undefined) {
    return getEnsResolver(client, { name });
  }
  return resolverFromRegistry(client, name, registry);
}
