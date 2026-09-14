import {
  ENS_REGISTRY,
  type EnsV2Config,
  type EnsVersion,
  type EnspackChainName,
  ROOT_NAME,
  SPEC_STRING,
  TEXT_KEYS,
  ensVersionFor,
  labelhashOf,
  namehashOf,
  readResolverAddress,
} from "@enspack/core";
import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  encodeFunctionData,
  zeroAddress,
} from "viem";
import {
  isLabelTakenOnChainV2,
  issuePublisherSubnameV2,
  readOperatorApprovalV2,
} from "./chain-v2.js";
import { publicResolverWriteAbi, registrarRegistryAbi } from "./ens-abi.js";
import { HttpError } from "./http-error.js";

export type RegistrarChain = {
  client: PublicClient<Transport, Chain | undefined>;
  wallet: WalletClient<Transport, Chain | undefined, Account>;
  operator: Address;
  registry: Address;
  rootName: string;
  /** Defaults to `v1` so existing callers (v1 Anvil fork tests) stay unchanged. */
  ensVersion?: EnsVersion;
  ensV2?: EnsV2Config;
};

export type OperatorApproval = {
  rootOwner: Address;
  approved: boolean;
  registrarApproved?: boolean;
  resolverApproved?: boolean;
  rootRegistry?: Address;
  resolver?: Address;
};

export function ensVersionOf(chain: RegistrarChain): EnsVersion {
  return chain.ensVersion ?? "v1";
}

/**
 * `REGISTRAR_ENS_VERSION=v1|v2` overrides core `ensVersionFor` (default v2 on Sepolia, v1 on mainnet).
 */
export function registrarEnsVersion(
  chain: EnspackChainName,
  env: NodeJS.ProcessEnv = process.env,
): EnsVersion {
  const raw = env.REGISTRAR_ENS_VERSION;
  if (raw === "v1" || raw === "v2") {
    return raw;
  }
  if (raw !== undefined && raw !== "") {
    throw new Error("REGISTRAR_ENS_VERSION must be v1 or v2");
  }
  return ensVersionFor(chain, env);
}

export function createRegistrarChain(input: {
  client: RegistrarChain["client"];
  wallet: RegistrarChain["wallet"];
  operator: Address;
  ensVersion: EnsVersion;
  registry?: Address;
  rootName?: string;
  ensV2?: EnsV2Config;
}): RegistrarChain {
  if (input.ensVersion === "v2" && input.ensV2 === undefined) {
    throw new Error("ensV2 config is required when ensVersion is v2");
  }
  return {
    client: input.client,
    wallet: input.wallet,
    operator: input.operator,
    registry: input.registry ?? ENS_REGISTRY,
    rootName: input.rootName ?? ROOT_NAME,
    ensVersion: input.ensVersion,
    ...(input.ensV2 !== undefined ? { ensV2: input.ensV2 } : {}),
  };
}

function publisherName(label: string, rootName: string): string {
  return `${label}.${rootName}`;
}

/** SPEC §7: `owner(namehash(label + "." + root)) != 0` means the subname is taken. */
export async function ownerOfLabel(chain: RegistrarChain, label: string): Promise<Address> {
  const node = namehashOf(publisherName(label, chain.rootName));
  return chain.client.readContract({
    address: chain.registry,
    abi: registrarRegistryAbi,
    functionName: "owner",
    args: [node],
  });
}

export async function isLabelTakenOnChain(chain: RegistrarChain, label: string): Promise<boolean> {
  if (ensVersionOf(chain) === "v2") {
    return isLabelTakenOnChainV2(chain, label);
  }
  const owner = await ownerOfLabel(chain, label);
  return owner !== zeroAddress;
}

/**
 * SPEC §7 step 5: operator is an approved operator of the root owner, never assumed to be the owner.
 */
export async function readOperatorApproval(chain: RegistrarChain): Promise<OperatorApproval> {
  if (ensVersionOf(chain) === "v2") {
    return readOperatorApprovalV2(chain);
  }
  const rootOwner = await chain.client.readContract({
    address: chain.registry,
    abi: registrarRegistryAbi,
    functionName: "owner",
    args: [namehashOf(chain.rootName)],
  });
  const approved = await chain.client.readContract({
    address: chain.registry,
    abi: registrarRegistryAbi,
    functionName: "isApprovedForAll",
    args: [rootOwner, chain.operator],
  });
  return { rootOwner, approved };
}

async function sendAndWait(
  chain: RegistrarChain,
  args: {
    address: Address;
    abi: typeof registrarRegistryAbi | typeof publicResolverWriteAbi;
    functionName: "setSubnodeRecord" | "setOwner" | "multicall";
    args: readonly unknown[];
  },
): Promise<Hex> {
  const account = chain.wallet.account ?? chain.operator;
  const estimate = {
    account,
    address: args.address,
    abi: args.abi,
    functionName: args.functionName,
    args: args.args,
  };
  const gas = await chain.client.estimateContractGas(estimate as never);
  const write = {
    account,
    address: args.address,
    abi: args.abi,
    functionName: args.functionName,
    args: args.args,
    gas,
    ...(chain.client.chain !== undefined ? { chain: chain.client.chain } : {}),
  };
  const hash = await chain.wallet.writeContract(write as never);
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new HttpError(502, "CHAIN_ERROR", `transaction ${args.functionName} reverted`);
  }
  return hash;
}

/**
 * SPEC §7 step 5: `setSubnodeRecord` (owner = operator) → PublicResolver `multicall` of
 * `com.enspack.hf` + `com.enspack.spec` → `setOwner` to the claimant. Three waited txs.
 */
export async function issuePublisherSubname(
  chain: RegistrarChain,
  input: { label: string; hfNamespace: string; address: Address },
): Promise<Hex[]> {
  if (ensVersionOf(chain) === "v2") {
    return issuePublisherSubnameV2(chain, input);
  }
  const resolver = await readResolverAddress(chain.client, chain.rootName, chain.registry);
  if (resolver === zeroAddress) {
    throw new HttpError(502, "CHAIN_ERROR", `no resolver for ${chain.rootName}`);
  }
  const parentNode = namehashOf(chain.rootName);
  const node = namehashOf(publisherName(input.label, chain.rootName));
  const txs: Hex[] = [];

  txs.push(
    await sendAndWait(chain, {
      address: chain.registry,
      abi: registrarRegistryAbi,
      functionName: "setSubnodeRecord",
      args: [parentNode, labelhashOf(input.label), chain.operator, resolver, 0n],
    }),
  );

  const setHf = encodeFunctionData({
    abi: publicResolverWriteAbi,
    functionName: "setText",
    args: [node, TEXT_KEYS.hf, input.hfNamespace],
  });
  const setSpec = encodeFunctionData({
    abi: publicResolverWriteAbi,
    functionName: "setText",
    args: [node, TEXT_KEYS.spec, SPEC_STRING],
  });
  txs.push(
    await sendAndWait(chain, {
      address: resolver,
      abi: publicResolverWriteAbi,
      functionName: "multicall",
      args: [[setHf, setSpec]],
    }),
  );

  txs.push(
    await sendAndWait(chain, {
      address: chain.registry,
      abi: registrarRegistryAbi,
      functionName: "setOwner",
      args: [node, input.address],
    }),
  );

  return txs;
}

export { publisherName };
