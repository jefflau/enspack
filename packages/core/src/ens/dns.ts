import { toHex } from "viem";
import { packetToBytes } from "viem/ens";

/** SPEC §4: DNS-encode an ENS name for Universal Resolver `resolve(bytes,bytes)`. */
export function dnsEncodeName(name: string): `0x${string}` {
  return toHex(packetToBytes(name));
}
