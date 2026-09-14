import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  decodeFunctionData,
  encodeFunctionData,
  isAddressEqual,
  zeroAddress,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import { parseCid } from "./cid.js";
import { ENS_REGISTRY, MAGNET_RE, SPEC_STRING, TEXT_KEYS } from "./constants.js";
import {
  contenthashResolverAbi,
  ensRegistryAbi,
  publicResolverWriteAbi,
  textResolverAbi,
} from "./ens/abis.js";
import { readResolverAddress } from "./ens/client.js";
import {
  decodeContenthashToCid,
  encodeIpfsContenthash,
  isEmptyContenthash,
} from "./ens/contenthash.js";
import type { EnsV2Config, EnsVersion } from "./ens/v2/config.js";
import { ensVersionFor } from "./ens/v2/config.js";
import { EnspackError, isEnspackError } from "./error.js";
import type { PublishCall, PublishInput, PublishResult, Publisher } from "./interfaces.js";
import { labelhashOf, namehashOf, versionLabel } from "./labels.js";
import type { Manifest } from "./types.js";
import { validateManifest } from "./validate.js";

/** WP-04 / WP-15: options for `createPublisher`. Keys and RPC URLs come from the caller, never from env. */
export interface CreatePublisherOptions {
  client: PublicClient<Transport, Chain | undefined>;
  wallet?: WalletClient<Transport, Chain | undefined, Account>;
  account?: Account;
  registry?: `0x${string}`;
  /** Default: `ensVersionFor(chain, env)` (`v2` on Sepolia, `v1` on mainnet). */
  ensVersion?: EnsVersion;
  /** Partial override of WP-14 `EnsV2Config` when `ensVersion` is `v2`. */
  ensV2?: Partial<EnsV2Config>;
}

function wrapPublish(err: unknown, message: string): never {
  if (isEnspackError(err)) {
    throw err;
  }
  throw new EnspackError("PUBLISH", message, err);
}

export function publisherAccountAddress(account: Account | Address): Address {
  return typeof account === "string" ? account : account.address;
}

export function resolvePublisherAccount(opts: CreatePublisherOptions): Account | Address {
  if (opts.wallet?.account !== undefined) {
    return opts.wallet.account;
  }
  if (opts.account !== undefined) {
    return opts.account;
  }
  throw new EnspackError("PUBLISH", "createPublisher requires wallet.account or account");
}

function oneLabelUnder(name: string, parent: string): string {
  const suffix = `.${parent}`;
  if (!name.endsWith(suffix)) {
    throw new EnspackError("PUBLISH", `${name} must be exactly one label under ${parent}`);
  }
  const label = name.slice(0, -suffix.length);
  if (label === "" || label.includes(".")) {
    throw new EnspackError("PUBLISH", `${name} must be exactly one label under ${parent}`);
  }
  return label;
}

export function cidEqual(a: string, b: string): boolean {
  return parseCid(a).toV1().equals(parseCid(b).toV1());
}

export function cidFromContenthash(hex: Hex, what: string): string | null {
  if (isEmptyContenthash(hex)) {
    return null;
  }
  try {
    return decodeContenthashToCid(hex);
  } catch (cause) {
    throw new EnspackError("PUBLISH", `existing ${what} contenthash is not ipfs`, cause);
  }
}

export function chainIdFor(chain: PublishInput["chain"]): number {
  return chain === "sepolia" ? sepolia.id : mainnet.id;
}

function tryDecode(abi: typeof ensRegistryAbi | typeof publicResolverWriteAbi, data: Hex) {
  try {
    return decodeFunctionData({ abi, data });
  } catch {
    return undefined;
  }
}

function summarizeInner(data: Hex): string {
  const decoded = tryDecode(publicResolverWriteAbi, data);
  if (decoded?.functionName === "setContenthash") {
    const [node, hash] = decoded.args;
    return `setContenthash(${node}, ${hash})`;
  }
  if (decoded?.functionName === "setText") {
    const [node, key, value] = decoded.args;
    return `setText(${node}, ${key}, ${value})`;
  }
  return data.slice(0, 10);
}

