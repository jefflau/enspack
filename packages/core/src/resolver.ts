import {
  type Chain,
  type PublicClient,
  type Transport,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  isAddressEqual,
  zeroAddress,
} from "viem";
import { getEnsText, namehash } from "viem/ens";
import { ENS_REGISTRY, MAGNET_RE, SPEC_STRING, TEXT_KEYS } from "./constants.js";
import { contenthashResolverAbi, textResolverAbi, universalResolverAbi } from "./ens/abis.js";
import {
  type EnspackChainName,
  chainOf,
  ensUniversalResolverAddress,
  publicClientFor,
  readResolverAddress,
} from "./ens/client.js";
import { decodeContenthashToCid, isEmptyContenthash } from "./ens/contenthash.js";
import { dnsEncodeName } from "./ens/dns.js";
import { EnspackError, isEnspackError } from "./error.js";
import type { ManifestStore, Resolved, Resolver } from "./interfaces.js";
import { isVersionLabel, namehashOf, parseRef } from "./labels.js";
import { validateManifest } from "./validate.js";

/** WP-02: options for `createResolver`. RPC URLs come from the call site, never from disk. */
export interface CreateResolverOptions {
  transport?: Transport;
  rpcUrl?: string;
  chain?: EnspackChainName;
  client?: PublicClient<Transport, Chain | undefined>;
  store?: ManifestStore;
  registry?: `0x${string}`;
}

function wrapResolve(err: unknown, message: string): never {
  if (isEnspackError(err)) {
    throw err;
  }
  throw new EnspackError("RESOLVE", message, err);
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return value;
}

async function readContenthash(
  client: PublicClient<Transport, Chain | undefined>,
  name: string,
  resolverAddress: `0x${string}`,
): Promise<`0x${string}` | null> {
  const node = namehash(name);
  const inner = encodeFunctionData({
    abi: contenthashResolverAbi,
    functionName: "contenthash",
    args: [node],
  });
  const ur = ensUniversalResolverAddress(client.chain);
  if (ur !== undefined) {
    try {
      const [data] = await client.readContract({
        address: ur,
        abi: universalResolverAbi,
        functionName: "resolve",
        args: [dnsEncodeName(name), inner],
      });
      if (data === "0x" || isEmptyContenthash(data)) {
        return null;
      }
      const decoded = decodeFunctionResult({
        abi: contenthashResolverAbi,
        functionName: "contenthash",
        data,
      });
      if (isEmptyContenthash(decoded)) {
        return null;
      }
      return decoded;
    } catch (err) {
      wrapResolve(err, `failed to read contenthash for ${name}`);
    }
  }

  try {
    const decoded = await client.readContract({
      address: resolverAddress,
      abi: contenthashResolverAbi,
      functionName: "contenthash",
      args: [node],
    });
    if (isEmptyContenthash(decoded)) {
      return null;
    }
    return decoded;
  } catch (err) {
    wrapResolve(err, `failed to read contenthash for ${name}`);
  }
}

async function readText(
  client: PublicClient<Transport, Chain | undefined>,
  name: string,
  key: string,
  resolverAddress: `0x${string}`,
): Promise<string | null> {
  if (ensUniversalResolverAddress(client.chain) !== undefined) {
    try {
      return emptyToNull(await getEnsText(client, { name, key }));
    } catch (err) {
      wrapResolve(err, `failed to read text record ${key} for ${name}`);
    }
  }
  try {
    const value = await client.readContract({
      address: resolverAddress,
      abi: textResolverAbi,
      functionName: "text",
      args: [namehash(name), key],
    });
    return emptyToNull(value);
  } catch (err) {
    wrapResolve(err, `failed to read text record ${key} for ${name}`);
  }
}

