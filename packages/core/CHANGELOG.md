# @enspack/core

## 0.1.0

- WP-07: `createInstaller` (SPEC §5 HF cache layout, `--dir`, `--emit-modelfile`, ready-to-run lines) and lockfile read/write/add/update/CID-mismatch (SPEC §9, §4 step 5, §6.2).
- WP-03: `createManifestStore` verified fetch (SPEC §4 step 3) with gateway rotation, Kubo/Pinata/seed `Pinner` adapters, and `fetchTorrentVerified` (SPEC §4 step 7a).
- Initial release (WP-01): schema-generated `Manifest` / `Lockfile` types, ajv validators with SPEC §3 extra rules, label and ref helpers, canonical JSON, and CIDv1 raw sha2-256.
- WP-02: ENS read path (`createResolver`) implementing SPEC §4 steps 1–6, plus `dnsEncodeName`, `decodeContenthashToCid`, `encodeIpfsContenthash`, `readResolverAddress`, and `publicClientFor`. Lockfile CID matching is left to WP-07/WP-08.
