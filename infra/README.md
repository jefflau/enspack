# One-box Sepolia MVP

One Ubuntu VM running the seed API, registrar, indexer, qBittorrent, Kubo, and
Caddy with automatic HTTPS. Matches BOOTSTRAP.md §4 (one seedbox) and MVP.md §4
HTTP contracts.

## What the box needs

- Ubuntu 24.04
- Docker Engine + the Compose plugin (`docker compose version`)
- Open ports: **80**, **443**, **6881/tcp+udp**, **4001/tcp+udp**
- DNS **A** records for:
  - `seed1.$DOMAIN` → seed API (`/v1/seed`, `/v1/pin`, `/v1/health`)
  - `registrar.$DOMAIN` → registrar (`/v1/claims`, `/v1/health`)
  - `index.$DOMAIN` → indexer (`/v1/names`, `/v1/health`; Ponder also serves `/health` and `/ready`)

The operator key (`ENSPACK_OPERATOR_KEY`) must already be granted ENSv2 registrar
roles on `enspack.eth` — see `docs/ens-v2.md`. Root name is core `ROOT_NAME`
(`enspack.eth`); there is no `REGISTRAR_ROOT_NAME` env.

## First boot

On a laptop (or a Cloud Agent VM) that can SSH to the box:

```bash
cp infra/.env.example infra/.env
# fill DOMAIN, ACME_EMAIL, SEPOLIA_RPC_URL, ENSPACK_OPERATOR_KEY, QBT_USER, QBT_PASS
# optional: HF_TOKEN, DATABASE_URL, ENSPACK_ENSV2_*

# first login to qBittorrent WebUI is internal-only. After compose is up, from
# the box: docker compose -f infra/docker-compose.yml exec qbittorrent ...
# Set the WebUI password to match QBT_PASS (QBT_USER defaults to admin).

chmod +x infra/deploy.sh infra/bootstrap-remote.sh
export SSH_KEY_FILE=/path/to/seedbox.pem   # optional; honoured by both scripts
./infra/deploy.sh ubuntu@your.seedbox.host
```

`deploy.sh` rsyncs the repo (excluding `node_modules`, `dist`, `.git`) to
`/opt/enspack`, copies `infra/.env` if present, runs
`docker compose -f infra/docker-compose.yml up -d --build`, waits for the three
HTTPS health endpoints, and prints them. SSH uses `-o BatchMode=yes`.

Then seed Tier 1 (first 3 by default):

```bash
./infra/bootstrap-remote.sh ubuntu@your.seedbox.host --tier 1 --limit 3
```

That runs `enspack-bootstrap plan` then `run` in a one-off container (`bootstrap`
compose profile) on the same `.env`, with downloads on the shared `downloads`
volume.

## How to check health

```bash
curl -fsS "https://seed1.$DOMAIN/v1/health"
curl -fsS "https://registrar.$DOMAIN/v1/health"
curl -fsS "https://index.$DOMAIN/v1/health"
```

On the box, without publishing app ports:

```bash
cd /opt/enspack
docker compose -f infra/docker-compose.yml ps
```

qBittorrent WebUI (`8081`) and Kubo API (`5001`) are **not** on the host.

`.github/workflows/nightly-health.yml` (source: `infra/nightly-health.yml`) curls
the three endpoints on a cron when the `INFRA_BASE_DOMAIN` secret is set, and
skips when it is absent.

## Rotate the operator key

1. Generate a new key. Grant it ENSv2 `ROLE_REGISTRAR | ROLE_RENEW` on the
   `enspack.eth` UserRegistry and resolver text roles (`docs/ens-v2.md`).
2. Replace `ENSPACK_OPERATOR_KEY` in `infra/.env` on the box (or locally, then
   re-run `deploy.sh`). Never echo the key.
3. `docker compose -f infra/docker-compose.yml up -d registrar` (and the next
   `bootstrap-remote.sh`).
4. Revoke the old address's roles. Confirm `GET https://registrar.$DOMAIN/v1/health`
   shows `approved: true` for the new operator.

## Where downloads live

Torrent payloads and bootstrap snapshots are the Docker volume `enspack_downloads`,
mounted at `/downloads` in `qbittorrent`, `seed-api`, and `bootstrap`.
qBittorrent `savepath` is `SEED_DOWNLOAD_DIR=/downloads`.

## Backup PGlite volumes

Default (no `DATABASE_URL`): registrar PGlite is `enspack_registrar-data`
(`/data/pglite`); indexer PGlite is `enspack_indexer-data`
(`/app/services/indexer/.ponder`). Bootstrap resume state is
`enspack_bootstrap-data` (`/data/state.json`).

```bash
docker run --rm \
  -v enspack_registrar-data:/data \
  -v "$PWD":/backup \
  alpine tar czf /backup/registrar-pglite.tgz -C /data .

docker run --rm \
  -v enspack_indexer-data:/data \
  -v "$PWD":/backup \
  alpine tar czf /backup/indexer-ponder.tgz -C /data .
```

Restore by extracting into the same volumes before `compose up`. If
`DATABASE_URL` is set, back up that Postgres instead.

Caddy ACME certs: `enspack_caddy-data`. Kubo repo: `enspack_kubo-data`.
qBittorrent config: `enspack_qbt-config`.