function summarizeCall(call: PublishCall): string {
  if (call.description.startsWith("setup:")) {
    return call.description;
  }
  const registryDecoded = tryDecode(ensRegistryAbi, call.data);
  if (registryDecoded?.functionName === "setSubnodeRecord") {
    const [node, label, owner, resolver, ttl] = registryDecoded.args;
    return `setSubnodeRecord(node=${node}, label=${label}, owner=${owner}, resolver=${resolver}, ttl=${ttl})`;
  }
  const resolverDecoded = tryDecode(publicResolverWriteAbi, call.data);
  if (resolverDecoded?.functionName === "multicall") {
    const inner = resolverDecoded.args[0];
    return `multicall([${inner.map(summarizeInner).join(", ")}])`;
  }
  return call.description;
}

/**
 * SPEC §8 step 5: format a dry-run call list for CLI stderr (to, function, args, gas).
 * WP-15: `setup:` lines print as-is; missing gas prints `(gas after deploy)`.
 */
export function formatPublishPlan(calls: PublishCall[]): string {
  return calls
    .map((call, i) => {
      const gas =
        call.gas !== undefined ? ` gas=${call.gas.toString()}` : " (gas after deploy)";
      return `${i + 1}. to=${call.to} ${summarizeCall(call)}${gas}`;
    })
    .join("\n");
}

async function readOwner(
  client: PublicClient<Transport, Chain | undefined>,
  registry: Address,
  node: Hex,
  what: string,
): Promise<Address> {
  try {
    return await client.readContract({
      address: registry,
      abi: ensRegistryAbi,
      functionName: "owner",
      args: [node],
    });
  } catch (err) {
    wrapPublish(err, `failed to read owner of ${what}`);
  }
}

export async function readContenthash(
  client: PublicClient<Transport, Chain | undefined>,
  resolver: Address,
  node: Hex,
  what: string,
): Promise<Hex> {
  try {
    return await client.readContract({
      address: resolver,
      abi: contenthashResolverAbi,
      functionName: "contenthash",
      args: [node],
    });
  } catch (err) {
    wrapPublish(err, `failed to read contenthash of ${what}`);
  }
}

export async function readText(
  client: PublicClient<Transport, Chain | undefined>,
  resolver: Address,
  node: Hex,
  key: string,
  what: string,
): Promise<string> {
  try {
    return await client.readContract({
      address: resolver,
      abi: textResolverAbi,
      functionName: "text",
      args: [node, key],
    });
  } catch (err) {
    wrapPublish(err, `failed to read text ${key} of ${what}`);
  }
}

function encodeSetSubnode(parentNode: Hex, label: Hex, owner: Address, resolver: Address): Hex {
  return encodeFunctionData({
    abi: ensRegistryAbi,
    functionName: "setSubnodeRecord",
    args: [parentNode, label, owner, resolver, 0n],
  });
}

async function estimateCallGas(
  client: PublicClient<Transport, Chain | undefined>,
  account: Account | Address,
  call: PublishCall,
): Promise<bigint> {
  try {
    return await client.estimateGas({
      account,
      to: call.to,
      data: call.data,
    });
  } catch (cause) {
    throw new EnspackError("PUBLISH", `gas estimation failed: ${call.description}`, cause);
  }
}

async function fillDryRunGas(
  client: PublicClient<Transport, Chain | undefined>,
  account: Account | Address,
  calls: PublishCall[],
): Promise<void> {
  if (calls.length === 0) {
    return;
  }
  try {
    const { results } = await client.simulateCalls({
      account,
      calls: calls.map((c) => ({ to: c.to, data: c.data })),
    });
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const result = results[i];
      if (call === undefined || result === undefined) {
        throw new EnspackError("PUBLISH", "simulateCalls returned fewer results than calls");
      }
      if (result.status !== "success") {
        throw new EnspackError("PUBLISH", `call would revert: ${call.description}`);
      }
      call.gas = result.gasUsed;
    }
    return;
  } catch (err) {
    if (isEnspackError(err)) {
      throw err;
    }
  }
  for (const call of calls) {
    call.gas = await estimateCallGas(client, account, call);
  }
}

async function sendCalls(
  client: PublicClient<Transport, Chain | undefined>,
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  account: Account | Address,
  calls: PublishCall[],
): Promise<`0x${string}`[]> {
  const txs: `0x${string}`[] = [];
  const chain = wallet.chain ?? client.chain ?? null;
  for (const call of calls) {
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
    txs.push(hash);
  }
  return txs;
}

