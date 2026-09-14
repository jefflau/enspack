import {
  type Address,
  type Hex,
  type TransactionReceipt,
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  parseEventLogs,
  toBytes,
  zeroAddress,
} from "viem";
import { EnspackError } from "../../error.js";
import type { PublishCall } from "../../interfaces.js";
import { permissionedResolverAbi, registryV2Abi, verifiableFactoryAbi } from "./abis.js";
import type { EnsV2Config } from "./config.js";
import { type NameStateV2, labelId } from "./discovery.js";
import {
  NAME_OWNER_ROLES,
  RESOLVER_ADMIN_ROLES,
  RESOLVER_ROLES,
  USER_REGISTRY_ROOT_ROLES,
} from "./roles.js";

export type { EnsV2Config } from "./config.js";
export type { NameStateV2 } from "./discovery.js";
export {
  NAME_OWNER_ROLES,
  REGISTRY_ROLES,
  RESOLVER_ADMIN_ROLES,
  RESOLVER_ROLES,
  USER_REGISTRY_ROOT_ROLES,
} from "./roles.js";

export const RESOLVER_RECORD_ROLES = RESOLVER_ROLES.SET_TEXT | RESOLVER_ROLES.SET_CONTENTHASH;
export {
  findExactRegistry,
  hasRolesV2,
  hasRootRolesV2,
  labelId,
  nameStateV2,
} from "./discovery.js";
export { permissionedResolverAbi, registryV2Abi, verifiableFactoryAbi } from "./abis.js";

/** Dry-run stand-in for a VerifiableFactory proxy that has not been mined yet (issue #17). */
export const PENDING_PROXY_ADDRESS = "0xdefa17a1defa17a1defa17a1defa17a1defa17a1" as Address;

const YEAR_SECONDS = 365n * 24n * 60n * 60n;

export function registrySalt(name: string): bigint {
  return BigInt(keccak256(toBytes(`enspack:registry:${name}`)));
}

export function resolverSalt(name: string): bigint {
  return BigInt(keccak256(toBytes(`enspack:resolver:${name}`)));
}

export function isZeroAddress(value: Address | null | undefined): boolean {
  return value === undefined || value === null || isAddressEqual(value, zeroAddress);
}

export function isPendingProxy(value: Address): boolean {
  return isAddressEqual(value, PENDING_PROXY_ADDRESS);
}

export function isNameAvailable(state: NameStateV2): boolean {
  return state.missingFrom !== undefined || isZeroAddress(state.owner) || state.status === 0;
}

export function effectiveExpiry(onChain: bigint | undefined | null): {
  expiry: bigint;
  usedFallback: boolean;
} {
  if (onChain === undefined || onChain === null || onChain === 0n) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    return { expiry: now + YEAR_SECONDS, usedFallback: true };
  }
  return { expiry: onChain, usedFallback: false };
}

export function encodeUserRegistryInit(account: Address): Hex {
  return encodeFunctionData({
    abi: registryV2Abi,
    functionName: "initialize",
    args: [account, USER_REGISTRY_ROOT_ROLES],
  });
}

export function encodePermissionedResolverInit(account: Address): Hex {
  return encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "initialize",
    args: [account, RESOLVER_ADMIN_ROLES, []],
  });
}

export function encodeDeployProxy(implementation: Address, salt: bigint, init: Hex): Hex {
  return encodeFunctionData({
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [implementation, salt, init],
  });
}

export function encodeSetSubregistry(label: string, subregistry: Address): Hex {
  return encodeFunctionData({
    abi: registryV2Abi,
    functionName: "setSubregistry",
    args: [labelId(label), subregistry],
  });
}

export function encodeSetResolver(label: string, resolver: Address): Hex {
  return encodeFunctionData({
    abi: registryV2Abi,
    functionName: "setResolver",
    args: [labelId(label), resolver],
  });
}

export function encodeRegister(args: {
  label: string;
  owner: Address;
  subregistry: Address;
  resolver: Address;
  expiry: bigint;
}): Hex {
  return encodeFunctionData({
    abi: registryV2Abi,
    functionName: "register",
    args: [args.label, args.owner, args.subregistry, args.resolver, NAME_OWNER_ROLES, args.expiry],
  });
}

export function encodeResolverMulticall(inner: Hex[]): Hex {
  return encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "multicall",
    args: [inner],
  });
}

export function encodeGrantRootRoles(roleBitmap: bigint, account: Address): Hex {
  return encodeFunctionData({
    abi: registryV2Abi,
    functionName: "grantRootRoles",
    args: [roleBitmap, account],
  });
}

