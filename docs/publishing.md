# Publishing

SPEC §8 reference flow, as implemented by `enspack publish` (`packages/cli/src/commands/publish.ts`).

```
enspack publish --from-hf <org/repo> --publisher <name> --version <semver>
  [--revision <sha>] [--webseed <url>...] [--pin kubo|pinata|seed]
  [--seed-node <url>] [--submit-hb] [--dry-run]
  [--i-have-redistribution-rights] [--json] [--chain mainnet|sepolia]
```

`--help` snapshot is in `packages/cli/test/__snapshots__/help.test.ts.snap` and is
re-run against the built binary in `test/e2e/test/help-and-workflow.test.ts`.

## Flow

1. `HfClient.info` + `licenseGate`. Gated/private repos and licenses off
   `LICENSE_ALLOWLIST` (`apache-2.0`, `mit`, `bsd-3-clause`, `bsd-2-clause`,
   `cc0-1.0`, `cc-by-4.0`, `odc-by`) fail with `POLICY` (exit 5) unless
   `--i-have-redistribution-rights` is passed (SPEC §11).
2. Resolve revision (`main` unless `--revision`). Build `files[]` from the HF
   tree (`lfs.oid` / local hash). Hugging Bay `lock` is cross-checked when an
   artifact exists; disagreement aborts.
3. Download the snapshot over HTTP webseeds, verify SHA-256, `createTorrent`
   with `url-list` = `[hfWebseed(repo, revision), ...--webseed]`.
4. Pin `.torrent` then the canonical manifest JSON (sorted keys, no trailing
   whitespace). `--pin` is required unless `--dry-run` (dry-run computes CIDs
   locally and does not pin).
5. On-chain from `ENSPACK_PUBLISHER_KEY` via core `createPublisher` (SPEC §8
   step 5):
   - first publish of a model: `Registry.setSubnodeRecord` for the model label
   - every version: `Registry.setSubnodeRecord` for `v<semver-with-dots-as-dashes>`
   - one `PublicResolver.multicall` writing `contenthash` + `com.enspack.spec`
     (+ magnet text on the version node) on **both** version and model nodes
   That is **3 transactions for a new model and 2 for a new version**. Re-runs
   are idempotent (existing subnodes are skipped). The resolver is read from
   the publisher name at runtime; it is not hardcoded.
6. If `ENSPACK_SEED_NODE` / `--seed-node` is set (and not dry-run),
   `POST /v1/seed { name }` is attempted (failures are logged, not fatal).
   `--submit-hb` POSTs the magnet to Hugging Bay.

`--dry-run` still talks to HF to build `files[]`, then prints the canonical
manifest, CID, and calldata/gas on stderr (`formatPublishPlan`). No pins, no
txs.

Publisher names under `mirrors.enspack.eth` use `<org>--<repo>` labels and set
`canonical` to `<repo>.<org>.enspack.eth`. Agents must not publish on Sepolia
under any label other than `*.mirrors.enspack.eth` (FLEET.md).

Live `--from-hf` **requires Sepolia/seedbox** (RPC, publisher key, pin target,
and HF). The local e2e suite publishes the tiny-model fixture through
`createPublisher` on an Anvil fork (3 txs) because `publish --from-hf` cannot
run without HF.

## Pinning

| `--pin` | Env | Notes |
|---------|-----|--------|
| `kubo` | `ENSPACK_KUBO_API` | Kubo `block/put?cid-codec=raw&mhtype=sha2-256&pin=true`. Returned CID must equal local `manifestCid`. |
| `seed` | `--seed-node` or `ENSPACK_SEED_NODE` | `POST /v1/pin` (MVP.md §4.2). Same CID check. |
| `pinata` | `PINATA_JWT` | Pinata wraps UnixFS dag-pb; raw CID usually **will not match** — prefer kubo/seed. |

## Version immutability

Subnames are plain ENS Registry records; the owner can always change them.
Clients treat a version name as immutable: `createPublisher` refuses to
repoint a version `contenthash` to a different CID. Model names are mutable
pointers to the latest version. Indexers flag `ContenthashChanged` on a
version name after first set (SPEC §6.2).

## Lockfile (consumers)

```
enspack add <ref> [--select <glob>...] [--json] [--chain]
enspack install [--frozen] [--dir <path>] [--http-only] [--json] [--chain]
enspack update [<ref>] [--json] [--chain]
enspack get <ref> [--save] [--update] ...
```

`enspack.lock` keys are ENS names. `add` appends; a duplicate key is exit 3.
`install` resolves each key and **requires** `resolved.cid === lock.cid`
(exit 3 on mismatch) unless `get --update`. `--frozen` refuses to write the
lockfile and fails if it is missing. `get` rewrites an existing entry, or
creates one only with `--save`.

Proven locally in `test/e2e` (add + install --frozen; mismatch after repointing
the model CID on the Anvil fork).
