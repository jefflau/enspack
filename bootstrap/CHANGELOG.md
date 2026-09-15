# @enspack/bootstrap

## 0.1.0

- WP-22: `assembleManifest` writes `SELF_CID_PLACEHOLDER` on the current
  `versions[]` entry and stamps the previous tail with the on-chain CID
  (issue #30).
- WP-22: `createProductionDeps` uses `gatewaysFromEnv` so `ENSPACK_IPFS_GATEWAYS`
  is prepended (then Pinata, then SPEC defaults).
- WP-21: `ENSPACK_BOOTSTRAP_STATE` overrides the `state.json` path so the one-box
  seed volume can persist resume state. `bootstrap/Dockerfile` is the infra
  compose `bootstrap` profile image (aria2c + `pnpm deploy --filter @enspack/bootstrap`).

- WP-17: `--chain sepolia` uses ENSv2 (`ensVersionFor`); `--ens-version` /
  `ENSPACK_ENS_VERSION` override. Plan gas totals include `PublishResultV2.setup`.
  README notes v2 tx counts (4/2) and that `mirrors.enspack.eth` needs a
  UserRegistry (or the first publish creates it when the operator owns the name).
- WP-12: `enspack-bootstrap plan|run` mirrors `models.yaml` under
  `mirrors.enspack.eth` (BOOTSTRAP.md §5). Resumable `state.json`, license/gating
  gate, HF tree + Hugging Bay cross-check, aria2c download, local SHA-256,
  torrent, pin, publish, seed, optional HB fallback.
