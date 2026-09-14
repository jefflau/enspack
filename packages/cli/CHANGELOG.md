# @enspack/cli

## 0.1.0

- Initial release (WP-08): `enspack` binary and `ensget` alias (`enspack get`).
  Implements SPEC §4 get, SPEC §5 install layout, SPEC §8 publish-from-HF,
  SPEC §9 lockfile add/install/update, inspect/versions/verify, and seed-node
  `POST /v1/seed` (MVP.md §4.2). Exit codes follow core `EXIT_CODES`.
  `bin/enspack.js` wires core `createPublisher` from `ENSPACK_PUBLISHER_KEY`.
