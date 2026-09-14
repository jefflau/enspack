import {
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
  getAddress,
  isAddress,
  isAddressEqual,
  zeroAddress,
} from "viem";
import { EnspackError } from "../../error.js";
import type { PublishCall } from "../../interfaces.js";
import { formatPublishPlan } from "../../publisher.js";
import { dnsEncodeName } from "../dns.js";
import { registryV2Abi } from "./abis.js";
import type { EnsV2Config } from "./config.js";
import {
  type NameStateV2,
  PENDING_PROXY_ADDRESS,
  REGISTRY_ROLES,
  RESOLVER_RECORD_ROLES,
  callNeedsDeploy,
  effectiveExpiry,
  encodeAuthorizeNameRoles,
  encodeDeployProxy,
  encodeGrantRootRoles,
  encodePermissionedResolverInit,
  encodeRegister,
  encodeSetParent,
  encodeSetResolver,
  encodeSetSubregistry,
  encodeUserRegistryInit,
  findExactRegistry,
  hasRootRolesV2,
  isNameAvailable,
  isPendingProxy,
  isZeroAddress,
  nameStateV2,
  readProxyDeployed,
  registrySalt,
  resolverSalt,
} from "./publisher-support.js";

type V2Client = PublicClient<Transport, Chain | undefined>;

const ROOT_DNS = dnsEncodeName("");
const OPERATOR_REGISTRY_ROLES = REGISTRY_ROLES.REGISTRAR | REGISTRY_ROLES.RENEW;

export interface EnsSetupInput {
  name: string;
  subnames: readonly string[];
  operator?: Address;
  account: Address;
}

type AddrOrSlot = Address | string;

export type SetupOp =
  | { kind: "deployResolver"; slot: string; name: string; description: string }
  | { kind: "deployRegistry"; slot: string; name: string; description: string }
  | {
      kind: "setResolver";
      registry: Address;
      label: string;
      resolver: AddrOrSlot;
      description: string;
    }
  | {
      kind: "setSubregistry";
      registry: AddrOrSlot;
      label: string;
      subregistry: AddrOrSlot;
      description: string;
    }
  | {
      kind: "setParent";
      registry: AddrOrSlot;
      parent: Address;
      label: string;
      description: string;
    }
  | {
      kind: "grantRootRoles";
      target: AddrOrSlot;
      roles: bigint;
      account: Address;
      description: string;
    }
  | {
      kind: "authorizeNameRoles";
      resolver: AddrOrSlot;
      roles: bigint;
      account: Address;
      description: string;
    }
  | {
      kind: "register";
      registry: AddrOrSlot;
      label: string;
      owner: Address;
      resolver: AddrOrSlot;
      expiry: bigint;
      description: string;
    };

export interface EnsSetupSubname {
  name: string;
  label: string;
  registry: Address;
}

export interface EnsSetupPlan {
  name: string;
  account: Address;
  operator: Address | null;
  steps: PublishCall[];
  already: string[];
  ops: SetupOp[];
  slots: Record<string, Address>;
  resolver: Address;
  registry: Address;
  subnames: EnsSetupSubname[];
}

export interface EnsSetupResult {
  name: string;
  resolver: Address;
  registry: Address;
  subnames: { name: string; registry: Address }[];
  operator: Address | null;
  txs: `0x${string}`[];
  skipped: string[];
  calls: PublishCall[];
}

export interface RunEnsSetupOpts {
  plan?: EnsSetupPlan;
  onTx?: (hash: `0x${string}`, description: string) => void;
}

function resolverSlot(name: string): string {
  return `resolver:${name}`;
}

function registrySlot(name: string): string {
  return `registry:${name}`;
}

function isSlotKey(ref: AddrOrSlot): ref is string {
  return !isAddress(ref, { strict: false });
}

function resolveAddr(ref: AddrOrSlot, slots: Record<string, Address>): Address {
  if (!isSlotKey(ref)) {
    return ref;
  }
  return slots[ref] ?? PENDING_PROXY_ADDRESS;
}

function knownOrPending(ref: AddrOrSlot, slots: Record<string, Address>): Address {
  return resolveAddr(ref, slots);
}

function parseSubnameLabel(raw: string): string {
  if (raw === "" || raw.includes(".")) {
    throw new EnspackError("PUBLISH", `subname ${JSON.stringify(raw)} must be a single label`);
  }
  return raw;
}

