# @enspack/registrar

## 0.1.1

- WP-21: production Dockerfile copies `infra/package.json` so the workspace
  stays complete when `@enspack/infra` is present.
- WP-16: ENSv2 mode behind `REGISTRAR_ENS_VERSION` / core `ensVersionFor` (SPEC §7 as amended by [issue #17](https://github.com/jefflau/enspack/issues/17)). v2 issuance is 2 transactions (`register` + resolver `multicall`). v1 path and Anvil mainnet-fork test unchanged.

## 0.1.0

- WP-10: Hono registrar implementing SPEC §7 / MVP.md §4.1 (HF-proof claims, operator-issued publisher subnames, permanent attestations). Local/test database is PGlite; production uses Postgres via `DATABASE_URL`.
