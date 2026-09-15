/** SPEC §2.1: discovery beacon for indexers. */
export const SPEC_STRING = "enspack/0.1";

/** SPEC §2: on-chain text record keys. */
export const TEXT_KEYS = {
  spec: "com.enspack.spec",
  magnet: "com.enspack.magnet",
  hf: "com.enspack.hf",
} as const;

/** SPEC / AGENTS.md: ENS Registry on mainnet and Sepolia. */
export const ENS_REGISTRY: `0x${string}` = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

/** SPEC §1.1: convenience registry operated by the project. */
export const ROOT_NAME = "enspack.eth";

/** SPEC §1.1: unverified-mirror publisher namespace. */
export const MIRROR_NAMESPACE = "mirrors.enspack.eth";

/** SPEC §4: magnet strings MUST match before being passed to any process. */
export const MAGNET_RE = /^magnet:\?xt=urn:btih:[0-9a-fA-F]{40}(&|$)/;

/** SPDX ids the reference tooling will publish without an override flag. */
export const LICENSE_ALLOWLIST = [
  "apache-2.0",
  "mit",
  "bsd-3-clause",
  "bsd-2-clause",
  "cc0-1.0",
  "cc-by-4.0",
  "odc-by",
] as const;

/** SPEC §4 step 3: default IPFS gateway URL templates (`{cid}` substituted). */
export const DEFAULT_GATEWAYS = [
  "https://{cid}.ipfs.dweb.link",
  "https://ipfs.io/ipfs/{cid}",
  "https://{cid}.ipfs.w3s.link",
] as const;

/**
 * Schema-valid placeholder for `versions[last].cid` (issue #30). A manifest
 * cannot contain its own CID; clients take the current version from contenthash.
 */
export const SELF_CID_PLACEHOLDER = `bafkrei${"a".repeat(52)}`;

/** SPEC / MVP WP-03: manifest size cap (1 MiB). */
export const MANIFEST_MAX_BYTES = 1024 * 1024;

/** SPEC / MVP WP-03: `.torrent` metainfo size cap (16 MiB). */
export const TORRENT_MAX_BYTES = 16 * 1024 * 1024;
