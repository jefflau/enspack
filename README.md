# enspack

Name, verify and fetch model weights without depending on any single host.

```bash
enspack get qwen--qwen2-5-7b-instruct.mirrors.enspack.eth
# resolves ENS → content-addressed manifest → torrent + webseeds → SHA-256 per file → HF cache
```

An ENS name owned by the publisher points at a manifest (IPFS CID in
`contenthash`). The manifest lists every file with its SHA-256 and how to get
the bytes (BitTorrent with HF / Hugging Bay webseeds, optional OCI and IPFS).
Versions are subnames (`v1-0-0.<model>.<publisher>.enspack.eth`); a project
pins them in `enspack.lock` and reproduces its model set with `enspack install`.

- `SPEC.md` — protocol (frozen at `enspack/0.1`)
- `MVP.md` — work packages, interfaces, service contracts
- `AGENTS.md` — rules for agents building this repo
- `BOOTSTRAP.md` — how the first models and publishers get on
- `schema/` — JSON Schemas for `enspack.json` and `enspack.lock`
- `examples/` — a real manifest for Qwen2.5-7B-Instruct (real hashes, placeholder infohash)

Hugging Face is upstream, not a competitor: hashes come from HF's LFS
metadata, webseeds point at pinned HF revisions, and `enspack publish --from-hf`
is the main publishing path. What enspack adds is the layer HF doesn't have:
a publisher-owned name, host-independent verification, and a lockfile.

## 60-second quickstart

```bash
npm i -g @enspack/cli
# or from this repo:
pnpm --filter @enspack/cli build && node packages/cli/bin/enspack.js --help

enspack get qwen--qwen2-5-7b-instruct.mirrors.enspack.eth
# requires the name to exist on mainnet with a seeded torrent — see Status

# pin a model into a project and reproduce it later
enspack add qwen--qwen2-5-7b-instruct.mirrors.enspack.eth
enspack install
# writes / reads enspack.lock; CID mismatch exits 3 unless --update
```

`ensget` is an alias for `enspack get`. Human messages go to stderr; `--json`
prints one JSON object to stdout. Global `--chain mainnet|sepolia` defaults to
mainnet. Flags: `enspack <cmd> --help`.

The live `get` of the Qwen mirror **requires Sepolia/mainnet infra** that is
not published yet (MVP.md §0.1). Local proof uses Anvil + `test/fixtures/tiny-model/`
(`test/e2e`).

## Repo map

| Path | Package | Role |
|------|---------|------|
| `packages/core` | `@enspack/core` | labels, schema, ENS read/write, IPFS verified fetch, installer, lockfile |
| `packages/hf` | `@enspack/hf` | Hugging Face tree/license + Hugging Bay client |
| `packages/torrent` | `@enspack/torrent` | metainfo, aria2c downloader, SHA-256 verifier |
| `packages/cli` | `@enspack/cli` | `enspack` / `ensget` binaries |
| `services/seed` | `@enspack/seed` | seed node API + qBittorrent + Kubo compose |
| `services/registrar` | `@enspack/registrar` | HF-proof → `enspack.eth` publisher subnames |
| `services/indexer` | `@enspack/indexer` | Ponder indexer + JSON API |
| `bootstrap/` | `@enspack/bootstrap` | `models.yaml` mirror runner (`enspack-bootstrap plan|run`) |
| `test/fixtures` | — | tiny-model folder + torrent for swarm tests |
| `test/e2e` | `@enspack/e2e` | local Anvil swarm (CI) + Sepolia (nightly) |

Docs: `docs/publishing.md`, `docs/registrar.md`, `docs/seed-node.md`,
`docs/indexer.md`, `docs/exit-codes.md`.

## Development

```bash
pnpm install
pnpm check          # build + lint + typecheck + test (includes local e2e)
```

Anvil mainnet-fork tests use `ETH_RPC_URL` when set, otherwise they rotate
through public endpoints (publicnode, 1rpc, drpc) and pin the fork a few blocks
behind head. `anvil` (`~/.foundry/bin`) and `aria2c` are required for
fork/swarm suites; they skip when missing.

Secrets stay in env (`ETH_RPC_URL`, `SEPOLIA_RPC_URL`, `ENSPACK_PUBLISHER_KEY`,
`ENSPACK_OPERATOR_KEY`, `HF_TOKEN`, `PINATA_JWT`). Never write them to disk or
logs. CLI env vars: `packages/cli/src/defaults.ts` and `enspack --help`.

## Status

Honest against MVP.md §0. Local CI is the Anvil fork + fixture swarm, not mainnet.

| MVP §0 | Claim | Status |
|--------|-------|--------|
| 1 | `enspack get qwen--qwen2-5-7b-instruct.mirrors.enspack.eth` on a clean machine | **Blocked** on mainnet mirrors + seedbox (BOOTSTRAP.md). Local equivalent proven in `test/e2e` against `tiny-model.enspack-test.eth` on an Anvil fork. |
| 2 | `enspack publish --from-hf` ≤ 3 txs | Publisher on-chain path proven on Anvil (3 txs new model, 2 txs new version). Live `--from-hf` **requires Sepolia/HF** (`ENSPACK_PUBLISHER_KEY`, pin target). |
| 3 | HF user claims `<user>.enspack.eth` with no human | **Blocked** on registrar deploy + Sepolia/mainnet operator. Claim HTTP is implemented; Sepolia E2E is unproven. |
| 4 | `enspack.lock` + `enspack install`; refuse if CID changed | **Proven locally** (`packages/cli` lock tests + `test/e2e` add/install/--frozen + lock-mismatch exit 3). |
| 5 | `GET https://index.enspack.dev/v1/names` lists mainnet names | **Blocked** on indexer deploy + mainnet names. API contract is implemented. |
| 6 | ≥ 25 mirrored models under `mirrors.enspack.eth` seeded | **Blocked** on seedbox + WP-12 live run. `bootstrap/models.yaml` is the list. |

Nightly (`.github/workflows/e2e-nightly.yml`, 03:00 UTC) runs `@enspack/e2e`
with Sepolia secrets when present; the Sepolia suite self-skips without them.
