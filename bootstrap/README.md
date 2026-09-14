# @enspack/bootstrap

Runner that mirrors `bootstrap/models.yaml` under `mirrors.enspack.eth` per
[BOOTSTRAP.md](../BOOTSTRAP.md) §5. Selection criteria in §2 are enforced at
run time, not by editing the yaml.

## Commands

```bash
enspack-bootstrap plan [--tier 1] [--only <repo>...] [--json]
                       [--chain sepolia|mainnet] [--ens-version v1|v2]
enspack-bootstrap run  [--tier 1] [--only <repo>...] [--limit n]
                       [--chain sepolia|mainnet] [--ens-version v1|v2]
                       [--downloads <dir>]
                       [--pin kubo|seed] [--seed-node URL]
                       [--submit-hb] [--resume]
```

`plan` is a dry run: license/gating/revision gate, `buildFiles` + Hugging Bay
cross-check, then `createPublisher({ account, ensVersion }).publish({ dryRun: true })` for a
gas estimate (including first-time `setup:` deploys). No downloads and no transactions.

`--chain sepolia` (the default) uses ENSv2: **4 txs for a new model**, **2 for a
new version**, plus any first-time publisher setup. `mirrors.enspack.eth` must
already have a UserRegistry, or the runner's first publish creates it when the
operator owns the name. Mainnet stays ENSv1 (3 / 2) and is still refused unless
`ENSPACK_BOOTSTRAP_ALLOW_MAINNET=1` and stdin is a TTY.

`--ens-version v1|v2` and `ENSPACK_ENS_VERSION` override the chain default.

`--json` writes the machine payload to stdout. Human logs always go to stderr.

## Environment

| Variable | Used for |
|----------|----------|
| `SEPOLIA_RPC_URL` | `--chain sepolia` (default) |
| `ETH_RPC_URL` | `--chain mainnet` |
| `ENSPACK_OPERATOR_KEY` | owner of `mirrors.enspack.eth` (never logged) |
| `HF_TOKEN` | optional Hugging Face read token |
| `ENSPACK_KUBO_API` | `--pin kubo` (default `http://127.0.0.1:5001`) |
| `ENSPACK_SEED_NODE` | `--pin seed` and `POST /v1/seed` |
| `ENSPACK_BOOTSTRAP_ALLOW_MAINNET` | must be `1` **and** stdin must be a TTY to run mainnet |
| `ENSPACK_BOOTSTRAP_STATE` | path to `state.json` (default `<package>/state.json`; infra volume uses `/data/state.json`) |
| `ENSPACK_ENS_VERSION` | `v1` or `v2` (default v2 on sepolia, v1 on mainnet) |
| `ENSPACK_ENSV2_*` | Universal Resolver / factory / implementation overrides |

Agents never run mainnet. Keys and RPC URLs are never written to disk or logs.

## Seedbox layout

```
<downloads>/<org>--<repo>/     # snapshot files (aria2c httpOnly)
bootstrap/state.json           # resumable per-entry step log (gitignored)
```

On the seedbox, point `--downloads` at the WP-09 compose volume and
`--pin seed --seed-node http://127.0.0.1:<api>`.

## Resume

State is written atomically after every step (`state.json.tmp` → `state.json`).
Re-runs skip `done` and `skipped` entries. `--resume` continues an in-progress
entry at the first uncompleted step (a crash after torrent, for example, retries
pin). Without `--resume`, an in-progress or failed entry starts again from gate.

## State-machine steps

`gate` → `files` → `download` → `verify` → `torrent` → `pin` → `publish` → `seed`
→ `submit-hb` (optional) → `confirm`

`done` is set only after `createResolver().resolve(name)` returns the published
CID. That is a local check. **BOOTSTRAP.md §5 step 9 still requires a different
machine:**

```bash
enspack get <name>
```

before announcing the mirror.

## Sepolia: first three Tier 1 entries (unproven here)

No operator key / `mirrors.enspack.eth` on Sepolia is available in this
environment. On a machine that has both, with the WP-09 stack up:

```bash
export SEPOLIA_RPC_URL=...
export ENSPACK_OPERATOR_KEY=...
export ENSPACK_SEED_NODE=http://127.0.0.1:8787
export ENSPACK_KUBO_API=http://127.0.0.1:5001

enspack-bootstrap plan --tier 1 --limit 3 --json
enspack-bootstrap run --tier 1 --limit 3 --chain sepolia --pin seed \
  --seed-node "$ENSPACK_SEED_NODE"

# on a different machine, for each published name:
enspack get v1-0-0.qwen--qwen3-0-6b.mirrors.enspack.eth
enspack get v1-0-0.qwen--qwen3-4b.mirrors.enspack.eth
enspack get v1-0-0.qwen--qwen3-8b.mirrors.enspack.eth
```

Those three repos are the first entries in `models.yaml` Tier 1.
