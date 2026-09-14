import type { ManifestStore } from "../interfaces.js";

/** SPEC §8 steps 3–4 / MVP.md WP-03: content types accepted by pin adapters. */
export type PinContentType = "application/json" | "application/x-bittorrent";

/**
 * SPEC §8 steps 3–4 / MVP.md WP-03: pin bytes and return the host-reported CID (caller must compare).
 */
export interface Pinner {
  readonly name: string;
  pin(bytes: Uint8Array, cid: string, contentType: PinContentType): Promise<string>;
}

/** SPEC §4 step 3 / MVP.md WP-03: per-call override for the verified-fetch byte cap. */
export interface GetVerifiedOpts {
  maxBytes?: number;
}

/**
 * SPEC §4 step 3 / MVP.md WP-03: options for {@link createManifestStore}.
 *
 * `gateways` are URL templates containing `{cid}`, tried in order. Default is
 * `DEFAULT_GATEWAYS` (SPEC §4 step 3: dweb.link, ipfs.io, w3s.link). Callers
 * with extra gateways should pass them first, then the defaults.
 */
export interface ManifestStoreOpts {
  gateways?: readonly string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  pinner?: Pinner;
}

/**
 * SPEC §4 step 3 / MVP.md WP-03: ManifestStore plus the per-call byte-cap argument used for torrents.
 */
export interface IpfsManifestStore extends ManifestStore {
  getVerified(cid: string, opts?: GetVerifiedOpts): Promise<Uint8Array>;
  put(bytes: Uint8Array, contentType?: PinContentType): Promise<string>;
}
