# Indexer

MVP.md WP-11 / §4.3. Ponder app indexing `TextChanged(key="com.enspack.spec")`
and `ContenthashChanged` on public resolvers (mainnet + Sepolia), plus a JSON
API. Failed manifest fetches stay in `errors` and are never served as names.

```bash
pnpm --filter @enspack/indexer dev     # Ponder + API on :42069
pnpm --filter @enspack/indexer start
```

## Resolver discovery

**Sepolia (ENSv2):** `findResolverV2(enspack.eth)` and
`findResolverV2(mirrors.enspack.eth)` (skip zero), union
`ENSPACK_INDEXER_RESOLVERS_SEPOLIA`. Each publisher has its own
PermissionedResolver proxy; add new ones via that env list. A future
`ResolverUpdated` subscription is out of scope.

**Mainnet (ENSv1):** `readResolverAddress(enspack.eth)` plus
`ENSPACK_INDEXER_RESOLVERS_MAINNET`.

`TextChanged` / `ContenthashChanged` ABIs match the v1 PublicResolver
(PermissionedResolver inherits the standard profiles). The TextChanged
handler already reads `contenthash` from `event.log.address`.

A network whose RPC URL is missing is skipped. `ETH_RPC_URL` / `SEPOLIA_RPC_URL`
come from env only.

## PGlite vs Postgres

| | When |
|--|------|
| **PGlite** | `DATABASE_URL` unset. Default locally. Data under `services/indexer/.ponder/pglite`. |
| **Postgres** | `DATABASE_URL` set. Production path. |

Start blocks: `ENSPACK_INDEXER_START_BLOCK_MAINNET` (default 23000000),
`ENSPACK_INDEXER_START_BLOCK_SEPOLIA` (default 8000000).

## API

```
GET /v1/names?publisher=&q=&cursor=&limit=   { items, nextCursor }
GET /v1/names/:name                           { model, versions, manifest }
GET /v1/publishers                             { items: [{ name, hf, models }] }
GET /v1/violations                             { items: [{ name, node, previousCid, newCid, block }] }
GET /v1/health                                { ok: true }
```

`limit` defaults to 50 (max 200). `cursor` is opaque base64 of the last model
name. `q` is a substring on model / displayName / upstreamRepo.

```bash
# requires a running indexer with an RPC — Sepolia/mainnet
curl -sS http://127.0.0.1:42069/v1/names
curl -sS http://127.0.0.1:42069/v1/health
```

Acceptance “after WP-04 publishes on Sepolia, `/v1/names` shows it” is
**unproven** without Sepolia secrets. Procedure is in `services/indexer/README.md`.
