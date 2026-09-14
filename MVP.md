# enspack MVP — execution plan for an agent fleet

Read `SPEC.md` first. It is frozen; if a work package needs a spec change,
stop and file it as an issue tagged `spec-change` instead of improvising.

## 0. MVP definition

Done when all of the following are true on Ethereum mainnet:

1. `enspack get qwen--qwen2-5-7b-instruct.mirrors.enspack.eth` on a clean
   machine with `aria2c` installed downloads, verifies and installs the model
   into the HF cache, and `transformers` loads it offline.
2. `enspack publish --from-hf <org/repo>` performed by a publisher who owns an
   `enspack.eth` subname produces a resolvable version name in ≤ 3 transactions.
3. A Hugging Face user can claim `<user>.enspack.eth` through the registrar
   with no human on our side.
4. A project with an `enspack.lock` reproduces its model set with
   `enspack install`, and refuses if any CID changed.
5. `GET https://index.enspack.dev/v1/names` lists every enspack name on
   mainnet with its latest manifest.
6. ≥ 25 mirrored models under `mirrors.enspack.eth` are seeded and
   downloadable (see `BOOTSTRAP.md`).

Out of scope for MVP: web catalog UI, hybrid v2 torrents, embedded torrent
client, OCI publishing, L2/offchain subnames, paid seeding tiers.

## 1. Repository layout and toolchain

```
enspack/
  SPEC.md  MVP.md  AGENTS.md  BOOTSTRAP.md  README.md
  schema/                     enspack.schema.json, enspack.lock.schema.json
  examples/
  packages/
    core/                     @enspack/core — resolve, manifest, lock, ENS write, IPFS verified fetch
    torrent/                  @enspack/torrent — metainfo create/parse, aria2c adapter, http fallback
    cli/                      enspack + ensget binaries
    hf/                       @enspack/hf — HF tree API, license lookup, Hugging Bay client
  services/
    registrar/                HF-proof → subname issuance (Hono + Postgres + operator wallet)
    seed/                     seed node API + qBittorrent-nox + Kubo (docker compose)
    indexer/                  Ponder app + JSON API
  bootstrap/                  models.yaml + publish runner
  infra/                      docker compose, deploy notes
  test/
    fixtures/                 small model folders for swarm tests
    e2e/                      Sepolia + local-swarm end-to-end
```

- Node 22, pnpm workspaces, TypeScript `strict`, ESM only.
- Build: `tsup`. Test: `vitest`. Lint/format: `biome`. One `pnpm -r check`
  must pass (typecheck + lint + test) before any PR is mergeable.
- Chain: `viem`. ENS extras: `@ensdomains/content-hash` for contenthash
  encode/decode. IPFS: `multiformats`, `@helia/verified-fetch`. Torrents:
  `create-torrent`, `parse-torrent`. Schema validation: `ajv` (2020-12) with
  the JSON files in `schema/` as the single source of truth; export
  TypeScript types generated from the schema (`json-schema-to-typescript`).
- Local chain tests run against an Anvil fork of mainnet
  (`anvil --fork-url $ETH_RPC_URL`) impersonating name owners. E2E runs on
  Sepolia, where `enspack.eth` and `mirrors.enspack.eth` are registered under
  the same operator key structure as mainnet.
- Secrets via env only: `ETH_RPC_URL`, `SEPOLIA_RPC_URL`, `ENSPACK_OPERATOR_KEY`,
  `ENSPACK_PUBLISHER_KEY`, `HF_TOKEN` (optional, read-only), `PINATA_JWT` (optional).

## 2. Shared interfaces (own them in `packages/core`, everyone imports)

