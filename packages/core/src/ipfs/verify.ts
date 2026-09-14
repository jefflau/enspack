import * as dagPb from "@ipld/dag-pb";
import { UnixFS } from "ipfs-unixfs";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";

export type BlockCheck =
  | { ok: true; data: Uint8Array }
  | { ok: false; reason: string; fatal: boolean };

function dagPbLinks(node: dagPb.PBNode): readonly dagPb.PBLink[] {
  return node.Links ?? [];
}

/**
 * SPEC §2.1 / §4 step 3: accept a block only when it hashes to `cid` and is a raw or dag-pb UnixFS file leaf.
 */
export async function extractFileBytes(cid: CID, bytes: Uint8Array): Promise<BlockCheck> {
  if (cid.multihash.code !== sha256.code) {
    return {
      ok: false,
      reason: `unsupported multihash code ${cid.multihash.code}`,
      fatal: true,
    };
  }

  const digest = await sha256.digest(bytes);
  const computed = CID.create(cid.version, cid.code, digest);
  if (!cid.equals(computed)) {
    return { ok: false, reason: "bytes do not hash to CID", fatal: false };
  }

  if (cid.code === raw.code) {
    return { ok: true, data: bytes };
  }

  if (cid.code !== dagPb.code) {
    return { ok: false, reason: `unsupported codec 0x${cid.code.toString(16)}`, fatal: true };
  }

  let node: dagPb.PBNode;
  try {
    node = dagPb.decode(bytes);
  } catch {
    return { ok: false, reason: "dag-pb decode failed", fatal: true };
  }

  if (dagPbLinks(node).length > 0) {
    return { ok: false, reason: "dag-pb node has links", fatal: true };
  }

  const data = node.Data;
  if (data === undefined) {
    return { ok: false, reason: "dag-pb node has no UnixFS data", fatal: true };
  }

  let unixfs: UnixFS;
  try {
    unixfs = UnixFS.unmarshal(data);
  } catch {
    return { ok: false, reason: "UnixFS decode failed", fatal: true };
  }

  if (unixfs.type !== "file" && unixfs.type !== "raw") {
    return { ok: false, reason: `UnixFS type ${unixfs.type} is not a file leaf`, fatal: true };
  }

  if (unixfs.blockSizes.length > 0) {
    return { ok: false, reason: "UnixFS file is not a single-node leaf", fatal: true };
  }

  return { ok: true, data: unixfs.data ?? new Uint8Array() };
}
