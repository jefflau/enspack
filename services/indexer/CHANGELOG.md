# @enspack/indexer

## Unreleased

- CORS: `GET` / `OPTIONS` on `/v1/*` with `Access-Control-Allow-Origin: *` so the catalog site can call the API from `enspack.dev`.

## 0.1.0

- WP-21: production Dockerfile copies `infra/package.json` so the workspace
  stays complete when `@enspack/infra` is present.
- WP-17: Sepolia (v2) discovers per-publisher PermissionedResolver proxies via
  `findResolverV2(enspack.eth)` and `findResolverV2(mirrors.enspack.eth)`, unions
  `ENSPACK_INDEXER_RESOLVERS_SEPOLIA`. Mainnet stays v1 `readResolverAddress`.
  New publisher resolvers are added through the env list; a `ResolverUpdated`
  subscription is out of scope.
- WP-11: Ponder indexer for `TextChanged` / `ContenthashChanged` on discovered ENS resolvers (SPEC §2.3), version-immutability violations (SPEC §6.2), and the JSON API in MVP.md §4.3.