```ts
// packages/core/src/types.ts  (generated from schema + hand-written below)
export type Manifest = /* from enspack.schema.json */;
export type Lockfile = /* from enspack.lock.schema.json */;

export interface Resolved {
  name: string;                 // normalized name that was resolved
  node: `0x${string}`;
  cid: string | null;           // from contenthash
  magnet: string | null;        // from com.enspack.magnet
  spec: string | null;          // from com.enspack.spec
  manifest: Manifest | null;    // null when cid is null
  manifestBytes: Uint8Array | null;
}

export interface Resolver {
  resolve(ref: string, opts?: { chain?: "mainnet" | "sepolia" }): Promise<Resolved>;
}

export interface ManifestStore {         // IPFS
  put(bytes: Uint8Array): Promise<string>;              // returns CID (raw codec, sha2-256)
  getVerified(cid: string): Promise<Uint8Array>;        // throws on hash mismatch
}

export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>;  // does §8 of SPEC end to end
}

export interface Downloader {
  fetch(m: Manifest, dest: string, opts: { select?: string[]; httpOnly?: boolean; onProgress?: (p: Progress) => void }): Promise<void>;
}

export interface Verifier {
  verify(m: Manifest, dir: string, select?: string[]): Promise<{ ok: true } | { ok: false; failures: { path: string; reason: "missing" | "size" | "sha256" }[] }>;
}

export interface Installer {
  install(m: Manifest, srcDir: string, target: { kind: "hf-cache"; hfHome?: string } | { kind: "dir"; path: string }): Promise<{ path: string }>;
}
```

Helper functions with fixed names so packages can be built in parallel:
`normalizeLabel`, `mirrorLabel(org, repo)`, `versionLabel(semver)`,
`parseRef(ref) → { name, version? }`, `canonicalJson(obj) → Uint8Array`,
`manifestCid(bytes)`, `validateManifest`, `validateLock`.

Service HTTP contracts are in §4. Freeze them before starting service work.

## 3. Work packages

Each WP lists: deliverable, depends on, acceptance. "Depends on" is about
merge order; development can start in parallel against the interfaces above.

### WP-01 core: schema, types, labels, canonical JSON
- Deliverable: `@enspack/core` with generated types, `ajv` validators,
  label/ref helpers, `canonicalJson`, `manifestCid` (CIDv1, raw, sha2-256).
- Depends on: nothing.
- Acceptance: `examples/*.enspack.json` validate; property tests for
  `normalizeLabel` (idempotent, output passes `viem/ens normalize`);
  `mirrorLabel("Qwen","Qwen2.5-7B-Instruct") === "qwen--qwen2-5-7b-instruct"`;
  `versionLabel("1.0.0-rc.1") === "v1-0-0-rc-1"`; canonical JSON is stable
  across key order.

### WP-02 core: ENS read path
- Deliverable: `Resolver` per SPEC §4 steps 1–6 using viem (`getEnsText`,
  `getEnsResolver` + `readContract contenthash(bytes32)` + content-hash
  decode). Honors CCIP-Read. Rejects refs whose normalization changes them.
- Depends on: WP-01.
- Acceptance: Anvil-fork tests against a name with records set by the test
  (impersonate owner); resolves `name@version`; returns `magnet` fallback when
  no contenthash; fails closed on a name with neither.

### WP-03 core: IPFS verified fetch + pin adapters
- Deliverable: `ManifestStore` with gateway rotation and hash verification
  (`@helia/verified-fetch`), plus `put` adapters: Kubo HTTP API, Pinata, and
  the seed node `/v1/pin` (§4.2). Size cap 1 MiB for manifests, 16 MiB for
  `.torrent` files.
- Depends on: WP-01.
- Acceptance: tampered gateway response (test server) is rejected; CID of
  `put` equals `manifestCid(bytes)`.

### WP-04 core: ENS write path
- Deliverable: `Publisher` on-chain portion per SPEC §8 step 5:
  `setSubnodeRecord` calls and a single `PublicResolver.multicall`. Uses the
  parent's resolver. Dry-run mode prints calldata. Gas estimate before send.
- Depends on: WP-01, WP-02.
- Acceptance: on Anvil fork, publishing a new model = exactly 3 txs, a new
  version = 2; WP-02 resolver reads back the same CID; re-running is
  idempotent (skips existing subnodes).

### WP-05 hf: Hugging Face + Hugging Bay clients
- Deliverable: `@enspack/hf`: `tree(repo, revision)` → files with
  `lfs.oid`/size, `resolveRevision(repo, "main")` → commit sha, `license(repo)`
  from cardData, download of small files for local hashing; Hugging Bay
  `lock(artifactId)` and `resolve(repo)`; `crossCheck(files, hbLock)` that
  aborts on any hash disagreement. `submitFallback(artifactId, magnet, …)`.
