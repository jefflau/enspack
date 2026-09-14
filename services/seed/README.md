# `@enspack/seed`

Seed node for enspack (MVP.md WP-09 / §4.2): a Hono API in front of
qBittorrent (swarm) and Kubo (raw-CID pins). Hosts are not trusted; the API
re-resolves names, re-validates manifests, and checks infohash / file tree /
pin CIDs locally.

## Compose up (clean VM)

From this directory, with Docker and Compose v2:

```bash
cp .env.example .env
# set ETH_RPC_URL / SEPOLIA_RPC_URL, QBT_USER, QBT_PASS
# set the same WebUI credentials in qBittorrent on first login
docker compose up --build
```

The API listens on `SEED_PORT` (default 8080). qBittorrent WebUI uses
`QBT_WEBUI_PORT` (default 8081). Kubo's HTTP API (`5001`) is **not** published
on the host; only the gateway is (default host 8090 → container 8080).

Never bake secrets into compose or the image. Keys and RPC URLs come from env.

## Environment

| Variable | Default | Role |
|----------|---------|------|
| `PORT` | `8080` | API listen port (container) |
| `QBT_URL` | `http://qbittorrent:8081` | qBittorrent WebAPI origin |
| `QBT_USER` / `QBT_PASS` | (empty, required) | WebAPI login |
| `KUBO_API` | `http://kubo:5001` | Kubo HTTP API (internal) |
| `ETH_RPC_URL` / `SEPOLIA_RPC_URL` | (required for the selected chain) | viem RPC; never logged |
| `ENSPACK_CHAIN` | `sepolia` | `mainnet` or `sepolia` |
| `SEED_ALLOW_ROOTS` | `enspack.eth` | comma list; `manifest.publisher` must equal a root or end with `.<root>` |
| `SEED_QUOTA_BYTES_PER_PUBLISHER` | `2199023255552` (2 TiB) | sum of `totalSize` already seeded for that publisher plus this manifest |
| `SEED_LICENSE_ALLOWLIST` | core `LICENSE_ALLOWLIST` | SPDX ids, comma-separated |
| `SEED_DOWNLOAD_DIR` | `/downloads` | qBittorrent `savepath` and `.enspack-seed-state.json` |

## HTTP (MVP.md §4.2)

Errors are `{ "error": string, "code": string }`.

- `POST /v1/seed { "name" }` → `202 { infohash, state }`
  - `400` bad body · `404 { code: "RESOLVE" }` · `403 { code: "POLICY" }` · `422 { code: "VERIFY" }`
- `POST /v1/pin` body bytes, `Content-Type: application/json` or `application/x-bittorrent` → `201 { cid }`
  - `413` over `MANIFEST_MAX_BYTES` / `TORRENT_MAX_BYTES` · `422` invalid · `415` other types · `500 { code: "PUBLISH" }` if Kubo CID ≠ raw sha2-256
- `GET /v1/status/:infohash` → `200 { state, progress, peers, uploaded }`
- `GET /v1/health` → `{ ok: true, qbittorrent, kubo, chain }` (HTTP 200 even when a dependency is down)

### How webseeds reach qBittorrent

qBittorrent's `torrents/add` has **no webseed field**. The seed node:

1. Relies on BEP 19 `url-list` already inside the `.torrent` metainfo.
2. Merges `manifest.distribution.webseeds` into `url-list` (infohash unchanged) before add.
3. On qBittorrent **5.x**, also calls `POST /api/v2/torrents/addWebSeeds` (`hash` + `urls` pipe-separated).

When `distribution.torrent` has neither `cid` nor `url`, the API adds the magnet
directly (`state: "metadata"`) so qBittorrent can fetch metainfo itself. The
magnet must match SPEC `MAGNET_RE`.

Pins use core `kuboPinner` (`POST /api/v0/block/put?cid-codec=raw&mhtype=sha2-256&pin=true`).
Returned CIDs must equal `resolved.cid` and `torrent.cid`.

## Manual acceptance (Sepolia swarm)

Unproven in this environment (no Docker daemon, no live Sepolia fixture run).

On a clean VM with this compose stack up and a published Sepolia fixture name:

1. `curl -sS -X POST http://127.0.0.1:8080/v1/seed -H 'content-type: application/json' -d '{"name":"<sepolia-fixture>"}'` → 202 with the fixture infohash.
2. From a second machine (or process) whose only peer is this seed, download with `enspack get` / aria2c until the client reports 100 %.
3. `POST /v1/seed` for a name whose publisher is outside `SEED_ALLOW_ROOTS` → 403.
4. A name whose manifest fails validation → 422.

## Develop

```bash
pnpm --filter @enspack/seed test
# from repo root:
pnpm check
```

Unit tests are in-process (`app.request`) with fake qBittorrent and Kubo on
`127.0.0.1`. They do not use the network or Docker. Compose/Dockerfile are
proven by structure tests only.