async function estimateCallGas(
  client: V2Client,
  account: Account | Address,
  call: PublishCall,
): Promise<bigint> {
  try {
    return await client.estimateGas({
      account,
      to: call.to,
      data: call.data,
      prepare: false,
    });
  } catch (cause) {
    throw new EnspackError("PUBLISH", `gas estimation failed: ${call.description}`, cause);
  }
}

async function fillDryRunGas(
  client: V2Client,
  account: Account | Address,
  calls: PublishCall[],
): Promise<void> {
  if (calls.length === 0) {
    return;
  }
  for (const call of calls) {
    if (callNeedsDeploy(call)) {
      continue;
    }
    try {
      call.gas = await estimateCallGas(client, account, call);
    } catch {
      // Dry-run still prints the plan when a later pending proxy blocks estimation.
    }
  }
}

export function encodeSetupOp(
  op: SetupOp,
  cfg: EnsV2Config,
  account: Address,
  slots: Record<string, Address>,
): PublishCall {
  switch (op.kind) {
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
    case "setResolver":
      return {
        to: op.registry,
        data: encodeSetResolver(op.label, resolveAddr(op.resolver, slots)),
        description: op.description,
      };
    case "setSubregistry":
      return {
        to: resolveAddr(op.registry, slots),
        data: encodeSetSubregistry(op.label, resolveAddr(op.subregistry, slots)),
        description: op.description,
      };
    case "setParent":
      return {
        to: resolveAddr(op.registry, slots),
        data: encodeSetParent(op.parent, op.label),
        description: op.description,
      };
    case "grantRootRoles":
      return {
        to: resolveAddr(op.target, slots),
        data: encodeGrantRootRoles(op.roles, op.account),
        description: op.description,
      };
    case "authorizeNameRoles":
      return {
        to: resolveAddr(op.resolver, slots),
        data: encodeAuthorizeNameRoles(ROOT_DNS, op.roles, op.account, true),
        description: op.description,
      };
    case "register":
      return {
        to: resolveAddr(op.registry, slots),
        data: encodeRegister({
          label: op.label,
          owner: op.owner,
          subregistry: zeroAddress,
          resolver: resolveAddr(op.resolver, slots),
          expiry: op.expiry,
        }),
        description: op.description,
      };
  }
}

async function readParent(
  client: V2Client,
  registry: Address,
): Promise<{ parent: Address; label: string } | null> {
  try {
    const [parent, label] = await client.readContract({
      address: registry,
      abi: registryV2Abi,
      functionName: "getParent",
    });
    return { parent, label };
  } catch {
    return null;
  }
}

async function setParentWouldRevert(
  client: V2Client,
  account: Address,
  registry: Address,
  parent: Address,
  label: string,
): Promise<boolean> {
  try {
    await client.simulateContract({
      account,
      address: registry,
      abi: registryV2Abi,
      functionName: "setParent",
      args: [parent, label],
    });
    return false;
  } catch {
    return true;
  }
}

function pendingNote(ref: AddrOrSlot): string {
  return isSlotKey(ref) ? "<pending proxy>" : ref;
}

/**
 * Idempotent ENSv2 on-chain setup plan for a name the signer already owns.
 * Does not send transactions.
 */