export function validatePublishManifest(
  manifestInput: Manifest,
  manifestCid: string,
): { manifest: Manifest; modelLabel: string; vLabel: string } {
  const manifest = validateManifest(manifestInput);
  const { modelLabel, vLabel } = validatePublishNames(manifest);
  assertRawSha256(manifestCid);
  return { manifest, modelLabel, vLabel };
}

export function planRecordMulticallInner(args: {
  versionNode: Hex;
  modelNode: Hex;
  encodedCid: Hex;
  manifestCid: string;
  magnet: string;
  currentVersionHash: Hex;
  currentModelHash: Hex;
  currentVersionSpec: string;
  currentVersionMagnet: string;
  currentModelSpec: string;
}): { inner: Hex[]; innerDesc: string[] } {
  const currentVersionCid = cidFromContenthash(args.currentVersionHash, "version");
  const currentModelCid = cidFromContenthash(args.currentModelHash, "model");
  const inner: Hex[] = [];
  const innerDesc: string[] = [];
  if (currentVersionCid === null || !cidEqual(currentVersionCid, args.manifestCid)) {
    inner.push(
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setContenthash",
        args: [args.versionNode, args.encodedCid],
      }),
    );
    innerDesc.push("setContenthash(version)");
  }
  if (args.currentVersionSpec !== SPEC_STRING) {
    inner.push(
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setText",
        args: [args.versionNode, TEXT_KEYS.spec, SPEC_STRING],
      }),
    );
    innerDesc.push(`setText(version, ${TEXT_KEYS.spec})`);
  }
  if (args.currentVersionMagnet !== args.magnet) {
    inner.push(
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setText",
        args: [args.versionNode, TEXT_KEYS.magnet, args.magnet],
      }),
    );
    innerDesc.push(`setText(version, ${TEXT_KEYS.magnet})`);
  }
  if (currentModelCid === null || !cidEqual(currentModelCid, args.manifestCid)) {
    inner.push(
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setContenthash",
        args: [args.modelNode, args.encodedCid],
      }),
    );
    innerDesc.push("setContenthash(model)");
  }
  if (args.currentModelSpec !== SPEC_STRING) {
    inner.push(
      encodeFunctionData({
        abi: publicResolverWriteAbi,
        functionName: "setText",
        args: [args.modelNode, TEXT_KEYS.spec, SPEC_STRING],
      }),
    );
    innerDesc.push(`setText(model, ${TEXT_KEYS.spec})`);
  }
  return { inner, innerDesc };
}

function validatePublishNames(manifest: Manifest): { modelLabel: string; vLabel: string } {
  const modelLabel = oneLabelUnder(manifest.model, manifest.publisher);
  const vLabel = oneLabelUnder(manifest.name, manifest.model);
  const expected = versionLabel(manifest.version);
  if (vLabel !== expected) {
    throw new EnspackError("PUBLISH", `version label must be ${expected}`);
  }
  return { modelLabel, vLabel };
}

function assertRawSha256(cid: string): void {
  const parsed = parseCid(cid);
  if (parsed.code !== raw.code || parsed.multihash.code !== sha256.code) {
    throw new EnspackError(
      "PUBLISH",
      `manifestCid must be raw sha2-256, got codec ${parsed.code} hash ${parsed.multihash.code}`,
    );
  }
}

/**
 * SPEC §8 step 5: on-chain publisher (`setSubnodeRecord` + one PublicResolver `multicall`).
 */
