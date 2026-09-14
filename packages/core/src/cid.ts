import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { EnspackError } from "./error.js";

/**
 * SPEC §3 / §4: CIDv1, raw codec (0x55), sha2-256, base32 (`bafkrei…`).
 */
export async function manifestCid(bytes: Uint8Array): Promise<string> {
  const hash = await sha256.digest(bytes);
  return CID.createV1(raw.code, hash).toString();
}

/**
 * SPEC §4 step 3: true iff `cid` is the raw sha2-256 CIDv1 of `bytes`.
 */
export async function cidMatches(cid: string, bytes: Uint8Array): Promise<boolean> {
  const parsed = parseCid(cid);
  if (parsed.code !== raw.code) {
    return false;
  }
  const hash = await sha256.digest(bytes);
  return parsed.equals(CID.createV1(raw.code, hash));
}

/**
 * SPEC §4 step 3: parse a CID; malformed input is a verification failure.
 */
export function parseCid(cid: string): CID {
  try {
    return CID.parse(cid);
  } catch (cause) {
    throw new EnspackError("VERIFY", `malformed CID: ${cid}`, cause);
  }
}
