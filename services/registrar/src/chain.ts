import {
  SPEC_STRING,
  TEXT_KEYS,
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
import { publicResolverWriteAbi, registrarRegistryAbi } from "./ens-abi.js";
import { HttpError } from "./http-error.js";

export type RegistrarChain = {
  client: PublicClient<Transport, Chain | undefined>;
  wallet: WalletClient<Transport, Chain | undefined, Account>;
  operator: Address;
  registry: Address;
  rootName: string;
};

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
  const owner = await ownerOfLabel(chain, label);
  return owner !== zeroAddress;
}

/**
 * SPEC §7 step 5: operator is an approved operator of the root owner, never assumed to be the owner.
 */
export async function readOperatorApproval(chain: RegistrarChain): Promise<{
  rootOwner: Address;
  approved: boolean;
}> {
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