export function encodeSetParent(parent: Address, label: string): Hex {
  return encodeFunctionData({
    abi: registryV2Abi,
    functionName: "setParent",
    args: [parent, label],
  });
}

export function encodeAuthorizeNameRoles(
  toName: Hex,
  roleBitmap: bigint,
  account: Address,
  grant: boolean,
): Hex {
  return encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "authorizeNameRoles",
    args: [toName, roleBitmap, account, grant],
  });
}

export type AddressSlot = "publisherRegistry" | "publisherResolver" | "modelRegistry";

export type AddressRef = Address | { slot: AddressSlot };

export type PlannedOp =
  | {
      kind: "deployRegistry";
      slot: AddressSlot;
      name: string;
      setup: boolean;
      description: string;
    }
  | {
      kind: "deployResolver";
      slot: AddressSlot;
      name: string;
      setup: boolean;
      description: string;
    }
  | {
      kind: "setSubregistry";
      registry: AddressRef;
      label: string;
      subregistry: AddressRef;
      setup: boolean;
      description: string;
    }
  | {
      kind: "setResolver";
      registry: AddressRef;
      label: string;
      resolver: AddressRef;
      setup: boolean;
      description: string;
    }
  | {
      kind: "register";
      registry: AddressRef;
      label: string;
      owner: Address;
      subregistry: AddressRef | "zero";
      resolver: AddressRef;
      expiry: bigint;
      setup: boolean;
      description: string;
    }
  | {
      kind: "multicall";
      resolver: AddressRef;
      inner: Hex[];
      setup: boolean;
      description: string;
    };

function resolveRef(ref: AddressRef, slots: Partial<Record<AddressSlot, Address>>): Address {
  if (typeof ref === "string") {
    return ref;
  }
  return slots[ref.slot] ?? PENDING_PROXY_ADDRESS;
}

export function encodePlannedOp(
  op: PlannedOp,
  cfg: EnsV2Config,
  account: Address,
  slots: Partial<Record<AddressSlot, Address>>,
): PublishCall {
  switch (op.kind) {
    case "deployRegistry":
      return {
        to: cfg.verifiableFactory,
        data: encodeDeployProxy(
          cfg.userRegistryImpl,
          registrySalt(op.name),
          encodeUserRegistryInit(account),
        ),
        description: op.description,
      };
    case "deployResolver":
      return {
        to: cfg.verifiableFactory,
        data: encodeDeployProxy(
          cfg.permissionedResolverImpl,
          resolverSalt(op.name),
          encodePermissionedResolverInit(account),
        ),
        description: op.description,
      };
    case "setSubregistry":
      return {
        to: resolveRef(op.registry, slots),
        data: encodeSetSubregistry(op.label, resolveRef(op.subregistry, slots)),
        description: op.description,
      };
    case "setResolver":
      return {
        to: resolveRef(op.registry, slots),
        data: encodeSetResolver(op.label, resolveRef(op.resolver, slots)),
        description: op.description,
      };
    case "register":
      return {
        to: resolveRef(op.registry, slots),
        data: encodeRegister({
          label: op.label,
          owner: op.owner,
          subregistry: op.subregistry === "zero" ? zeroAddress : resolveRef(op.subregistry, slots),
          resolver: resolveRef(op.resolver, slots),
          expiry: op.expiry,
        }),
        description: op.description,
      };
    case "multicall":
      return {
        to: resolveRef(op.resolver, slots),
        data: encodeResolverMulticall(op.inner),
        description: op.description,
      };
  }
}

/** True when this call's `to` or calldata still contains the dry-run proxy placeholder. */
export function callNeedsDeploy(call: PublishCall): boolean {
  const pending = PENDING_PROXY_ADDRESS.slice(2).toLowerCase();
  return isPendingProxy(call.to) || call.data.toLowerCase().includes(pending);
}

export function readProxyDeployed(receipt: TransactionReceipt): Address {
  const logs = parseEventLogs({
    abi: verifiableFactoryAbi,
    eventName: "ProxyDeployed",
    logs: receipt.logs,
  });
  const first = logs[0];
  if (first === undefined) {
    throw new EnspackError("PUBLISH", "deployProxy receipt missing ProxyDeployed");
  }
  const proxy = first.args.proxyAddress;
  if (proxy === undefined) {
    throw new EnspackError("PUBLISH", "ProxyDeployed log missing proxy address");
  }
  return proxy;
}

export function slotForDeploy(op: PlannedOp): AddressSlot | undefined {
  if (op.kind === "deployRegistry" || op.kind === "deployResolver") {
    return op.slot;
  }
  return undefined;
}
