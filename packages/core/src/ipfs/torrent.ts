import { TORRENT_MAX_BYTES } from "../constants.js";
import { EnspackError } from "../error.js";
import type { Manifest } from "../types.js";
import { readCappedBytes } from "./capped.js";
import type { FetchLike } from "./pinners.js";
import type { IpfsManifestStore } from "./types.js";

/**
 * SPEC §4 step 7a: metainfo from `distribution.torrent.cid` (verified) or `.url` (plain HTTPS; infohash is checked by WP-06 `parseTorrent` against `distribution.infohash`).
 */
export async function fetchTorrentVerified(
  store: IpfsManifestStore,
  manifest: Manifest,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<Uint8Array | null> {
  const torrent = manifest.distribution.torrent;
  if (torrent === undefined) {
    return null;
  }

  const cid = torrent.cid;
  if (cid !== undefined && cid !== "") {
    return store.getVerified(cid, { maxBytes: TORRENT_MAX_BYTES });
  }

  const url = torrent.url;
  if (url !== undefined && url !== "") {
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    } catch (cause) {
      throw new EnspackError("FETCH", `torrent URL fetch failed: ${url}`, cause);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new EnspackError("FETCH", `torrent URL HTTP ${res.status}`);
    }
    return readCappedBytes(res, TORRENT_MAX_BYTES);
  }

  return null;
}
