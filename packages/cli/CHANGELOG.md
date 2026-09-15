# @enspack/cli

## 0.1.0

- WP-22: `publish` writes `SELF_CID_PLACEHOLDER` on `versions[last].cid` instead
  of the draft CID (issue #30). Previous entries keep (or are stamped with)
  real CIDs. `inspect` / `versions` human output marks the latest cid as
  "(this manifest — see contenthash)"; `versions --json` adds
  `latestCidFromContenthash`.
- WP-22: `--http-only` skips torrent metainfo fetch/verify (files still SHA-256
  checked from webseeds). Logs `http-only: skipping metainfo` on stderr.
- WP-22: Hugging Bay lock 404/409 skips the publish cross-check.
- WP-22: default store prepends `https://gateway.pinata.cloud/ipfs/{cid}`
  (`gatewaysFromEnv`); `ENSPACK_IPFS_GATEWAYS` still comes first.
- WP-18: `enspack ens-setup --chain sepolia --name enspack.eth` one-shot ENSv2
  on-chain setup. Signer is `ENSPACK_OPERATOR_KEY` (falls back to
  `ENSPACK_PUBLISHER_KEY`). `--dry-run` / `--json` / `--subname` / `--operator`.
  v1 exits 5. See `docs/ens-v2.md`.
- WP-17: `--chain sepolia` selects ENSv2 via `ensVersionFor`; `--ens-version` /
  `ENSPACK_ENS_VERSION` override. `createDefaultDeps` passes `ensVersion` +
  `ensV2` into `createResolver` / `createPublisher`. `publish` prints `setup:`
  lines and expected tx counts (v2: 4 new model / 2 new version + setup);
  `--json` includes `ensVersion` and `setup`. `inspect --json` includes
  `ensVersion`. Exit codes unchanged.
- Initial release (WP-08): `enspack` binary and `ensget` alias (`enspack get`).
  Implements SPEC §4 get, SPEC §5 install layout, SPEC §8 publish-from-HF,
  SPEC §9 lockfile add/install/update, inspect/versions/verify, and seed-node
  `POST /v1/seed` (MVP.md §4.2). Exit codes follow core `EXIT_CODES`.
  `bin/enspack.js` wires core `createPublisher` from `ENSPACK_PUBLISHER_KEY`.
