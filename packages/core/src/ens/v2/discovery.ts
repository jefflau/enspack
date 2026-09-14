import {
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  keccak256,
  toBytes,
  zeroAddress,
} from "viem";
import { EnspackError, isEnspackError } from "../../error.js";
import { dnsEncodeName } from "../dns.js";
import { registryV2Abi, universalResolverV2Abi } from "./abis.js";
import type { EnsV2Config } from "./config.js";

type V2Client = PublicClient<Transport, Chain | undefined>;

function wrapResolve(err: unknown, message: string): never {
  if (isEnspackError(err)) {
    throw err;
  }
  throw new EnspackError("RESOLVE", message, err);
}

/** SPEC §1 / issue #17: `uint256(keccak256(bytes(label)))` accepted as anyId. */
export function labelId(label: string): bigint {
  return BigInt(keccak256(toBytes(label)));
}

/** Issue #17: ENSv2 root registry from UniversalResolverV2.ROOT_REGISTRY(). */
export async function rootRegistry(client: V2Client, cfg: EnsV2Config, _name?: string): Promise<Address> {
  try {
    return await client.readContract({
      address: cfg.universalResolver,
      abi: universalResolverV2Abi,
      functionName: "ROOT_REGISTRY",
    });
  } catch (err) {
    wrapResolve(err, "failed to read ENSv2 ROOT_REGISTRY");
  }
}

/** Issue #17: UniversalResolverV2.findExactRegistry for a DNS-encoded name. */
export async function findExactRegistry(
  client: V2Client,
  cfg: EnsV2Config,
  name: string,
): Promise<Address> {
  try {
    return await client.readContract({
      address: cfg.universalResolver,
      abi: universalResolverV2Abi,
      functionName: "findExactRegistry",
      args: [dnsEncodeName(name)],
    });
  } catch (err) {
    wrapResolve(err, `failed to findExactRegistry for ${name}`);
  }
}

/** Issue #17: UniversalResolverV2.findParentRegistry for a DNS-encoded name. */
export async function findParentRegistry(
  client: V2Client,
  cfg: EnsV2Config,
  name: string,
): Promise<Address> {
  try {
    return await client.readContract({
      address: cfg.universalResolver,
      abi: universalResolverV2Abi,
      functionName: "findParentRegistry",
      args: [dnsEncodeName(name)],
    });
  } catch (err) {
    wrapResolve(err, `failed to findParentRegistry for ${name}`);
  }
}

/** Issue #17: UniversalResolverV2.findResolver (ENSIP-10) for a DNS-encoded name. */
export async function findResolverV2(
  client: V2Client,
  cfg: EnsV2Config,
  name: string,
): Promise<{ resolver: Address; node: `0x${string}`; offset: bigint }> {
  try {
    const [resolver, node, offset] = await client.readContract({
      address: cfg.universalResolver,
      abi: universalResolverV2Abi,
      functionName: "findResolver",
      args: [dnsEncodeName(name)],
    });
    return { resolver, node, offset };
  } catch (err) {
    wrapResolve(err, `${name} has no resolver`);
  }
}

/** Issue #17: UniversalResolverV2.findOwner for a DNS-encoded name. */
export async function findOwnerV2(client: V2Client, cfg: EnsV2Config, name: string): Promise<Address> {
  try {
    return await client.readContract({
      address: cfg.universalResolver,
      abi: universalResolverV2Abi,
      functionName: "findOwner",
      args: [dnsEncodeName(name)],
    });
  } catch (err) {
    wrapResolve(err, `failed to findOwner for ${name}`);
  }
}

/** Walk result for an ENSv2 name (issue #17); `missingFrom` is set when getSubregistry returns zero. */
export interface NameStateV2 {
  name: string;
  label: string;
  parentRegistry: Address;
  tokenIdOrLabelId: bigint;
  owner: Address;
  expiry: bigint;
  resolver: Address;
  subregistry: Address;
  status: number;
  missingFrom?: string;
}

function emptyState(
  name: string,
  label: string,
  parentRegistry: Address,
  missingFrom: string,
): NameStateV2 {
  return {
    name,
    label,
    parentRegistry,
    tokenIdOrLabelId: 0n,
    owner: zeroAddress,
    expiry: 0n,
    resolver: zeroAddress,
    subregistry: zeroAddress,
    status: 0,
    missingFrom,
  };
}

/** Issue #17: walk ROOT_REGISTRY → getSubregistry(label) from the TLD down. */
export async function nameStateV2(client: V2Client, cfg: EnsV2Config, name: string): Promise<NameStateV2> {
  const labels = name.split(".");
  const leaf = labels[0];
  if (leaf === undefined || leaf === "") {
    throw new EnspackError("RESOLVE", `invalid ENSv2 name "${name}"`);
  }
  const root = await rootRegistry(client, cfg, name);
  let parentRegistry = root;
  for (let i = labels.length - 1; i >= 1; i--) {
    const step = labels[i];
    if (step === undefined || step === "") {
      throw new EnspackError("RESOLVE", `invalid ENSv2 name "${name}"`);
    }
    let next: Address;
    try {
      next = await client.readContract({
        address: parentRegistry,
        abi: registryV2Abi,
        functionName: "getSubregistry",
        args: [step],
      });
    } catch (err) {
      wrapResolve(err, `failed to walk ENSv2 registries for ${name}`);
    }
    if (next === zeroAddress) {
      return emptyState(name, leaf, parentRegistry, step);
    }
    parentRegistry = next;
  }

  const id = labelId(leaf);
  try {
    const [owner, expiry, resolver, subregistry, status] = await Promise.all([
      client.readContract({
        address: parentRegistry,
        abi: registryV2Abi,
        functionName: "getOwner",
        args: [id],
      }),
      client.readContract({
        address: parentRegistry,
        abi: registryV2Abi,
        functionName: "getExpiry",
        args: [id],
      }),
      client.readContract({
        address: parentRegistry,
        abi: registryV2Abi,
        functionName: "getResolver",
        args: [leaf],
      }),
      client.readContract({
        address: parentRegistry,
        abi: registryV2Abi,
        functionName: "getSubregistry",
        args: [leaf],
      }),
      client.readContract({
        address: parentRegistry,
        abi: registryV2Abi,
        functionName: "getStatus",
        args: [id],
      }),
    ]);
    return {
      name,
      label: leaf,
      parentRegistry,
      tokenIdOrLabelId: id,
      owner,
      expiry,
      resolver,
      subregistry,
      status,
    };
  } catch (err) {
    wrapResolve(err, `failed to read ENSv2 name state for ${name}`);
  }
}

/** Issue #17: hasRootRoles on a registry or PermissionedResolver. */
export async function hasRootRolesV2(
  client: V2Client,
  registryOrResolver: Address,
  roleBitmap: bigint,
  account: Address,
): Promise<boolean> {
  try {
    return await client.readContract({
      address: registryOrResolver,
      abi: registryV2Abi,
      functionName: "hasRootRoles",
      args: [roleBitmap, account],
    });
  } catch (err) {
    wrapResolve(err, "failed to read hasRootRoles");
  }
}

/** Issue #17: hasRoles on a registry resource (anyId / EAC resource). */
export async function hasRolesV2(
  client: V2Client,
  registry: Address,
  resource: bigint,
  roleBitmap: bigint,
  account: Address,
): Promise<boolean> {
  try {
    return await client.readContract({
      address: registry,
      abi: registryV2Abi,
      functionName: "hasRoles",
      args: [resource, roleBitmap, account],
    });
  } catch (err) {
    wrapResolve(err, "failed to read hasRoles");
  }
}
