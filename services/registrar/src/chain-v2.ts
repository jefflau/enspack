import {
  type EnsV2Config,
  NAME_OWNER_ROLES,
  type NameStateV2,
  REGISTRY_ROLES,
  RESOLVER_ROLES,
  SPEC_STRING,
  TEXT_KEYS,
  hasRootRolesV2,
  labelId,
  nameStateV2,
  namehashOf,
  permissionedResolverAbi,
  registryV2Abi,
} from "@enspack/core";
import { type Address, type Hex, encodeFunctionData, isAddressEqual, zeroAddress } from "viem";
import type { RegistrarChain } from "./chain.js";
import { HttpError } from "./http-error.js";

function publisherName(label: string, rootName: string): string {
  return `${label}.${rootName}`;
}

/** PermissionedRegistry.Status: AVAILABLE=0 (unregistered or expired), RESERVED=1, REGISTERED=2. */
const STATUS_AVAILABLE = 0;

/** Fallback child expiry when the root name reports 0 (never expire / unset). */
const YEAR_SECONDS = 365 * 24 * 60 * 60;

const ROOT_SETUP_HINT =
  "Run the on-chain setup in docs/ens-v2-sepolia (On-chain setup Jeff must do on Sepolia).";

function requireEnsV2(chain: RegistrarChain): EnsV2Config {
  if (chain.ensV2 === undefined) {
    throw new HttpError(500, "INTERNAL", "ensV2 config required when ensVersion is v2");
  }
  return chain.ensV2;
}

async function rootState(chain: RegistrarChain): Promise<NameStateV2> {
  return nameStateV2(chain.client, requireEnsV2(chain), chain.rootName);
}

/**
 * SPEC §7 / issue #17: publisher subnames live in enspack.eth's UserRegistry (`subregistry`).
 * Zero subregistry means the operator has not finished `docs/ens-v2-sepolia`.
 */
export async function requireRootRegistry(chain: RegistrarChain): Promise<NameStateV2> {
  const state = await rootState(chain);
  if (state.subregistry === zeroAddress) {
    throw new HttpError(
      503,
      "ROOT_REGISTRY_MISSING",
      `Root UserRegistry for ${chain.rootName} is missing (subregistry is zero). ${ROOT_SETUP_HINT}`,
    );
  }
  return state;
}

async function ownerOfLabelV2(chain: RegistrarChain, label: string): Promise<Address> {
  const root = await requireRootRegistry(chain);
  return chain.client.readContract({
    address: root.subregistry,
    abi: registryV2Abi,
    functionName: "getOwner",
    args: [labelId(label)],
  });
}

async function statusOfLabelV2(chain: RegistrarChain, label: string): Promise<number> {
  const root = await requireRootRegistry(chain);
  const status = await chain.client.readContract({
    address: root.subregistry,
    abi: registryV2Abi,
    functionName: "getStatus",
    args: [labelId(label)],
  });
  return Number(status);
}

/**
 * SPEC §7 as amended by issue #17: a label is taken when `R_ROOT.getOwner(labelId) != 0`
 * or `getStatus` is not AVAILABLE (reserved or registered; see PermissionedRegistry.sol).
 */
export async function isLabelTakenOnChainV2(
  chain: RegistrarChain,
  label: string,
): Promise<boolean> {
  const owner = await ownerOfLabelV2(chain, label);
  if (owner !== zeroAddress) {
    return true;
  }
  const status = await statusOfLabelV2(chain, label);
  return status !== STATUS_AVAILABLE;
}

/**
 * SPEC §7 / issue #17: operator holds ROLE_REGISTRAR|ROLE_RENEW on the root UserRegistry
 * and ROLE_SET_TEXT on the project resolver (`hasRootRoles`, equivalent to
 * `authorizeNameRoles(dnsEncode(""), …)` which grants ROOT_RESOURCE).
 */
export async function readOperatorApprovalV2(chain: RegistrarChain): Promise<{
  rootOwner: Address;
  approved: boolean;
  registrarApproved: boolean;
  resolverApproved: boolean;
  rootRegistry: Address;
  resolver: Address;
}> {
  const root = await requireRootRegistry(chain);
  const registrarApproved = await hasRootRolesV2(
    chain.client,
    root.subregistry,
    REGISTRY_ROLES.REGISTRAR | REGISTRY_ROLES.RENEW,
    chain.operator,
  );
  const resolver = root.resolver;
  const resolverApproved =
    resolver !== zeroAddress &&
    (await hasRootRolesV2(chain.client, resolver, RESOLVER_ROLES.SET_TEXT, chain.operator));
  return {
    rootOwner: root.owner,
    approved: registrarApproved && resolverApproved,
    registrarApproved,
    resolverApproved,
    rootRegistry: root.subregistry,
    resolver,
  };
}

async function readPublisherTexts(
  chain: RegistrarChain,
  resolver: Address,
  node: Hex,
): Promise<{ hf: string; spec: string }> {
  const hf = await chain.client.readContract({
    address: resolver,
    abi: permissionedResolverAbi,
    functionName: "text",
    args: [node, TEXT_KEYS.hf],
  });
  const spec = await chain.client.readContract({
    address: resolver,
    abi: permissionedResolverAbi,
    functionName: "text",
    args: [node, TEXT_KEYS.spec],
  });
  return { hf, spec };
}

/** Read-back helper for tests: publisher text records on the project resolver. */
export async function publisherRecordsV2(
  chain: RegistrarChain,
  label: string,
): Promise<{ hf: string; spec: string }> {
  const root = await requireRootRegistry(chain);
  if (root.resolver === zeroAddress) {
    throw new HttpError(502, "CHAIN_ERROR", `no resolver for ${chain.rootName}`);
  }
  return readPublisherTexts(chain, root.resolver, namehashOf(publisherName(label, chain.rootName)));
}