export async function planEnsSetup(
  client: V2Client,
  cfg: EnsV2Config,
  input: EnsSetupInput,
): Promise<EnsSetupPlan> {
  const account = getAddress(input.account);
  const name = input.name;
  if (name === "" || name.startsWith(".") || name.endsWith(".")) {
    throw new EnspackError("RESOLVE", `invalid ENS name "${name}"`);
  }
  const subLabels = input.subnames.map(parseSubnameLabel);

  let operator: Address | null = null;
  if (input.operator !== undefined) {
    if (!isAddress(input.operator, { strict: false })) {
      throw new EnspackError("PUBLISH", "operator is not a valid address");
    }
    const op = getAddress(input.operator);
    operator = isAddressEqual(op, account) ? null : op;
  }

  const state = await nameStateV2(client, cfg, name);
  if (isNameAvailable(state) || !isAddressEqual(state.owner, account)) {
    throw new EnspackError("PUBLISH", `register ${name} first (ENS Sepolia app) with this wallet`);
  }

  const ops: SetupOp[] = [];
  const already: string[] = [];
  const slots: Record<string, Address> = {};
  const resSlot = resolverSlot(name);
  const regSlot = registrySlot(name);

  if (operator === null && input.operator !== undefined) {
    already.push("operator is the signer; root roles already granted on initialize");
  }

  let resolverRef: AddrOrSlot;
  let resolverWritable = false;
  if (!isZeroAddress(state.resolver)) {
    slots[resSlot] = state.resolver;
    resolverWritable = await hasRootRolesV2(client, state.resolver, RESOLVER_RECORD_ROLES, account);
  }
  if (isZeroAddress(state.resolver) || !resolverWritable) {
    ops.push({
      kind: "deployResolver",
      slot: resSlot,
      name,
      description: `VerifiableFactory.deployProxy(PermissionedResolverImpl, salt=enspack:resolver:${name})`,
    });
    ops.push({
      kind: "setResolver",
      registry: state.parentRegistry,
      label: state.label,
      resolver: resSlot,
      description: `setResolver(${state.label} → <pending proxy>)`,
    });
    resolverRef = resSlot;
  } else {
    already.push("resolver already set and writable");
    resolverRef = state.resolver;
  }

  let registry = state.subregistry;
  if (isZeroAddress(registry)) {
    const existing = await findExactRegistry(client, cfg, name);
    if (!isZeroAddress(existing)) {
      registry = existing;
    }
  }
  let registryRef: AddrOrSlot;
  if (!isZeroAddress(registry)) {
    slots[regSlot] = registry;
  }
  if (isZeroAddress(registry)) {
    ops.push({
      kind: "deployRegistry",
      slot: regSlot,
      name,
      description: `VerifiableFactory.deployProxy(UserRegistryImpl, salt=enspack:registry:${name})`,
    });
    ops.push({
      kind: "setSubregistry",
      registry: state.parentRegistry,
      label: state.label,
      subregistry: regSlot,
      description: `setSubregistry(${state.label} → <pending proxy>)`,
    });
    registryRef = regSlot;
  } else if (isZeroAddress(state.subregistry)) {
    ops.push({
      kind: "setSubregistry",
      registry: state.parentRegistry,
      label: state.label,
      subregistry: registry,
      description: `setSubregistry(${state.label} → ${registry})`,
    });
    registryRef = registry;
  } else {
    already.push("registry already set");
    registryRef = registry;
  }

  if (isSlotKey(registryRef)) {
    ops.push({
      kind: "setParent",
      registry: registryRef,
      parent: state.parentRegistry,
      label: state.label,
      description: `setParent(${state.parentRegistry}, ${state.label})`,
    });
  } else {
    const current = await readParent(client, registryRef);
    const matches =
      current !== null &&
      isAddressEqual(current.parent, state.parentRegistry) &&
      current.label === state.label;
    if (matches) {
      already.push("setParent already matches");
    } else {
      const hasSetParent = await hasRootRolesV2(
        client,
        registryRef,
        REGISTRY_ROLES.SET_PARENT,
        account,
      );
      if (!hasSetParent) {
        already.push("setParent skipped (account lacks SET_PARENT)");
      } else if (
        await setParentWouldRevert(client, account, registryRef, state.parentRegistry, state.label)
      ) {
        already.push("setParent skipped (simulation reverted)");
      } else {
        ops.push({
          kind: "setParent",
          registry: registryRef,
          parent: state.parentRegistry,
          label: state.label,
          description: `setParent(${state.parentRegistry}, ${state.label})`,
        });
      }
    }
  }

  if (operator !== null) {
    if (!isSlotKey(registryRef)) {
      const has = await hasRootRolesV2(client, registryRef, OPERATOR_REGISTRY_ROLES, operator);
      if (has) {
        already.push("operator already has REGISTRAR|RENEW on registry");
      } else {
        ops.push({
          kind: "grantRootRoles",
          target: registryRef,
          roles: OPERATOR_REGISTRY_ROLES,
          account: operator,
          description: `grantRootRoles(REGISTRAR|RENEW, ${operator})`,
        });
      }
    } else {
      ops.push({
        kind: "grantRootRoles",
        target: registryRef,
        roles: OPERATOR_REGISTRY_ROLES,
        account: operator,
        description: `grantRootRoles(REGISTRAR|RENEW, ${operator})`,
      });
    }
    if (!isSlotKey(resolverRef)) {
      const has = await hasRootRolesV2(client, resolverRef, RESOLVER_RECORD_ROLES, operator);
      if (has) {
        already.push("operator already has SET_TEXT|SET_CONTENTHASH on resolver");
      } else {
        ops.push({
          kind: "authorizeNameRoles",
          resolver: resolverRef,
          roles: RESOLVER_RECORD_ROLES,
          account: operator,
          description: `authorizeNameRoles(dnsEncode(""), SET_TEXT|SET_CONTENTHASH, ${operator}, true)`,
        });
      }
    } else {
      ops.push({
        kind: "authorizeNameRoles",
        resolver: resolverRef,
        roles: RESOLVER_RECORD_ROLES,
        account: operator,
        description: `authorizeNameRoles(dnsEncode(""), SET_TEXT|SET_CONTENTHASH, ${operator}, true)`,
      });
    }
  }

  const expiryP = effectiveExpiry(state.expiry);
  const subnames: EnsSetupSubname[] = [];

  for (const label of subLabels) {
    const fqdn = `${label}.${name}`;
    const childRegSlot = registrySlot(fqdn);
    let childState: NameStateV2 | null = null;
    if (!isSlotKey(registryRef)) {
      childState = await nameStateV2(client, cfg, fqdn);
    }
    const missing = childState === null || isNameAvailable(childState);
    if (missing) {
      const expiryNote = expiryP.usedFallback ? "; parent expiry was 0, using now + 365 days" : "";
      ops.push({
        kind: "register",
        registry: registryRef,
        label,
        owner: account,
        resolver: resolverRef,
        expiry: expiryP.expiry,
        description: `Registry.register(${label} under ${name}${expiryNote})`,
      });
    } else {
      already.push(`subname ${fqdn} already registered`);
    }

    let childRegistry: Address | null = null;
    if (
      childState !== null &&
      !isNameAvailable(childState) &&
      !isZeroAddress(childState.subregistry)
    ) {
      childRegistry = childState.subregistry;
    } else if (childState !== null && !isNameAvailable(childState)) {
      const existingChild = await findExactRegistry(client, cfg, fqdn);
      if (!isZeroAddress(existingChild)) {
        childRegistry = existingChild;
      }
    }

    if (childRegistry !== null) {
      slots[childRegSlot] = childRegistry;
      if (childState !== null && isZeroAddress(childState.subregistry)) {
        ops.push({
          kind: "setSubregistry",
          registry: registryRef,
          label,
          subregistry: childRegistry,
          description: `setSubregistry(${label} → ${childRegistry})`,
        });
      } else {
        already.push(`subname ${fqdn} already has a UserRegistry`);
      }
      if (operator !== null) {
        const has = await hasRootRolesV2(client, childRegistry, OPERATOR_REGISTRY_ROLES, operator);
        if (has) {
          already.push(`operator already has REGISTRAR|RENEW on ${fqdn} registry`);
        } else {
          ops.push({
            kind: "grantRootRoles",
            target: childRegistry,
            roles: OPERATOR_REGISTRY_ROLES,
            account: operator,
            description: `grantRootRoles(REGISTRAR|RENEW, ${operator}) on ${fqdn}`,
          });
        }
      }
      subnames.push({ name: fqdn, label, registry: childRegistry });
    } else {
      ops.push({
        kind: "deployRegistry",
        slot: childRegSlot,
        name: fqdn,
        description: `VerifiableFactory.deployProxy(UserRegistryImpl, salt=enspack:registry:${fqdn})`,
      });
      ops.push({
        kind: "setSubregistry",
        registry: registryRef,
        label,
        subregistry: childRegSlot,
        description: `setSubregistry(${label} → ${pendingNote(childRegSlot)})`,
      });
      if (operator !== null) {
        ops.push({
          kind: "grantRootRoles",
          target: childRegSlot,
          roles: OPERATOR_REGISTRY_ROLES,
          account: operator,
          description: `grantRootRoles(REGISTRAR|RENEW, ${operator}) on ${fqdn}`,
        });
      }
      subnames.push({ name: fqdn, label, registry: PENDING_PROXY_ADDRESS });
    }
  }

  const steps = ops.map((op) => encodeSetupOp(op, cfg, account, slots));
  await fillDryRunGas(client, account, steps);

  return {
    name,
    account,
    operator,
    steps,
    already,
    ops,
    slots,
    resolver: knownOrPending(resolverRef, slots),
    registry: knownOrPending(registryRef, slots),
    subnames,
  };
}