function clientFor(opts: CreateResolverOptions): PublicClient<Transport, Chain | undefined> {
  if (opts.client !== undefined) {
    return opts.client;
  }
  if (opts.chain === undefined) {
    throw new EnspackError("RESOLVE", "createResolver requires chain when client is not provided");
  }
  if (opts.transport !== undefined) {
    return createPublicClient({
      chain: chainOf(opts.chain),
      transport: opts.transport,
    });
  }
  if (opts.rpcUrl !== undefined) {
    return publicClientFor(opts.chain, opts.rpcUrl);
  }
  throw new EnspackError("RESOLVE", "createResolver requires client, transport, or rpcUrl");
}

function configuredChainName(
  opts: CreateResolverOptions,
  client: PublicClient<Transport, Chain | undefined>,
): EnspackChainName | undefined {
  if (opts.chain !== undefined) {
    return opts.chain;
  }
  const id = client.chain?.id;
  if (id === 1) {
    return "mainnet";
  }
  if (id === 11_155_111) {
    return "sepolia";
  }
  return undefined;
}

function firstLabel(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

function manifestMatchesNode(
  name: string,
  node: `0x${string}`,
  manifestName: string,
  manifestModel: string,
): boolean {
  if (namehashOf(manifestName) === node) {
    return true;
  }
  return !isVersionLabel(firstLabel(name)) && namehashOf(manifestModel) === node;
}

/**
 * SPEC §4 steps 1–6: ENS read path (contenthash → verified manifest → magnet fallback).
 * Lockfile CID matching (step 5) is not performed here; WP-07/WP-08 own `enspack.lock`.
 */
export function createResolver(opts: CreateResolverOptions): Resolver {
  const client = clientFor(opts);
  const store = opts.store;
  const registry = opts.registry ?? ENS_REGISTRY;
  const defaultChain = configuredChainName(opts, client);

  return {
    async resolve(ref, resolveOpts) {
      if (
        resolveOpts?.chain !== undefined &&
        defaultChain !== undefined &&
        resolveOpts.chain !== defaultChain
      ) {
        throw new EnspackError(
          "RESOLVE",
          `chain ${resolveOpts.chain} does not match resolver chain ${defaultChain}`,
        );
      }

      let name: string;
      try {
        name = parseRef(ref).name;
      } catch (err) {
        wrapResolve(err, `invalid ref "${ref}"`);
      }
      const node = namehashOf(name);

      let resolverAddress: `0x${string}`;
      try {
        resolverAddress = await readResolverAddress(client, name, registry);
      } catch (err) {
        wrapResolve(err, `${name} has no resolver`);
      }
      if (isAddressEqual(resolverAddress, zeroAddress)) {
        throw new EnspackError("RESOLVE", `${name} has no resolver`);
      }

      const contenthashHex = await readContenthash(client, name, resolverAddress);
      const cid = contenthashHex === null ? null : decodeContenthashToCid(contenthashHex);

      const spec = await readText(client, name, TEXT_KEYS.spec, resolverAddress);
      const magnet = await readText(client, name, TEXT_KEYS.magnet, resolverAddress);

      let manifest: Resolved["manifest"] = null;
      let manifestBytes: Uint8Array | null = null;

      if (cid !== null && store !== undefined) {
        const bytes = await store.getVerified(cid);
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch (cause) {
          throw new EnspackError("VERIFY", "manifest is not valid JSON", cause);
        }
        const validated = validateManifest(parsed);
        if (validated.spec !== SPEC_STRING) {
          throw new EnspackError("VERIFY", `manifest spec must be ${SPEC_STRING}`);
        }
        if (!manifestMatchesNode(name, node, validated.name, validated.model)) {
          throw new EnspackError("VERIFY", "manifest name does not match resolved name");
        }
        manifest = validated;
        manifestBytes = bytes;
      }

      if (cid === null) {
        if (magnet !== null) {
          if (!MAGNET_RE.test(magnet)) {
            throw new EnspackError("RESOLVE", `magnet for ${name} does not match SPEC`);
          }
          return { name, node, cid: null, magnet, spec, manifest: null, manifestBytes: null };
        }
        throw new EnspackError("RESOLVE", `${name} has no enspack records`);
      }

      return { name, node, cid, magnet, spec, manifest, manifestBytes };
    },
  };
}
