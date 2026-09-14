# @enspack/seed

## 0.1.0

- WP-17: resolver is constructed with the chain's `ensVersion` / `ensV2`
  (`ENSPACK_ENS_VERSION`, `ENSPACK_ENSV2_*`). `/v1/health` reports `ensVersion`.
- WP-21: production Dockerfile copies `infra/package.json` so the workspace
  stays complete when `@enspack/infra` is present.
- Initial seed node (WP-09): Hono API per MVP.md §4.2, qBittorrent + Kubo compose stack, policy (`allowRoots`, license, per-publisher quota), and in-process acceptance tests.
