import {
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToHex,
  zeroAddress,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  permissionedResolverAbi,
  registryV2Abi,
  verifiableFactoryAbi,
} from "../../src/ens/v2/abis.js";
import type { EnsV2Config } from "../../src/ens/v2/config.js";
import { hasRootRolesV2, labelId, rootRegistry } from "../../src/ens/v2/discovery.js";
import {
  NAME_OWNER_ROLES,
  REGISTRY_ROLES,
  RESOLVER_ADMIN_ROLES,
  USER_REGISTRY_ROOT_ROLES,
} from "../../src/ens/v2/roles.js";
import { anvilBin, startAnvilFork } from "./helpers.js";

export {
  ANVIL_0_KEY,
  ANVIL_1_KEY,
  anvilAvailable,
  anvilBin,
  killPid,
  resolveAnvilBin,
} from "./helpers.js";

/** Sepolia fork sources: `SEPOLIA_RPC_URL` when set, otherwise public endpoints in rotation. */
export const SEPOLIA_FORK_URLS: readonly string[] =
  process.env.SEPOLIA_RPC_URL !== undefined && process.env.SEPOLIA_RPC_URL !== ""
    ? [process.env.SEPOLIA_RPC_URL]
    : [
        "https://ethereum-sepolia-rpc.publicnode.com",
        "https://1rpc.io/sepolia",
        "https://sepolia.drpc.org",
      ];

type ForkTransport = ReturnType<typeof import("viem").http>;

export type SepoliaForkPublicClient = PublicClient<Transport, Chain | undefined>;
export type SepoliaForkWalletClient = WalletClient<
  ForkTransport,
  typeof sepolia,
  PrivateKeyAccount
>;

/** Start an Anvil Sepolia fork pinned 64 blocks behind head, rotating sources. */
export async function startSepoliaAnvil(
  bin: string | null = anvilBin,
): Promise<{ proc: import("node:child_process").ChildProcess; url: string }> {
  if (bin === null) {
    throw new Error("anvil not found");
  }
  return startAnvilFork(bin, SEPOLIA_FORK_URLS);
}

function saltFor(tag: string): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }],
        [keccak256(stringToHex(tag)), BigInt(Date.now())],
      ),
    ),
  );
}

async function deployProxy(
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  publicClient: SepoliaForkPublicClient,
  cfg: EnsV2Config,
  implementation: Address,
  salt: bigint,
  data: `0x${string}`,
): Promise<Address> {
  const hash = await wallet.writeContract({
    chain: wallet.chain ?? sepolia,
    address: cfg.verifiableFactory,
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [implementation, salt, data],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("VerifiableFactory.deployProxy failed");
  }
  const logs = parseEventLogs({
    abi: verifiableFactoryAbi,
    eventName: "ProxyDeployed",
    logs: receipt.logs,
  });
  const proxy = logs[0]?.args.proxyAddress;
  if (proxy === undefined) {
    throw new Error("ProxyDeployed event not found");
  }
  return proxy;
}

/** Mint `label.eth` via impersonated ETHRegistrar and deploy publisher resolver + UserRegistry. */
export async function provisionV2Name(
  client: SepoliaForkPublicClient,
  wallet0: WalletClient<Transport, Chain | undefined, Account>,
  cfg: EnsV2Config,
  opts?: { label?: string; rpcUrl?: string },
): Promise<{
  ethRegistry: Address;
  rootUserRegistry: Address;
  resolver: Address;
  expiry: bigint;
}> {
  const account = wallet0.account;
  if (account === undefined) {
    throw new Error("provisionV2Name requires wallet0.account");
  }
  const owner = account.address;
  const label = opts?.label ?? "enspack-test";
  const chain = wallet0.chain ?? sepolia;

  const root = await rootRegistry(client, cfg);
  const ethRegistry = await client.readContract({
    address: root,
    abi: registryV2Abi,
    functionName: "getSubregistry",
    args: ["eth"],
  });
  if (ethRegistry === zeroAddress) {
    throw new Error("ROOT_REGISTRY.getSubregistry(eth) is zero");
  }

  const registrarOk = await hasRootRolesV2(
    client,
    ethRegistry,
    REGISTRY_ROLES.REGISTRAR,
    cfg.ethRegistrar,
  );
  if (!registrarOk) {
    throw new Error(
      `ETHRegistrar ${cfg.ethRegistrar} does not have ROLE_REGISTRAR on ETHRegistry ${ethRegistry}`,
    );
  }

  await client.request({
    method: "anvil_impersonateAccount",
    params: [cfg.ethRegistrar],
  } as never);
  await client.request({
    method: "anvil_setBalance",
    params: [cfg.ethRegistrar, `0x${parseEther("100").toString(16)}`],
  } as never);
  await client.request({
    method: "anvil_setBalance",
    params: [owner, `0x${parseEther("100").toString(16)}`],
  } as never);

  const rpcUrl = opts?.rpcUrl;
  if (rpcUrl === undefined) {
    throw new Error("provisionV2Name requires opts.rpcUrl for the impersonated registrar wallet");
  }
  const registrarWallet = createWalletClient({
    account: cfg.ethRegistrar,
    chain,
    transport: http(rpcUrl),
  });

  const now = (await client.getBlock()).timestamp;
  const expiry = now + 365n * 24n * 60n * 60n;

  const registerHash = await registrarWallet.writeContract({
    chain,
    address: ethRegistry,
    abi: registryV2Abi,
    functionName: "register",
    args: [label, owner, zeroAddress, zeroAddress, NAME_OWNER_ROLES, expiry],
  });
  const registerReceipt = await client.waitForTransactionReceipt({ hash: registerHash });
  if (registerReceipt.status !== "success") {
    throw new Error(`ETHRegistry.register(${label}) failed`);
  }

  const resolverInit = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "initialize",
    args: [owner, RESOLVER_ADMIN_ROLES, []],
  });
  const resolver = await deployProxy(
    wallet0,
    client,
    cfg,
    cfg.permissionedResolverImpl,
    saltFor(`enspack-resolver:${label}`),
    resolverInit,
  );

  const registryInit = encodeFunctionData({
    abi: registryV2Abi,
    functionName: "initialize",
    args: [owner, USER_REGISTRY_ROOT_ROLES],
  });
  const rootUserRegistry = await deployProxy(
    wallet0,
    client,
    cfg,
    cfg.userRegistryImpl,
    saltFor(`enspack-registry:${label}`),
    registryInit,
  );

  const id = labelId(label);
  await setResolver(wallet0, client, ethRegistry, id, resolver);
  await setSubregistry(wallet0, client, ethRegistry, id, rootUserRegistry);

  return { ethRegistry, rootUserRegistry, resolver, expiry };
}