- Depends on: WP-01.
- Acceptance: recorded-fixture tests (no network in CI) for
  `Qwen/Qwen2.5-7B-Instruct` reproduce `examples/qwen--qwen2-5-7b-instruct.enspack.json`
  `files[]` exactly.

### WP-06 torrent: metainfo + downloader + verifier
- Deliverable: `@enspack/torrent`: `createTorrent(dir, {webseeds, pieceLength})`
  (v1, `url-list`), `parseTorrent`, `infohash`; `Downloader` using `aria2c`
  (metainfo file preferred, magnet+webseeds fallback, `--select-file` mapping
  from globs, `--` separator, `--bt-stop-timeout`, DHT on); `--http-only`
  multi-source fallback; `Verifier` (streaming SHA-256, size first);
  quarantine on failure.
- Depends on: WP-01.
- Acceptance: local two-process swarm test on `test/fixtures/tiny-model/`
  (no tracker, LAN peer via `--bt-external-ip`/direct peer add) completes and
  verifies; a corrupted file is quarantined with the correct path in the
  error; magnet argv injection test (`--dir=/etc` as "magnet") is rejected
  before spawn.

### WP-07 core: installer + lockfile
- Deliverable: `Installer` (HF cache layout with `refs/main`, `--dir`,
  `--emit-modelfile`), `Lockfile` read/write/validate, `add`/`update` logic,
  CID-mismatch hard error.
- Depends on: WP-01.
- Acceptance: after install, `huggingface_hub.snapshot_download(repo, local_files_only=True)`
  in a Python test returns the snapshot path; lockfile round-trips; mismatch
  test fails with exit code 3.

### WP-08 cli
- Deliverable: `enspack` binary (and `ensget` alias = `enspack get`) with:
  `get <ref> [--dir] [--select] [--http-only] [--allow-unverified] [--emit-modelfile] [--json]`,
  `inspect <ref> [--json]`, `versions <ref>`, `verify <ref> <dir>`,
  `add <ref>`, `install [--frozen]`, `update [<ref>]`,
  `publish --from-hf <org/repo> --publisher <name> --version <semver> [--revision] [--webseed …] [--pin kubo|pinata|seed] [--seed-node URL] [--submit-hb] [--dry-run] [--i-have-redistribution-rights]`,
  `seed <ref> --seed-node URL`. Exit codes: 0 ok, 2 resolution failure,
  3 verification/lock failure, 4 download failure, 5 publish failure.
  Human output to stderr, machine output (`--json`) to stdout.
- Depends on: WP-02..07.
- Acceptance: `enspack get` E2E on Sepolia against a fixture name; every
  command has `--help` and a `--json` snapshot test; license gate refuses a
  non-allowlisted license without the override flag.

### WP-09 service: seed node
- Deliverable: `services/seed` docker compose = `qbittorrent-nox` +
  `ipfs/kubo` + Hono API (§4.2). `POST /v1/seed {name}` resolves the name
  itself (WP-02), validates manifest, checks policy (`allowRoots`, per-publisher
  quota, license allowlist), fetches metainfo (or builds from magnet), adds to
  qBittorrent with webseeds, pins manifest + torrent CIDs. `POST /v1/pin` for
  manifests/torrents only. `GET /v1/status/:infohash`. `GET /v1/health`.
- Depends on: WP-02, WP-03, WP-06.
- Acceptance: compose up on a clean VM; seeding the Sepolia fixture name
  results in a downloading client reaching 100 % with the seed as sole peer;
  `POST /v1/seed` for a name outside `allowRoots` → 403; a name whose manifest
  fails validation → 422.

### WP-10 service: registrar
- Deliverable: `services/registrar` Hono + Postgres implementing SPEC §7 and
  §4.1; operator wallet is an ENS Registry operator (`setApprovalForAll`) for
  the root, funded with a small balance; a minimal static claim page
  (challenge display, wallet signature via injected provider, status).
