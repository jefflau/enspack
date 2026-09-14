import {
  type Manifest,
  type ManifestStore,
  SPEC_STRING,
  TEXT_KEYS,
  decodeContenthashToCid,
  isEnspackError,
  namehashOf,
  validateManifest,
} from "@enspack/core";
import type { IndexerWriter, NodeRow } from "./repo.js";

export type ReadContenthash = (
  resolver: `0x${string}`,
  node: `0x${string}`,
) => Promise<`0x${string}`>;

export type IngestEventMeta = {
  store: ManifestStore;
  repo: IndexerWriter;
  chain: string;
  node: `0x${string}`;
  block: number;
  txHash: `0x${string}`;
};

function lowerNode(node: string): `0x${string}` {
  return node.toLowerCase() as `0x${string}`;
}

function errorReason(err: unknown): string {
  if (isEnspackError(err)) {
    return err.message;
  }
  if (err instanceof SyntaxError) {
    return "invalid manifest JSON";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "unknown ingest failure";
}

async function recordError(meta: IngestEventMeta, reason: string): Promise<void> {
  await meta.repo.insertError({
    node: lowerNode(meta.node),
    chain: meta.chain,
    reason,
    block: meta.block,
    txHash: meta.txHash.toLowerCase(),
  });
}

async function applyPendingHf(
  repo: IndexerWriter,
  publisherName: string,
  chain: string,
): Promise<void> {
  const publisherNode = lowerNode(namehashOf(publisherName));
  const mapping = await repo.findNode(publisherNode, chain);
  const pending = mapping?.hf ?? "";
  if (pending === "") {
    return;
  }
  const existing = await repo.findPublisher(publisherName, chain);
  await repo.upsertPublisher({
    name: publisherName,
    chain,
    hf: pending,
    spec: existing?.spec ?? "",
  });
}

async function learnNode(
  repo: IndexerWriter,
  chain: string,
  node: string,
  name: string,
): Promise<void> {
  const existing = await repo.findNode(node, chain);
  const next: NodeRow = {
    node: lowerNode(node),
    chain,
    name,
    hf: existing?.hf ?? "",
  };
  await repo.upsertNode(next);
}

async function learnManifestNodes(
  repo: IndexerWriter,
  chain: string,
  manifest: Manifest,
): Promise<void> {
  await learnNode(repo, chain, namehashOf(manifest.name), manifest.name);
  await learnNode(repo, chain, namehashOf(manifest.model), manifest.model);
  await learnNode(repo, chain, namehashOf(manifest.publisher), manifest.publisher);
  await applyPendingHf(repo, manifest.publisher, chain);
}

/**
 * SPEC §2.3 / §6.2: fetch and verify a contenthash, then upsert names/versions or flag a violation.
 */
export async function ingestContenthashChanged(
  meta: IngestEventMeta & { hash: `0x${string}` },
): Promise<void> {
  const node = lowerNode(meta.node);
  const event = { ...meta, node };

  let cid: string;
  try {
    cid = decodeContenthashToCid(event.hash);
  } catch (err) {
    await recordError(event, errorReason(err));
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = await event.store.getVerified(cid);
  } catch (err) {
    await recordError(event, errorReason(err));
    return;
  }

  let manifest: Manifest;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    manifest = validateManifest(parsed);
  } catch (err) {
    await recordError(event, errorReason(err));
    return;
  }

  const versionNode = lowerNode(namehashOf(manifest.name));
  const modelNode = lowerNode(namehashOf(manifest.model));
  if (node !== versionNode && node !== modelNode) {
    await recordError(event, "name/node mismatch");
    return;
  }

  if (node === versionNode) {
    const existing = await event.repo.findVersionByNode(node, event.chain);
    if (existing !== null) {
      if (existing.cid !== cid) {
        await event.repo.insertViolation({
          name: existing.name,
          node,
          chain: event.chain,
          previousCid: existing.cid,
          newCid: cid,
          block: event.block,
          txHash: event.txHash.toLowerCase(),
        });
      }
    } else {
      await event.repo.insertVersion({
        name: manifest.name,
        model: manifest.model,
        chain: event.chain,
        node,
        version: manifest.version,
        cid,
        createdAt: manifest.createdAt,
        block: event.block,
        txHash: event.txHash.toLowerCase(),
        manifestJson: new TextDecoder().decode(bytes),
      });
    }
    await learnManifestNodes(event.repo, event.chain, manifest);
  }

  if (node === modelNode) {
    await event.repo.upsertName({
      model: manifest.model,
      publisher: manifest.publisher,
      chain: event.chain,
      latestName: manifest.name,
      latestVersion: manifest.version,
      latestCid: cid,
      upstreamRepo: manifest.upstream?.repo ?? "",
      upstreamRevision: manifest.upstream?.revision ?? "",
      license: manifest.license,
      totalSize: manifest.totalSize,
      displayName: manifest.displayName ?? "",
      updatedBlock: event.block,
    });
    const existingPub = await event.repo.findPublisher(manifest.publisher, event.chain);
    await event.repo.upsertPublisher({
      name: manifest.publisher,
      chain: event.chain,
      hf: existingPub?.hf ?? "",
      spec: SPEC_STRING,
    });
    await learnManifestNodes(event.repo, event.chain, manifest);
  }
}

/**
 * SPEC §2.3: `com.enspack.spec` is the discovery beacon; `com.enspack.hf` records publisher identity.
 */
export async function ingestTextChanged(
  meta: IngestEventMeta & {
    key: string;
    value: string;
    resolver: `0x${string}`;
    readContenthash: ReadContenthash;
  },
): Promise<void> {
  const node = lowerNode(meta.node);
  const event = { ...meta, node };

  if (event.key === TEXT_KEYS.spec && event.value === SPEC_STRING) {
    let hash: `0x${string}`;
    try {
      hash = await event.readContenthash(event.resolver, node);
    } catch (err) {
      await recordError(event, errorReason(err));
      return;
    }
    await ingestContenthashChanged({ ...event, hash });
    return;
  }

  if (event.key === TEXT_KEYS.hf) {
    const existing = await event.repo.findNode(node, event.chain);
    const name = existing?.name ?? "";
    await event.repo.upsertNode({
      node,
      chain: event.chain,
      name,
      hf: event.value,
    });
    if (name !== "") {
      const pub = await event.repo.findPublisher(name, event.chain);
      if (pub !== null) {
        await event.repo.upsertPublisher({ ...pub, hf: event.value });
      }
    }
  }
}
