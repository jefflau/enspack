import { decode, encode, getCodec } from "@ensdomains/content-hash";
import { CID } from "multiformats/cid";
import { parseCid } from "../cid.js";
import { EnspackError } from "../error.js";

const IPFS_CODECS = new Set(["ipfs", "ipfs-ns"]);

function isEmptyHex(hex: string): boolean {
  const h = hex.trim().toLowerCase();
  return h === "" || h === "0x";
}

/** SPEC §2.1 / §4 step 2: decode an ENS contenthash to a CIDv1 base32 string; non-ipfs is an error. */
export function decodeContenthashToCid(hex: string): string {
  if (isEmptyHex(hex)) {
    throw new EnspackError("RESOLVE", "contenthash is not ipfs");
  }
  let codec: string | undefined;
  try {
    codec = getCodec(hex);
  } catch (cause) {
    throw new EnspackError("RESOLVE", "contenthash is not ipfs", cause);
  }
  if (codec === undefined || !IPFS_CODECS.has(codec)) {
    throw new EnspackError("RESOLVE", "contenthash is not ipfs");
  }
  try {
    return CID.parse(decode(hex)).toV1().toString();
  } catch (cause) {
    throw new EnspackError("RESOLVE", "contenthash is not ipfs", cause);
  }
}

/** SPEC §2.1 / §8 step 5: encode a CID as an ipfs ENS contenthash (`0x` hex) for `setContenthash`. */
export function encodeIpfsContenthash(cid: string): `0x${string}` {
  parseCid(cid);
  try {
    const encoded = encode("ipfs", cid).replace(/^0x/i, "").toLowerCase();
    return `0x${encoded}`;
  } catch (cause) {
    throw new EnspackError("RESOLVE", `cannot encode ipfs contenthash for ${cid}`, cause);
  }
}

/** Empty `0x` contenthash means the name has no CID (SPEC §4 step 6 magnet fallback). */
export function isEmptyContenthash(hex: string): boolean {
  return isEmptyHex(hex);
}