export function createPublisher(opts: CreatePublisherOptions): Publisher {
  const client = opts.client;
  const registry = opts.registry ?? ENS_REGISTRY;

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      const version = opts.ensVersion ?? ensVersionFor(input.chain, process.env);
      if (version === "v2") {
        const { createPublisherV2 } = await import("./publisher-v2.js");
        return createPublisherV2(opts).publish(input);
      }

      const { manifest, modelLabel, vLabel } = validatePublishManifest(
        input.manifest,
        input.manifestCid,
      );
      if (!MAGNET_RE.test(manifest.distribution.magnet)) {
        throw new EnspackError("PUBLISH", "distribution.magnet does not match SPEC");
      }
      if (client.chain !== undefined && client.chain.id !== chainIdFor(input.chain)) {
        throw new EnspackError(
          "PUBLISH",
          `client chain ${client.chain.id} does not match ${input.chain}`,
        );
      }

      const account = resolvePublisherAccount(opts);
      const address = publisherAccountAddress(account);
      const publisherNode = namehashOf(manifest.publisher);
      const modelNode = namehashOf(manifest.model);
      const versionNode = namehashOf(manifest.name);

      const publisherOwner = await readOwner(client, registry, publisherNode, manifest.publisher);
      if (!isAddressEqual(publisherOwner, address)) {
        throw new EnspackError("PUBLISH", `not the owner of ${manifest.publisher}`);
      }

      let resolver: Address;
      try {
        resolver = await readResolverAddress(client, manifest.publisher, registry);
      } catch (err) {
        wrapPublish(err, `failed to read resolver of ${manifest.publisher}`);
      }
      if (isAddressEqual(resolver, zeroAddress)) {
        throw new EnspackError("PUBLISH", `no resolver on ${manifest.publisher}`);
      }

      const modelOwner = await readOwner(client, registry, modelNode, manifest.model);
      const versionOwner = await readOwner(client, registry, versionNode, manifest.name);
      if (!isAddressEqual(modelOwner, zeroAddress) && !isAddressEqual(modelOwner, address)) {
        throw new EnspackError("PUBLISH", `not the owner of ${manifest.model}`);
      }
      if (!isAddressEqual(versionOwner, zeroAddress) && !isAddressEqual(versionOwner, address)) {
        throw new EnspackError("PUBLISH", `not the owner of ${manifest.name}`);
      }

      const encodedCid = encodeIpfsContenthash(input.manifestCid);
      const currentVersionHash = await readContenthash(
        client,
        resolver,
        versionNode,
        manifest.name,
      );
      const currentModelHash = await readContenthash(client, resolver, modelNode, manifest.model);
      const currentVersionCid = cidFromContenthash(currentVersionHash, "version");
      if (currentVersionCid !== null && !cidEqual(currentVersionCid, input.manifestCid)) {
        throw new EnspackError(
          "PUBLISH",
          `version name already points at ${currentVersionCid}; version names are immutable`,
        );
      }

      const currentVersionSpec = await readText(
        client,
        resolver,
        versionNode,
        TEXT_KEYS.spec,
        manifest.name,
      );
      const currentVersionMagnet = await readText(
        client,
        resolver,
        versionNode,
        TEXT_KEYS.magnet,
        manifest.name,
      );
      const currentModelSpec = await readText(
        client,
        resolver,
        modelNode,
        TEXT_KEYS.spec,
        manifest.model,
      );

      const created = {
        model: isAddressEqual(modelOwner, zeroAddress),
        version: isAddressEqual(versionOwner, zeroAddress),
      };

      const calls: PublishCall[] = [];
      if (created.model) {
        calls.push({
          to: registry,
          data: encodeSetSubnode(publisherNode, labelhashOf(modelLabel), address, resolver),
          description: `Registry.setSubnodeRecord(${modelLabel} under ${manifest.publisher})`,
        });
      }
      if (created.version) {
        calls.push({
          to: registry,
          data: encodeSetSubnode(modelNode, labelhashOf(vLabel), address, resolver),
          description: `Registry.setSubnodeRecord(${vLabel} under ${manifest.model})`,
        });
      }

      const { inner, innerDesc } = planRecordMulticallInner({
        versionNode,
        modelNode,
        encodedCid,
        manifestCid: input.manifestCid,
        magnet: manifest.distribution.magnet,
        currentVersionHash,
        currentModelHash,
        currentVersionSpec,
        currentVersionMagnet,
        currentModelSpec,
      });
      if (inner.length > 0) {
        calls.push({
          to: resolver,
          data: encodeFunctionData({
            abi: publicResolverWriteAbi,
            functionName: "multicall",
            args: [inner],
          }),
          description: `PublicResolver.multicall(${innerDesc.join(", ")})`,
        });
      }

      const dryRun = input.dryRun === true;
      if (dryRun) {
        await fillDryRunGas(client, account, calls);
        return {
          name: manifest.name,
          model: manifest.model,
          cid: input.manifestCid,
          txs: [],
          calls,
          created,
        };
      }

      if (opts.wallet === undefined) {
        throw new EnspackError("PUBLISH", "publish requires a wallet");
      }
      const txs = await sendCalls(client, opts.wallet, account, calls);
      return {
        name: manifest.name,
        model: manifest.model,
        cid: input.manifestCid,
        txs,
        calls,
        created,
      };
    },
  };
}
