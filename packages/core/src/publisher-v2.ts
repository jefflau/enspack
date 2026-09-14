import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  isAddressEqual,
} from "viem";
import { MAGNET_RE, TEXT_KEYS } from "./constants.js";
import { encodeIpfsContenthash } from "./ens/contenthash.js";
import { ensV2ConfigFor } from "./ens/v2/config.js";
import {
  type AddressRef,
  type AddressSlot,
  type EnsV2Config,
  type PlannedOp,
  REGISTRY_ROLES,
  RESOLVER_RECORD_ROLES,
  callNeedsDeploy,
  effectiveExpiry,
  encodePlannedOp,
  findExactRegistry,
  hasRolesV2,
  hasRootRolesV2,
  isNameAvailable,
  isZeroAddress,
  labelId,
  nameStateV2,
  readProxyDeployed,
  slotForDeploy,
} from "./ens/v2/publisher-support.js";
import { EnspackError, isEnspackError } from "./error.js";
import type { PublishCall, PublishInput, PublishResult } from "./interfaces.js";
import { namehashOf } from "./labels.js";
import type { CreatePublisherOptions } from "./publisher.js";
import {
  chainIdFor,
  cidEqual,
  cidFromContenthash,
  planRecordMulticallInner,
  publisherAccountAddress,
  readContenthash,
  readText,
  resolvePublisherAccount,
  validatePublishManifest,
} from "./publisher.js";

/** SPEC §8 / issue #17: v2 publish result includes setup calls as an extra field. */
export type PublishResultV2 = PublishResult & { setup: PublishCall[] };

export interface PublisherV2 {
  publish(input: PublishInput): Promise<PublishResultV2>;
}

function grantHint(role: string, on: string, account: Address): string {
  return `grant ${role} on ${on} to ${account}`;
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
      // Calldata is already encoded; skip nonce/fee RPCs so dry-run works on mocks.
      prepare: false,
    });
  } catch (cause) {
    throw new EnspackError("PUBLISH", `gas estimation failed: ${call.description}`, cause);
  }
}

async function fillDryRunGasV2(
  client: PublicClient<Transport, Chain | undefined>,
  account: Account | Address,
  calls: PublishCall[],
): Promise<void> {
  if (calls.length === 0) {
    return;
  }
  if (!calls.some(callNeedsDeploy)) {
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
  }
  for (const call of calls) {
    if (callNeedsDeploy(call)) {
      continue;
    }
    call.gas = await estimateCallGas(client, account, call);
  }
}

function opsToCalls(
  ops: PlannedOp[],
  cfg: EnsV2Config,
  account: Address,
  slots: Partial<Record<AddressSlot, Address>>,
): PublishCall[] {
  return ops.map((op) => encodePlannedOp(op, cfg, account, slots));
}

async function sendPlannedOps(
  client: PublicClient<Transport, Chain | undefined>,
  wallet: WalletClient<Transport, Chain | undefined, Account>,
  account: Account | Address,
  cfg: EnsV2Config,
  ops: PlannedOp[],
): Promise<{ txs: `0x${string}`[]; calls: PublishCall[] }> {
  const txs: `0x${string}`[] = [];
  const calls: PublishCall[] = [];
  const slots: Partial<Record<AddressSlot, Address>> = {};
  const chain = wallet.chain ?? client.chain ?? null;
  const address = publisherAccountAddress(account);
  for (const op of ops) {
    const call = encodePlannedOp(op, cfg, address, slots);
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
    const slotName = slotForDeploy(op);
    if (slotName !== undefined) {
      slots[slotName] = readProxyDeployed(receipt);
    }
    txs.push(hash);
    calls.push(call);
  }
  return { txs, calls };
}

function known(value: Address): AddressRef {
  return value;
}

function pending(name: AddressSlot): AddressRef {
  return { slot: name };
}

/**
 * SPEC §8 step 5 + spec-change issue #17: ENSv2 publisher
 * (`VerifiableFactory.deployProxy` + `register` + one resolver `multicall`).
 * Behind `ensVersion: "v2"`; v1 `createPublisher` is unchanged.
 */