async function setResolver(
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  publicClient: SepoliaForkPublicClient,
  registry: Address,
  anyId: bigint,
  resolver: Address,
): Promise<void> {
  const hash = await wallet.writeContract({
    chain: wallet.chain ?? sepolia,
    address: registry,
    abi: registryV2Abi,
    functionName: "setResolver",
    args: [anyId, resolver],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("setResolver failed");
  }
}

async function setSubregistry(
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  publicClient: SepoliaForkPublicClient,
  registry: Address,
  anyId: bigint,
  subregistry: Address,
): Promise<void> {
  const hash = await wallet.writeContract({
    chain: wallet.chain ?? sepolia,
    address: registry,
    abi: registryV2Abi,
    functionName: "setSubregistry",
    args: [anyId, subregistry],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("setSubregistry failed");
  }
}

/** Register a subname on an ENSv2 registry (issue #17). */
export async function registerSubname(
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  publicClient: SepoliaForkPublicClient,
  registry: Address,
  label: string,
  owner: Address,
  subregistry: Address,
  resolver: Address,
  roles: bigint,
  expiry: bigint,
): Promise<bigint> {
  const hash = await wallet.writeContract({
    chain: wallet.chain ?? sepolia,
    address: registry,
    abi: registryV2Abi,
    functionName: "register",
    args: [label, owner, subregistry, resolver, roles, expiry],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`register(${label}) failed`);
  }
  return labelId(label);
}

/** Set contenthash and text records via PermissionedResolver.multicall (SPEC §2 / issue #17). */
export async function setRecords(
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  publicClient: SepoliaForkPublicClient,
  resolver: Address,
  node: `0x${string}`,
  records: { contenthash?: `0x${string}`; texts?: Record<string, string> },
): Promise<void> {
  const calls: `0x${string}`[] = [];
  if (records.contenthash !== undefined) {
    calls.push(
      encodeFunctionData({
        abi: permissionedResolverAbi,
        functionName: "setContenthash",
        args: [node, records.contenthash],
      }),
    );
  }
  for (const [key, value] of Object.entries(records.texts ?? {})) {
    calls.push(
      encodeFunctionData({
        abi: permissionedResolverAbi,
        functionName: "setText",
        args: [node, key, value],
      }),
    );
  }
  if (calls.length === 0) {
    return;
  }
  const hash = await wallet.writeContract({
    chain: wallet.chain ?? sepolia,
    address: resolver,
    abi: permissionedResolverAbi,
    functionName: "multicall",
    args: [calls],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("resolver multicall failed");
  }
}

/** Deploy a UserRegistry proxy via VerifiableFactory (issue #17). */
export async function deployUserRegistry(
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  publicClient: SepoliaForkPublicClient,
  cfg: EnsV2Config,
  owner: Address,
  tag: string,
): Promise<Address> {
  const data = encodeFunctionData({
    abi: registryV2Abi,
    functionName: "initialize",
    args: [owner, USER_REGISTRY_ROOT_ROLES],
  });
  return deployProxy(wallet, publicClient, cfg, cfg.userRegistryImpl, saltFor(tag), data);
}
