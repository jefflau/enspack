import { LICENSE_ALLOWLIST, MIRROR_NAMESPACE, SELF_CID_PLACEHOLDER } from "@enspack/core";

/** SPEC §3: MAGNET_RE-valid 40-hex zeros used only to drive the downloader. */
export const PLACEHOLDER_INFOHASH = "0".repeat(40);

/** SPEC §4: placeholder magnet matching `MAGNET_RE`. */
export const PLACEHOLDER_MAGNET = `magnet:?xt=urn:btih:${PLACEHOLDER_INFOHASH}`;

/** Schema-valid CID used as a torrent-cid / draft placeholder (same bytes as issue #30). */
export const PLACEHOLDER_CID = SELF_CID_PLACEHOLDER;

export const DEFAULT_PUBLISHER = MIRROR_NAMESPACE;

export const DEFAULT_ALLOWLIST: readonly string[] = LICENSE_ALLOWLIST;

export const DEFAULT_WEBSEEDS = {
  huggingface: "https://huggingface.co/{repo}/resolve/{revision}/",
  huggingbay: "https://huggingbay.xyz/api/downloads/{hb_id}/",
} as const;
