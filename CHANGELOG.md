# Changelog

All notable changes for enspack `0.1.0` (spec `enspack/0.1`). Per-package
details live in each package's `CHANGELOG.md`.

## 0.1.0

WP-18 adds `enspack ens-setup` for one-shot Sepolia ENSv2 on-chain setup
(issue #17). WP-17 wires Sepolia ENSv2 through CLI, bootstrap, seed, indexer,
e2e and docs. Mainnet ENSv1 is unchanged. See `docs/ens-v2.md`.

### `@enspack/core`

Schema-generated `Manifest` / `Lockfile` types, ajv validators, label/ref
helpers, canonical JSON, CIDv1 raw sha2-256. ENS read path (SPEC §4 steps 1–6)
and write path (`createPublisher`, 3 txs new model / 2 txs new version). IPFS
verified fetch with Kubo/Pinata/seed pinners. Installer (HF cache, `--dir`,
Modelfile) and lockfile add/update/CID-mismatch.

### `@enspack/hf`

Hugging Face tree / revision / license / `buildFiles`. Hugging Bay resolve /
lock / submitFallback. `crossCheck` and `licenseGate` against
`LICENSE_ALLOWLIST`.

### `@enspack/torrent`

BitTorrent v1 metainfo (`url-list` webseeds), magnet validation, aria2c
downloader (metainfo, magnet, `--http-only`), streaming SHA-256 verifier and
quarantine.

### `@enspack/cli`

`enspack` / `ensget`: get, inspect, versions, verify, add, install, update,
publish `--from-hf`, `ens-setup` (Sepolia ENSv2), seed. `--chain sepolia`
selects ENSv2; `--ens-version` / `ENSPACK_ENS_VERSION` override. Exit codes
from core `EXIT_CODES`. Human text on stderr; `--json` on stdout (`inspect` /
`publish` include `ensVersion`; `ens-setup` includes resolver/registry/txs).

### `@enspack/seed`

Hono API (MVP.md §4.2) in front of qBittorrent + Kubo. Policy: `allowRoots`,
license allowlist, per-publisher quota.

### `@enspack/registrar`

SPEC §7 claims: HF file proof, EIP-191 signature, operator-issued publisher
subnames, permanent attestations. PGlite locally; Postgres via `DATABASE_URL`.

### `@enspack/indexer`

Ponder indexer for `com.enspack.spec` / `contenthash` on discovered resolvers
(v1 `readResolverAddress` on mainnet; v2 `findResolverV2` on Sepolia),
version-immutability violations, JSON API §4.3.

### `@enspack/bootstrap`

Mirror runner for `bootstrap/models.yaml` under `mirrors.enspack.eth` (WP-12).
`--chain sepolia` uses ENSv2 (4/2 txs + setup gas in `plan`).

### `@enspack/e2e`

Local Anvil mainnet-v1 swarm suite and Sepolia-fork ENSv2 suite in `pnpm check`.
Real Sepolia suite self-skips without secrets. Nightly workflow at 03:00 UTC.
