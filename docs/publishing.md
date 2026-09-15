# Publishing

SPEC §8 reference flow, as implemented by `enspack publish` (`packages/cli/src/commands/publish.ts`).

```
enspack publish --from-hf <org/repo> --publisher <name> --version <semver>
  [--revision <sha>] [--webseed <url>...] [--pin kubo|pinata|seed]
  [--seed-node <url>] [--submit-hb] [--dry-run]
  [--i-have-redistribution-rights] [--json] [--chain mainnet|sepolia]
  [--ens-version v1|v2]
```

`--help` snapshot is in `packages/cli/test/__snapshots__/help.test.ts.snap` and is
re-run against the built binary in `test/e2e/test/help-and-workflow.test.ts`.
`--chain sepolia` selects ENSv2 (issue #17 / `docs/ens-v2.md`). `--ens-version`
and `ENSPACK_ENS_VERSION` override. Mainnet stays v1.

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
   step 5). **Mainnet (v1):**
   - first publish of a model: `Registry.setSubnodeRecord` for the model label
   - every version: `Registry.setSubnodeRecord` for `v<semver-with-dots-as-dashes>`
   - one `PublicResolver.multicall` writing `contenthash` + `com.enspack.spec`
     (+ magnet text on the version node) on **both** version and model nodes
   That is **3 transactions for a new model and 2 for a new version**.
   **Sepolia (v2):** deploy a model UserRegistry, `register` the model with it,
   `register` the version, one PermissionedResolver `multicall` — **4 txs new
   model, 2 new version**, plus first-time publisher `setup:` deploys. Re-runs
   are idempotent. The resolver is read from the publisher name at runtime; it
   is not hardcoded. `publish` prints `setup:` lines and the expected tx count;
   `--json` includes `ensVersion` and `setup`. Run `enspack ens-setup` first
   for `enspack.eth` / `mirrors.enspack.eth` so publish has no `setup:` deploys
   (`docs/ens-v2.md`).
6. If `ENSPACK_SEED_NODE` / `--seed-node` is set (and not dry-run),
   `POST /v1/seed { name }` is attempted (failures are logged, not fatal).
   `--submit-hb` POSTs the magnet to Hugging Bay.

`--dry-run` still talks to HF to build `files[]`, then prints the canonical
manifest, CID, and calldata/gas on stderr (`formatPublishPlan`). No pins, no
txs.

### `versions[].cid` (issue #30)

A manifest cannot contain its own CID: writing the CID changes the bytes.
`enspack publish` (and bootstrap `assembleManifest`) put the schema-valid
placeholder `SELF_CID_PLACEHOLDER` (`bafkrei` + 52×`a`) on the **last**
`versions[]` entry. Previous entries keep real CIDs (the previous tail is
stamped with the on-chain CID of that version). Clients take the current
version's CID from `contenthash`. `enspack versions --json` adds
`latestCidFromContenthash`. Human `inspect` / `versions` mark the latest
entry as `(this manifest — see contenthash)`.

`enspack get --http-only` skips torrent metainfo (`distribution.torrent.cid`)
and fetches files from `webseeds[]` with SHA-256 verification (SPEC §4 step
7c). Without `--http-only`, metainfo is still fetched and checked.

Publisher names under `mirrors.enspack.eth` use `<org>--<repo>` labels and set
`canonical` to `<repo>.<org>.enspack.eth`. Agents must not publish on Sepolia
under any label other than `*.mirrors.enspack.eth` (FLEET.md).

Live `--from-hf` **requires Sepolia/seedbox** (RPC, publisher key, pin target,
and HF). The local e2e suite publishes the tiny-model fixture through
`createPublisher({ ensVersion: "v2" })` on an Anvil **Sepolia** fork (4 txs)
because `publish --from-hf` cannot run without HF (covered in
`packages/cli` unit tests with a fake HF + fake v2 publisher). The mainnet v1
swarm suite (`test/e2e/test/local-swarm.e2e.test.ts`) is unchanged (3 txs).

## Pinning

| `--pin` | Env | Notes |
|---------|-----|--------|
| `kubo` | `ENSPACK_KUBO_API` | Kubo `block/put?cid-codec=raw&mhtype=sha2-256&pin=true`. Returned CID must equal local `manifestCid`. |
| `seed` | `--seed-node` or `ENSPACK_SEED_NODE` | `POST /v1/pin` (MVP.md §4.2). Same CID check. |
| `pinata` | `PINATA_JWT` | Pinata wraps UnixFS dag-pb; raw CID usually **will not match** — prefer kubo/seed. |

## Version immutability

Subnames are records the owner can always change. Clients treat a version
name as immutable: `createPublisher` refuses to repoint a version
`contenthash` to a different CID. Model names are mutable pointers to the
latest version. On ENSv2 the version name itself cannot be rewritten, so a
repoint is a **new version** (for example `1.1.0`) that moves the model
pointer. Indexers flag `ContenthashChanged` on a version name after first set
(SPEC §6.2).

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
