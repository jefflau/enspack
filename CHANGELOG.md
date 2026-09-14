# Changelog

All notable changes for enspack `0.1.0` (spec `enspack/0.1`). Per-package
details live in each package's `CHANGELOG.md`.

## 0.1.0

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
publish `--from-hf`, seed. Exit codes from core `EXIT_CODES`. Human text on
stderr; `--json` on stdout.

### `@enspack/seed`

Hono API (MVP.md §4.2) in front of qBittorrent + Kubo. Policy: `allowRoots`,
license allowlist, per-publisher quota.

### `@enspack/registrar`

SPEC §7 claims: HF file proof, EIP-191 signature, operator-issued publisher
subnames, permanent attestations. PGlite locally; Postgres via `DATABASE_URL`.

### `@enspack/indexer`

Ponder indexer for `com.enspack.spec` / `contenthash` on discovered resolvers,
version-immutability violations, JSON API §4.3.

### `@enspack/bootstrap`

Mirror runner for `bootstrap/models.yaml` under `mirrors.enspack.eth` (WP-12;
present on master as `models.yaml`, full runner on `wp-12-bootstrap` until
merged).

### `@enspack/e2e`

Local Anvil swarm suite in `pnpm check`. Sepolia suite self-skips without
secrets. Nightly workflow at 03:00 UTC.
