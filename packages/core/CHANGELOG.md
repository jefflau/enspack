# @enspack/core

## 0.1.0

- WP-18: `planEnsSetup` / `runEnsSetup` for one-shot ENSv2 publisher setup
  (resolver + UserRegistry + optional operator grants + subname registries).
  Idempotent; pending proxies resolved from `ProxyDeployed`.
- WP-15: ENSv2 publisher (`createPublisher({ ensVersion: "v2" })` / `createPublisherV2`) behind the issue #17 flag: first-time publisher setup, model UserRegistry deploy, `register` + one resolver `multicall` (4 txs new model / 2 new version). V1 path unchanged.
- WP-14: ENSv2 read path behind `ensVersion` / `ENSPACK_ENS_VERSION` (Sepolia default v2, mainnet v1). Discovery helpers, role bitmaps, and UniversalResolverV2 `resolve(bytes,bytes)` (issue #17). Existing v1 path unchanged.
- WP-04: ENS write path (`createPublisher`, `formatPublishPlan`) implementing SPEC §8 step 5: `Registry.setSubnodeRecord` plus one `PublicResolver.multicall`, parent's resolver, dry-run gas, version immutability.
- WP-07: `createInstaller` (SPEC §5 HF cache layout, `--dir`, `--emit-modelfile`, ready-to-run lines) and lockfile read/write/add/update/CID-mismatch (SPEC §9, §4 step 5, §6.2).
- WP-03: `createManifestStore` verified fetch (SPEC §4 step 3) with gateway rotation, Kubo/Pinata/seed `Pinner` adapters, and `fetchTorrentVerified` (SPEC §4 step 7a).
- WP-02: ENS read path (`createResolver`) implementing SPEC §4 steps 1–6, plus `dnsEncodeName`, `decodeContenthashToCid`, `encodeIpfsContenthash`, `readResolverAddress`, and `publicClientFor`. Lockfile CID matching is left to WP-07/WP-08.
- Initial release (WP-01): schema-generated `Manifest` / `Lockfile` types, ajv validators with SPEC §3 extra rules, label and ref helpers, canonical JSON, and CIDv1 raw sha2-256.