function expiryForChild(rootExpiry: bigint | number): bigint {
  const expiry = typeof rootExpiry === "bigint" ? rootExpiry : BigInt(rootExpiry);
  if (expiry === 0n) {
    return BigInt(Math.floor(Date.now() / 1000) + YEAR_SECONDS);
  }
  return expiry;
}

async function assertOperatorCanIssue(chain: RegistrarChain, root: NameStateV2): Promise<void> {
  const registrarOk = await hasRootRolesV2(
    chain.client,
    root.subregistry,
    REGISTRY_ROLES.REGISTRAR | REGISTRY_ROLES.RENEW,
    chain.operator,
  );
  if (!registrarOk) {
    throw new HttpError(
      503,
      "OPERATOR_NOT_APPROVED",
      `operator ${chain.operator} lacks ROLE_REGISTRAR | ROLE_RENEW on the root UserRegistry ${root.subregistry}. grantRootRoles(ROLE_REGISTRAR | ROLE_RENEW, operator) — ${ROOT_SETUP_HINT}`,
    );
  }
  if (root.resolver === zeroAddress) {
    throw new HttpError(
      503,
      "OPERATOR_NOT_APPROVED",
      `no project resolver on ${chain.rootName}. authorizeNameRoles(dnsEncode(""), ROLE_SET_TEXT, operator, true) — ${ROOT_SETUP_HINT}`,
    );
  }
  const resolverOk = await hasRootRolesV2(
    chain.client,
    root.resolver,
    RESOLVER_ROLES.SET_TEXT,
    chain.operator,
  );
  if (!resolverOk) {
    throw new HttpError(
      503,
      "OPERATOR_NOT_APPROVED",
      `operator ${chain.operator} lacks ROLE_SET_TEXT on the project resolver ${root.resolver}. authorizeNameRoles(dnsEncode(""), ROLE_SET_TEXT, operator, true) — ${ROOT_SETUP_HINT}`,
    );
  }
}

async function sendAndWaitV2(
  chain: RegistrarChain,
  to: Address,
  data: Hex,
  label: string,
): Promise<Hex> {
  const account = chain.wallet.account ?? chain.operator;
  let gas: bigint;
  try {
    gas = await chain.client.estimateGas({
      account,
      to,
      data,
    });
  } catch (err) {
    const detail = err instanceof Error ? (err.message.split("\n")[0] ?? "unknown") : "unknown";
    throw new HttpError(502, "CHAIN_ERROR", `gas estimate for ${label} failed: ${detail}`);
  }
  let hash: Hex;
  try {
    hash = await chain.wallet.sendTransaction({
      account,
      to,
      data,
      gas,
      ...(chain.client.chain !== undefined ? { chain: chain.client.chain } : {}),
    } as never);
  } catch (err) {
    const detail = err instanceof Error ? (err.message.split("\n")[0] ?? "unknown") : "unknown";
    throw new HttpError(502, "CHAIN_ERROR", `send ${label} failed: ${detail}`);
  }
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new HttpError(502, "CHAIN_ERROR", `transaction ${label} reverted`);
  }
  return hash;
}

/**
 * SPEC §7 step 5 as amended by issue #17: two waited txs.
 *
 * 1. `R_ROOT.register(label, claimant, 0x0, RES, NAME_OWNER_ROLES, expiryRoot)`
 *    — claimant is the owner immediately; they hold SET_RESOLVER / SET_SUBREGISTRY
 *    and may later repoint to their own resolver / UserRegistry.
 * 2. `RES.multicall([setText(hf), setText(spec)])` on `namehash(label + "." + rootName)`.
 *
 * `expiryRoot` is the root name's expiry; if that is 0, issuance uses now+365 days
 * so the child is not registered with a zero expiry.
 *
 * Role checks run before tx 1 so a missing ROLE_SET_TEXT cannot leave a registered
 * name without records. Idempotent: already owned by `address` with matching texts → `[]`.
 */
export async function issuePublisherSubnameV2(
  chain: RegistrarChain,
  input: { label: string; hfNamespace: string; address: Address },
): Promise<Hex[]> {
  const root = await requireRootRegistry(chain);
  if (root.resolver === zeroAddress) {
    throw new HttpError(502, "CHAIN_ERROR", `no resolver for ${chain.rootName}`);
  }
  const node = namehashOf(publisherName(input.label, chain.rootName));
  const owner = await chain.client.readContract({
    address: root.subregistry,
    abi: registryV2Abi,
    functionName: "getOwner",
    args: [labelId(input.label)],
  });
  if (isAddressEqual(owner, input.address)) {
    const texts = await readPublisherTexts(chain, root.resolver, node);
    if (texts.hf === input.hfNamespace && texts.spec === SPEC_STRING) {
      return [];
    }
  }

  await assertOperatorCanIssue(chain, root);

  const expiryRoot = expiryForChild(root.expiry);
  const registerData = encodeFunctionData({
    abi: registryV2Abi,
    functionName: "register",
    args: [input.label, input.address, zeroAddress, root.resolver, NAME_OWNER_ROLES, expiryRoot],
  });
  const setHf = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "setText",
    args: [node, TEXT_KEYS.hf, input.hfNamespace],
  });
  const setSpec = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "setText",
    args: [node, TEXT_KEYS.spec, SPEC_STRING],
  });
  const multicallData = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "multicall",
    args: [[setHf, setSpec]],
  });

  const txs: Hex[] = [];
  txs.push(await sendAndWaitV2(chain, root.subregistry, registerData, "register"));
  txs.push(await sendAndWaitV2(chain, root.resolver, multicallData, "multicall"));
  return txs;
}
