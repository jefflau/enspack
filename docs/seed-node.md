# Seed node

MVP.md WP-09 / §4.2. Compose stack: qBittorrent-nox + Kubo + Hono API
(`services/seed`). Hosts are not trusted: the API re-resolves names, re-validates
manifests, and checks infohash / file tree / pin CIDs locally.

## Compose up

**Requires a seedbox / Docker host.** From `services/seed`:

```bash
cp .env.example .env
# set ETH_RPC_URL / SEPOLIA_RPC_URL, QBT_USER, QBT_PASS
docker compose up --build
```

API: `SEED_PORT` (default 8080). qBittorrent WebUI: `QBT_WEBUI_PORT` (8081).
Kubo HTTP API `5001` stays on the compose network; the gateway is published on
host `8090` by default.

## Env

From `services/seed/src/env.ts` / `.env.example`:

| Variable | Default | Role |
|----------|---------|------|
| `PORT` | `8080` | API listen port (container) |
| `QBT_URL` | `http://qbittorrent:8081` | qBittorrent WebAPI origin |
| `QBT_USER` / `QBT_PASS` | (required) | WebAPI login |
| `KUBO_API` | `http://kubo:5001` | Kubo HTTP API |
| `ETH_RPC_URL` / `SEPOLIA_RPC_URL` | (required for the selected chain) | viem RPC; never logged |
| `ENSPACK_CHAIN` | `sepolia` | `mainnet` or `sepolia` |
| `ENSPACK_ENS_VERSION` | chain default | `v1` or `v2` (default v2 on sepolia, v1 on mainnet) |
| `ENSPACK_ENSV2_*` | core defaults | Universal Resolver / factory / implementation overrides |
| `SEED_ALLOW_ROOTS` | `enspack.eth` | comma list; `manifest.publisher` must equal a root or end with `.<root>` |
| `SEED_QUOTA_BYTES_PER_PUBLISHER` | `2199023255552` (2 TiB) | sum of `totalSize` already seeded for that publisher plus this manifest |
| `SEED_LICENSE_ALLOWLIST` | core `LICENSE_ALLOWLIST` | SPDX ids, comma-separated |
| `SEED_DOWNLOAD_DIR` | `/downloads` | qBittorrent `savepath` and state file |

## HTTP

```
POST /v1/seed        { "name": "<enspack name>" }
  202 { infohash, state }
  403 POLICY (outside allowRoots / quota / license)
  422 VERIFY (invalid manifest / tree)
  404 RESOLVE

POST /v1/pin         body bytes, Content-Type application/json | application/x-bittorrent
  201 { cid }
  413 too large · 422 invalid · 415 other types

GET  /v1/status/:infohash    200 { state, progress, peers, uploaded }
GET  /v1/health              { ok, qbittorrent, kubo, chain, ensVersion }  (HTTP 200 even if a dep is down)
```

```bash
# requires the compose stack — seedbox
curl -sS -X POST http://127.0.0.1:8080/v1/seed \
  -H 'content-type: application/json' \
  -d '{"name":"v1-0-0.tiny-model.mirrors.enspack.eth"}'

curl -sS http://127.0.0.1:8080/v1/health
```

CLI: `enspack seed <ref> --seed-node <url> [--json] [--chain]` (also exit 5 on
403/422). `enspack publish --pin seed` uses the same base URL.

qBittorrent `torrents/add` has no webseed field. The node merges
`manifest.distribution.webseeds` into torrent `url-list` (infohash unchanged)
and on qBittorrent 5.x also calls `addWebSeeds`.

Unit tests are in-process with fake qBittorrent/Kubo. Compose-up on a clean VM
and a live Sepolia swarm are **unproven** here (no Docker daemon in this
environment).
