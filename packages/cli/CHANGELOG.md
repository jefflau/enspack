# @enspack/cli

## 0.1.0

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
