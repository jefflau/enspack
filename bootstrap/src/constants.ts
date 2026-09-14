import { LICENSE_ALLOWLIST, MIRROR_NAMESPACE } from "@enspack/core";

/** SPEC §3: MAGNET_RE-valid 40-hex zeros used only to drive the downloader. */
export const PLACEHOLDER_INFOHASH = "0".repeat(40);

/** SPEC §4: placeholder magnet matching `MAGNET_RE`. */
export const PLACEHOLDER_MAGNET = `magnet:?xt=urn:btih:${PLACEHOLDER_INFOHASH}`;

/** Schema-valid CID used as a versions[] placeholder before the real pin. */
export const PLACEHOLDER_CID = "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export const DEFAULT_PUBLISHER = MIRROR_NAMESPACE;

export const DEFAULT_ALLOWLIST: readonly string[] = LICENSE_ALLOWLIST;

export const DEFAULT_WEBSEEDS = {
  huggingface: "https://huggingface.co/{repo}/resolve/{revision}/",
  huggingbay: "https://huggingbay.xyz/api/downloads/{hb_id}/",
} as const;
