# @enspack/indexer

Ponder indexer for enspack names (MVP.md WP-11, SPEC §2.3 / §6.2) plus the JSON API in MVP.md §4.3.

## Run

```sh
pnpm --filter @enspack/indexer dev    # Ponder dev server (API on :42069)
pnpm --filter @enspack/indexer start    # production
pnpm --filter @enspack/indexer check  # codegen + tsc + vitest
```

## Database

- **PGlite** (default): used when `DATABASE_URL` is unset. No Postgres or Docker required locally. Data lives under `services/indexer/.ponder/pglite`.
- **Postgres**: set `DATABASE_URL` (Ponder reads it automatically). This is the production path.

## Networks and env

RPC URLs come from env only. A network whose URL is missing is skipped.

| Variable | Purpose |
| --- | --- |
| `ETH_RPC_URL` | Mainnet JSON-RPC. If unset, mainnet is not indexed. |
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC. If unset, Sepolia is not indexed. |
| `DATABASE_URL` | Postgres URL. Unset → PGlite. |
| `ENSPACK_INDEXER_RESOLVERS_MAINNET` | Extra resolver addresses (comma-separated) unioned with the discovered `enspack.eth` resolver. |
| `ENSPACK_INDEXER_RESOLVERS_SEPOLIA` | Same for Sepolia. |
| `ENSPACK_INDEXER_START_BLOCK_MAINNET` | First mainnet block to index. Default **23000000** (~Q1 2026; enspack names did not exist before this project). |
| `ENSPACK_INDEXER_START_BLOCK_SEPOLIA` | First Sepolia block. Default **8000000**. |

Never put RPC URLs or keys in the repo. If neither RPC URL is set (CI `ponder codegen` / typecheck), the config uses a localhost placeholder so types can be generated; it indexes nothing.

## How resolvers are discovered

Public resolvers are **not hardcoded** (AGENTS.md). On each configured network the indexer:

1. Reads the resolver of `enspack.eth` (`ROOT_NAME`) via core `readResolverAddress` (ENSIP-10 / registry walk).
2. Unions that address with `ENSPACK_INDEXER_RESOLVERS_<NETWORK>` so additional public resolvers can be added.
3. Indexes `TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value)` and `ContenthashChanged(bytes32 indexed node, bytes hash)` on those contracts.

## HTTP (MVP.md §4.3)

```
GET /v1/names?publisher=&q=&cursor=&limit=   { items, nextCursor }
GET /v1/names/:name                           { model, versions, manifest }
GET /v1/publishers                             { items: [{ name, hf, models }] }
GET /v1/violations                             { items: [{ name, node, previousCid, newCid, block }] }
GET /v1/health                                { ok: true }
```

Errors are `{ error, code }`. `cursor` is opaque base64 of the last model name. `limit` defaults to 50 (max 200). `q` is a substring match on model / displayName / upstreamRepo. `publisher` is an exact match.

Failed manifest fetches stay in the `errors` table for operators and are never served as names.

## Manual Sepolia check (WP-04)

Acceptance “after WP-04 publishes on Sepolia, `/v1/names` shows it within one block confirmation + fetch” cannot run in CI (no Sepolia secrets). Procedure:

1. Publish a fixture model on Sepolia (WP-04). Note the model name, version name, manifest CID, and the publish block.
2. Set `SEPOLIA_RPC_URL` and `ENSPACK_INDEXER_START_BLOCK_SEPOLIA` to a few blocks before that tx.
3. From the repo root: `pnpm --filter @enspack/indexer dev`.
4. After one block confirmation plus the verified manifest fetch, `curl -s http://127.0.0.1:42069/v1/names` includes the model with `latest.cid` equal to the published CID.
5. `GET /v1/names/<model>` returns `manifest` matching the published JSON.

## Docker

```sh
docker build -f services/indexer/Dockerfile -t enspack-indexer .
docker run --rm -p 42069:42069 -e SEPOLIA_RPC_URL -e ETH_RPC_URL enspack-indexer
```