export function createPublisherV2(opts: CreatePublisherOptions): PublisherV2 {
  const client = opts.client;

  return {
    async publish(input: PublishInput): Promise<PublishResultV2> {
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
      const cfg: EnsV2Config = { ...ensV2ConfigFor(input.chain, process.env), ...opts.ensV2 };

      const stateP = await nameStateV2(client, cfg, manifest.publisher);
      if (isNameAvailable(stateP) || !isAddressEqual(stateP.owner, address)) {
        throw new EnspackError("PUBLISH", `not the owner of ${manifest.publisher}`);
      }

      const ops: PlannedOp[] = [];
      const slots: Partial<Record<AddressSlot, Address>> = {};
      const publisherToken = labelId(stateP.label);

      let publisherRegistry = stateP.subregistry;
      if (isZeroAddress(publisherRegistry)) {
        const existing = await findExactRegistry(client, cfg, manifest.publisher);
        if (!isZeroAddress(existing)) {
          publisherRegistry = existing;
        }
      }
      if (!isZeroAddress(publisherRegistry)) {
        slots.publisherRegistry = publisherRegistry;
      }

      if (isZeroAddress(publisherRegistry)) {
        const hasSetSub = await hasRolesV2(
          client,
          stateP.parentRegistry,
          publisherToken,
          REGISTRY_ROLES.SET_SUBREGISTRY,
          address,
        );
        if (!hasSetSub) {
          throw new EnspackError(
            "PUBLISH",
            grantHint("ROLE_SET_SUBREGISTRY", manifest.publisher, address),
          );
        }
        ops.push({
          kind: "deployRegistry",
          slot: "publisherRegistry",
          name: manifest.publisher,
          setup: true,
          description: `setup: VerifiableFactory.deployProxy(UserRegistryImpl, salt=enspack:registry:${manifest.publisher})`,
        });
        ops.push({
          kind: "setSubregistry",
          registry: known(stateP.parentRegistry),
          label: stateP.label,
          subregistry: pending("publisherRegistry"),
          setup: true,
          description: `setup: setSubregistry(${stateP.label} → <pending proxy>)`,
        });
      }

      let resolverWritable = false;
      if (!isZeroAddress(stateP.resolver)) {
        slots.publisherResolver = stateP.resolver;
        resolverWritable = await hasRootRolesV2(
          client,
          stateP.resolver,
          RESOLVER_RECORD_ROLES,
          address,
        );
      }
      if (isZeroAddress(stateP.resolver) || !resolverWritable) {
        const hasSetResolver = await hasRolesV2(
          client,
          stateP.parentRegistry,
          publisherToken,
          REGISTRY_ROLES.SET_RESOLVER,
          address,
        );
        if (!hasSetResolver) {
          throw new EnspackError(
            "PUBLISH",
            grantHint("ROLE_SET_RESOLVER", manifest.publisher, address),
          );
        }
        ops.push({
          kind: "deployResolver",
          slot: "publisherResolver",
          name: manifest.publisher,
          setup: true,
          description: `setup: VerifiableFactory.deployProxy(PermissionedResolverImpl, salt=enspack:resolver:${manifest.publisher})`,
        });
        ops.push({
          kind: "setResolver",
          registry: known(stateP.parentRegistry),
          label: stateP.label,
          resolver: pending("publisherResolver"),
          setup: true,
          description: `setup: setResolver(${stateP.label} → <pending proxy>)`,
        });
      }

      const publisherRegistryRef: AddressRef = isZeroAddress(publisherRegistry)
        ? pending("publisherRegistry")
        : known(publisherRegistry);
      const resolverRef: AddressRef =
        isZeroAddress(stateP.resolver) || !resolverWritable
          ? pending("publisherResolver")
          : known(stateP.resolver);

      if (!isZeroAddress(publisherRegistry)) {
        const hasRegistrar = await hasRootRolesV2(
          client,
          publisherRegistry,
          REGISTRY_ROLES.REGISTRAR,
          address,
        );
        if (!hasRegistrar) {
          throw new EnspackError(
            "PUBLISH",
            grantHint("ROLE_REGISTRAR", publisherRegistry, address),
          );
        }
      }

      const stateM = await nameStateV2(client, cfg, manifest.model);
      if (!isNameAvailable(stateM) && !isAddressEqual(stateM.owner, address)) {
        throw new EnspackError("PUBLISH", `not the owner of ${manifest.model}`);
      }

      const expiryP = effectiveExpiry(stateP.expiry);
      const created = { model: false, version: false };

      let modelRegistryRef: AddressRef;
      if (isNameAvailable(stateM)) {
        created.model = true;
        ops.push({
          kind: "deployRegistry",
          slot: "modelRegistry",
          name: manifest.model,
          setup: false,
          description: `VerifiableFactory.deployProxy(UserRegistryImpl, salt=enspack:registry:${manifest.model})`,
        });
        const expiryNote = expiryP.usedFallback
          ? "; publisher expiry was 0, using now + 365 days"
          : "";
        ops.push({
          kind: "register",
          registry: publisherRegistryRef,
          label: modelLabel,
          owner: address,
          subregistry: pending("modelRegistry"),
          resolver: resolverRef,
          expiry: expiryP.expiry,
          setup: false,
          description: `Registry.register(${modelLabel} under ${manifest.publisher}${expiryNote})`,
        });
        modelRegistryRef = pending("modelRegistry");
      } else if (isZeroAddress(stateM.subregistry)) {
        const existingModelReg = await findExactRegistry(client, cfg, manifest.model);
        if (!isZeroAddress(existingModelReg)) {
          slots.modelRegistry = existingModelReg;
          modelRegistryRef = known(existingModelReg);
        } else {
          ops.push({
            kind: "deployRegistry",
            slot: "modelRegistry",
            name: manifest.model,
            setup: false,
            description: `VerifiableFactory.deployProxy(UserRegistryImpl, salt=enspack:registry:${manifest.model})`,
          });
          ops.push({
            kind: "setSubregistry",
            registry: publisherRegistryRef,
            label: modelLabel,
            subregistry: pending("modelRegistry"),
            setup: false,
            description: `setSubregistry(${modelLabel} → <pending proxy>)`,
          });
          modelRegistryRef = pending("modelRegistry");
        }
      } else {
        slots.modelRegistry = stateM.subregistry;
        modelRegistryRef = known(stateM.subregistry);
      }

      const stateV = await nameStateV2(client, cfg, manifest.name);
      if (!isNameAvailable(stateV) && !isAddressEqual(stateV.owner, address)) {
        throw new EnspackError("PUBLISH", `not the owner of ${manifest.name}`);
      }

      const expiryM = created.model
        ? expiryP
        : effectiveExpiry(stateM.expiry === 0n ? expiryP.expiry : stateM.expiry);
      if (isNameAvailable(stateV)) {
        created.version = true;
        const expiryNote = expiryM.usedFallback ? "; model expiry was 0, using now + 365 days" : "";
        ops.push({
          kind: "register",
          registry: modelRegistryRef,
          label: vLabel,
          owner: address,
          subregistry: "zero",
          resolver: resolverRef,
          expiry: expiryM.expiry,
          setup: false,
          description: `Registry.register(${vLabel} under ${manifest.model}${expiryNote})`,
        });
      }

      const versionNode = namehashOf(manifest.name);
      const modelNode = namehashOf(manifest.model);
      const encodedCid = encodeIpfsContenthash(input.manifestCid);

      let currentVersionHash: Hex = "0x";
      let currentModelHash: Hex = "0x";
      let currentVersionSpec = "";
      let currentVersionMagnet = "";
      let currentModelSpec = "";
      if (!isZeroAddress(stateP.resolver)) {
        currentVersionHash = await readContenthash(
          client,
          stateP.resolver,
          versionNode,
          manifest.name,
        );
        currentModelHash = await readContenthash(
          client,
          stateP.resolver,
          modelNode,
          manifest.model,
        );
        currentVersionSpec = await readText(
          client,
          stateP.resolver,
          versionNode,
          TEXT_KEYS.spec,
          manifest.name,
        );
        currentVersionMagnet = await readText(
          client,
          stateP.resolver,
          versionNode,
          TEXT_KEYS.magnet,
          manifest.name,
        );
        currentModelSpec = await readText(
          client,
          stateP.resolver,
          modelNode,
          TEXT_KEYS.spec,
          manifest.model,
        );
      }

      const currentVersionCid = cidFromContenthash(currentVersionHash, "version");
      void cidFromContenthash(currentModelHash, "model");
      if (currentVersionCid !== null && !cidEqual(currentVersionCid, input.manifestCid)) {
        throw new EnspackError(
          "PUBLISH",
          `version name already points at ${currentVersionCid}; version names are immutable`,
        );
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
        ops.push({
          kind: "multicall",
          resolver: resolverRef,
          inner,
          setup: false,
          description: `PermissionedResolver.multicall(${innerDesc.join(", ")})`,
        });
      }

      const dryRun = input.dryRun === true;
      const setupOps = ops.filter((op) => op.setup);
      if (dryRun) {
        const calls = opsToCalls(ops, cfg, address, slots);
        await fillDryRunGasV2(client, account, calls);
        return {
          name: manifest.name,
          model: manifest.model,
          cid: input.manifestCid,
          txs: [],
          calls,
          created,
          setup: opsToCalls(setupOps, cfg, address, slots),
        };
      }

      if (opts.wallet === undefined) {
        throw new EnspackError("PUBLISH", "publish requires a wallet");
      }
      if (ops.length === 0) {
        return {
          name: manifest.name,
          model: manifest.model,
          cid: input.manifestCid,
          txs: [],
          calls: [],
          created,
          setup: [],
        };
      }
      const sent = await sendPlannedOps(client, opts.wallet, account, cfg, ops);
      return {
        name: manifest.name,
        model: manifest.model,
        cid: input.manifestCid,
        txs: sent.txs,
        calls: sent.calls,
        created,
        setup: sent.calls.filter((_, i) => ops[i]?.setup === true),
      };
    },
  };
}