- Depends on: WP-01, WP-04.
- Acceptance: Sepolia E2E: claim → file in HF repo (test account) → verify →
  `<label>.enspack.eth` owned by the claimant with `com.enspack.hf` set;
  duplicate claim → 409; wrong signature → 401; label collision → 409 +
  review row; attestation JSON retrievable forever.

### WP-11 service: indexer
- Deliverable: Ponder app indexing `TextChanged(key="com.enspack.spec")` and
  `ContenthashChanged` on the public resolvers (mainnet + Sepolia), fetching
  manifests via WP-03, verifying `namehash(manifest.name) == node`, storing
  names/versions/publishers; flags `ContenthashChanged` on a version name
  after first set. JSON API §4.3.
- Depends on: WP-01, WP-03.
- Acceptance: after WP-04 publishes on Sepolia, `/v1/names` shows it within
  one block confirmation + fetch; violation flag test.

### WP-12 bootstrap runner
- Deliverable: `bootstrap/` per `BOOTSTRAP.md`: `models.yaml`, a runner that
  for each entry: license gate → HF tree → cross-check HB → download to the
  seedbox → local re-hash of every file (bootstrap is the one place we hash
  everything) → torrent → pin → publish under `mirrors.enspack.eth` → seed →
  optional HB submission; resumable; writes `bootstrap/state.json`.
- Depends on: WP-05..09.
- Acceptance: dry run over `models.yaml` prints the plan with sizes and gas
  estimate; live run on Sepolia for the first 3 entries.

### WP-13 e2e + docs
- Deliverable: `test/e2e` (Sepolia + local swarm) in CI nightly; README with
  the 60-second quickstart; `docs/publishing.md`, `docs/registrar.md`,
  `docs/seed-node.md`; MCP server thin wrapper exposing `inspect`, `get`,
  `versions` (P1, only if WP-08 lands early).
- Depends on: everything.

Suggested parallel waves: **Wave 1** WP-01, WP-05, WP-06 (independent).
**Wave 2** WP-02, WP-03, WP-07. **Wave 3** WP-04, WP-08, WP-09, WP-11.
**Wave 4** WP-10, WP-12. **Wave 5** WP-13.

## 4. Service HTTP contracts

All JSON. Errors: `{ "error": string, "code": string }` with 4xx/5xx.

### 4.1 Registrar (`https://registrar.enspack.dev`)

```
POST /v1/claims                        { hfNamespace, address }
  201 { claimId, label, challenge, expiresAt, instructions }
POST /v1/claims/:id/verify             { repo, signature }
  200 { label, name, owner, txs: string[], attestationUrl }
  401 bad signature · 404 file not found · 409 taken/collision · 410 expired
GET  /v1/claims/:id                    → status
GET  /v1/publishers/:label             → attestation (public, permanent)
GET  /v1/health
```

### 4.2 Seed node (`https://seed1.enspack.dev`)

```
POST /v1/seed        { name }                    202 { infohash, state }  403 policy  422 invalid manifest
POST /v1/pin         body: bytes, content-type application/json | application/x-bittorrent
                                                 201 { cid }              413 too large  422 invalid
GET  /v1/status/:infohash                        200 { state, progress, peers, uploaded }
GET  /v1/health
```

### 4.3 Indexer (`https://index.enspack.dev`)

```
GET /v1/names?publisher=&q=&cursor=&limit=      { items: [{ model, publisher, latest: { name, version, cid }, upstream, license, totalSize }], nextCursor }
GET /v1/names/:name                              { model, versions: [...], manifest }
GET /v1/publishers                               { items: [{ name, hf, models }] }
GET /v1/violations                               { items: [{ name, node, previousCid, newCid, block }] }
```

## 5. Definition of done (every WP)

- `pnpm -r check` green; no `any` without a comment; no network in unit tests.
- Public functions documented with a one-line JSDoc stating the SPEC section.
- Failure paths tested at least as thoroughly as success paths.
- A `CHANGELOG.md` entry under the package.
- No spec drift: if the code needs the spec to say something it doesn't, open a
  `spec-change` issue and implement behind a flag.