function slotForSetupDeploy(op: SetupOp): string | undefined {
  if (op.kind === "deployRegistry" || op.kind === "deployResolver") {
    return op.slot;
  }
  return undefined;
}

async function maybeSkipSetParent(
  client: V2Client,
  account: Address,
  op: Extract<SetupOp, { kind: "setParent" }>,
  slots: Record<string, Address>,
  already: string[],
): Promise<boolean> {
  const to = resolveAddr(op.registry, slots);
  if (isPendingProxy(to) || isZeroAddress(to)) {
    already.push("setParent skipped (registry not deployed)");
    return true;
  }
  const current = await readParent(client, to);
  if (current !== null && isAddressEqual(current.parent, op.parent) && current.label === op.label) {
    already.push("setParent already matches");
    return true;
  }
  if (await setParentWouldRevert(client, account, to, op.parent, op.label)) {
    already.push("setParent skipped (simulation reverted)");
    return true;
  }
  return false;
}

/**
 * Execute an ENSv2 setup plan sequentially, resolving VerifiableFactory proxy
 * addresses from `ProxyDeployed` receipts.
 */
export async function runEnsSetup(
  client: V2Client,
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  cfg: EnsV2Config,
  input: EnsSetupInput,
  opts: RunEnsSetupOpts = {},
): Promise<EnsSetupResult> {
  const account = wallet.account;
  if (account === undefined) {
    throw new EnspackError("PUBLISH", "ens-setup requires a wallet");
  }
  const address = getAddress(account.address);
  const plan = opts.plan ?? (await planEnsSetup(client, cfg, { ...input, account: address }));
  const slots: Record<string, Address> = { ...plan.slots };
  const already = [...plan.already];
  const txs: `0x${string}`[] = [];
  const calls: PublishCall[] = [];
  const chain = wallet.chain ?? client.chain ?? null;

  for (const op of plan.ops) {
    if (op.kind === "setParent") {
      const skip = await maybeSkipSetParent(client, address, op, slots, already);
      if (skip) {
        continue;
      }
    }
    const call = encodeSetupOp(op, cfg, address, slots);
    if (callNeedsDeploy(call) && op.kind !== "deployRegistry" && op.kind !== "deployResolver") {
      throw new EnspackError(
        "PUBLISH",
        `cannot send ${call.description}: dependent proxy was not deployed`,
      );
    }
    call.gas = await estimateCallGas(client, account, call);
    let hash: `0x${string}`;
    try {
      hash = await wallet.sendTransaction({
        to: call.to,
        data: call.data,
        gas: call.gas,
        account,
        chain,
      });
    } catch (cause) {
      throw new EnspackError("PUBLISH", `transaction failed: ${call.description}`, cause);
    }
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new EnspackError("PUBLISH", `transaction reverted: ${call.description}`);
    }
    const slotName = slotForSetupDeploy(op);
    if (slotName !== undefined) {
      slots[slotName] = readProxyDeployed(receipt);
    }
    txs.push(hash);
    calls.push(call);
    opts.onTx?.(hash, call.description);
  }

  const after = await nameStateV2(client, cfg, plan.name);
  const subnames: { name: string; registry: Address }[] = [];
  for (const sub of plan.subnames) {
    const child = await nameStateV2(client, cfg, sub.name);
    subnames.push({ name: sub.name, registry: child.subregistry });
  }

  return {
    name: plan.name,
    resolver: after.resolver,
    registry: after.subregistry,
    subnames,
    operator: plan.operator,
    txs,
    skipped: already,
    calls,
  };
}

/** `formatPublishPlan` lines plus `skip:` for already-satisfied steps. */
export function formatEnsSetupPlan(plan: EnsSetupPlan): string {
  const skips = plan.already.map((line) => `skip: ${line}`);
  const steps = plan.steps.length > 0 ? formatPublishPlan(plan.steps) : "";
  return [...skips, steps].filter((line) => line.length > 0).join("\n");
}

export function ensSetupResultJson(
  result: Pick<
    EnsSetupResult,
    "name" | "resolver" | "registry" | "subnames" | "operator" | "txs" | "skipped"
  >,
): {
  name: string;
  resolver: Address;
  registry: Address;
  subnames: { name: string; registry: Address }[];
  operator: Address | null;
  txs: `0x${string}`[];
  skipped: string[];
} {
  return {
    name: result.name,
    resolver: result.resolver,
    registry: result.registry,
    subnames: result.subnames,
    operator: result.operator,
    txs: result.txs,
    skipped: result.skipped,
  };
}
