# enspack/0.1 — Named, verifiable, host-independent distribution of model weights

Status: FROZEN for MVP. Changes require a version bump to `enspack/0.2`.

enspack is a naming and verification layer for model weights. An ENS name
resolves to a content-addressed manifest; the manifest lists every file with
its SHA-256 and describes how to fetch the bytes (BitTorrent with HTTP
webseeds, plus optional OCI / IPFS / Hugging Bay pointers). Verification never
depends on the host that served the bytes.

The spec is root-agnostic. `enspack.eth` is a convenience registry operated by
the enspack project; any ENS name whose owner sets the records below is a valid
enspack name.

---

## 1. Names

### 1.1 Hierarchy

```
<version>.<model>.<publisher>[.<root>]
```

| Level     | Example                                         | Owner          | Mutability                          |
|-----------|-------------------------------------------------|----------------|-------------------------------------|
| publisher | `qwen.enspack.eth`, `qwen.eth`                  | publisher key  | publisher controls all subnames     |
| model     | `qwen2-5-7b-instruct.qwen.enspack.eth`          | publisher key  | MUTABLE pointer to latest version   |
| version   | `v1-0-0.qwen2-5-7b-instruct.qwen.enspack.eth`   | publisher key  | IMMUTABLE by convention (see §6.2)  |

Under `enspack.eth` the publisher label is issued by the registrar (§7) only to
the wallet that proves control of the same-named Hugging Face org or user.

The `mirrors.enspack.eth` publisher namespace is operated by the project for
unverified mirrors of upstream repos (see BOOTSTRAP.md). Model labels under it
use `<org>--<repo>` so the mapping to the upstream repo is obvious:
`qwen--qwen2-5-7b-instruct.mirrors.enspack.eth`.

### 1.2 Label normalization

ENS labels cannot contain `.`; `_` is only legal as a leading character
(ENSIP-15). Every label MUST pass `viem/ens` `normalize()` unchanged.

Given an arbitrary upstream identifier (HF org, repo name, version string):

1. Lowercase.
2. Replace every character outside `[a-z0-9-]` with `-`.
3. Collapse runs of `-` into one `-`.
4. Trim leading and trailing `-`.

Examples: `Qwen2.5-7B-Instruct` → `qwen2-5-7b-instruct`; `Q4_K_M` → `q4-k-m`;
`DeepSeek-R1-Distill-Qwen-7B` → `deepseek-r1-distill-qwen-7b`.

Mirror labels: normalize org and repo separately, join with `--`. The
collapse rule (step 3) is applied per part, never across the join.

Version labels: `v` + semver with `.` → `-`. `1.0.0` → `v1-0-0`,
`1.0.0-rc.1` → `v1-0-0-rc-1`. The manifest carries the exact version string;
the label is only an address, and collisions after normalization are the
publisher's responsibility to avoid.

Human-facing tools MAY display the original identifier from the manifest.

### 1.3 Reference syntax accepted by clients

```
<model-name>              → latest (resolve model name)
<model-name>@<version>    → resolve v<normalized-version>.<model-name>
<version-name>            → resolve as given
```

---

## 2. On-chain records

All records live on the name's ENS resolver. Clients read via standard ENS
resolution (ENSIP-10 wildcard and CCIP-Read MUST be honoured; viem does this by
default), so offchain/L2 subnames work without client changes.

### 2.1 Version names and model names

| Record                | Type        | Required | Value                                                        |
|-----------------------|-------------|----------|--------------------------------------------------------------|
| `contenthash`         | contenthash | yes      | `ipfs://<CIDv1>` of the manifest JSON (raw or dag-pb leaf)    |
| `com.enspack.spec`    | text        | yes      | `enspack/0.1` — discovery beacon for indexers                 |
| `com.enspack.magnet`  | text        | no       | magnet URI; MUST match `distribution.magnet` in the manifest  |

A model name and its latest version name carry the same `contenthash`.

No other on-chain records are part of the spec. Infohash, license, upstream
URL and file hashes live in the manifest, which the CID commits to. Duplicating
them on-chain creates places that can disagree.

### 2.2 Publisher names (optional)

| Record             | Type | Value                                                                 |
|--------------------|------|-----------------------------------------------------------------------|
| `com.enspack.hf`   | text | Hugging Face org/user this publisher proved control of (set by registrar) |
| `com.enspack.spec` | text | `enspack/0.1`                                                         |

### 2.3 Discovery

Indexers subscribe to `TextChanged` events on ENS resolvers where
`key == "com.enspack.spec"` and to `ContenthashChanged` for known nodes. The
name for a node is recovered from the manifest itself (`name` field, §3) and
MUST be checked: `namehash(manifest.name) == event.node`. No label-preimage
service is required.

---

## 3. Manifest (`enspack.json`)

JSON, UTF-8, validated against `schema/enspack.schema.json`. Serialize with
sorted keys and no trailing whitespace before pinning so identical content
yields identical CIDs.

```jsonc
{
  "spec": "enspack/0.1",
  "name": "v1-0-0.qwen--qwen2-5-7b-instruct.mirrors.enspack.eth", // this version's ENS name
  "model": "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth",       // the mutable model name
  "publisher": "mirrors.enspack.eth",
  "version": "1.0.0",
  "createdAt": "2026-09-14T00:00:00Z",
  "displayName": "Qwen2.5-7B-Instruct",
  "license": "apache-2.0",                       // SPDX id, lowercase (HF convention)
  "licenseUrl": "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/blob/main/LICENSE",
  "upstream": {
    "provider": "huggingface",
    "repo": "Qwen/Qwen2.5-7B-Instruct",
    "url": "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct",
    "revision": "a09a35458c702b33eeacc393d103063234e8bc28"      // pinned commit
  },
  "canonical": "qwen2-5-7b-instruct.qwen.enspack.eth",           // optional: publisher-verified name, for mirrors
  "distribution": {
    "infohash": "<40 hex>",                                       // BitTorrent v1 infohash
    "infohashV2": "<64 hex>",                                     // optional
    "magnet": "magnet:?xt=urn:btih:<40 hex>&dn=...",
    "torrent": { "cid": "bafy...", "url": "https://..." },         // metainfo; at least one of cid/url
    "webseeds": [
      "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/resolve/a09a35458c702b33eeacc393d103063234e8bc28/",
      "https://huggingbay.xyz/api/downloads/hf-model-qwen-qwen2-5-7b-instruct/"
    ],
    "seeds": ["seed1.enspack.eth:6881"],                          // optional long-lived peers
    "ipfs": "bafy...",                                            // optional CID of the folder
    "oci": "ghcr.io/enspack/qwen--qwen2-5-7b-instruct@sha256:...", // optional OCI/ModelPack ref
    "hb": "hb://Qwen/Qwen2.5-7B-Instruct@sha256:..."              // optional Hugging Bay identity
  },
  "files": [
    { "path": "config.json", "size": 663, "sha256": "<64 hex>", "role": "config" }
  ],
  "totalSize": 15242807270,
  "versions": [                                                   // full history including this version
    { "version": "1.0.0", "name": "v1-0-0....", "cid": "bafy...", "createdAt": "..." }
  ],
  "previous": "bafy..."                                          // CID of the previous version manifest
}
```

Rules:

- `files[].path` is relative, POSIX separators, no `..`, no leading `/`.
  Paths MUST be unique. The torrent's file tree MUST equal `files[]` exactly
  (same paths, same sizes) under a single top-level directory whose name is
  irrelevant to verification.
- `files[].sha256` is the flat SHA-256 of the file bytes, lowercase hex, no
  prefix. (BitTorrent v2 piece roots are not a substitute.)
- `role` ∈ `weight | config | tokenizer | index | doc | license | code | other`.
- `distribution.magnet` `xt=urn:btih:` MUST equal `distribution.infohash`.
- `webseeds[]` are BEP 19 base URLs ending in `/`. Upstream webseeds MUST pin
  an immutable revision, never `main`.
- `versions[]` is append-only and MUST include the current version as its
  last entry. The model name points at the latest version's manifest, so the
  latest manifest doubles as the version index.
- `x-*` keys are allowed anywhere for extensions and are ignored by clients.

---

## 4. Resolution and download algorithm (client)

Given a reference `R` (§1.3):

1. Normalize `R` to an ENS name `N`. Fail if normalization changes any label.
2. Read `contenthash(N)`. If present, decode to CID `C`.
3. Fetch the manifest for `C` from IPFS with **verified fetch** (bytes MUST be
   re-hashed and compared to `C`; gateways are untrusted). Try gateways in
   order: configured, `https://<cid>.ipfs.dweb.link`, `https://ipfs.io/ipfs/`,
   `https://<cid>.ipfs.w3s.link`.
4. Validate against the schema. Check `namehash(manifest.name) == namehash(N)`
   OR (`N` is a model name and `namehash(manifest.model) == namehash(N)`).
5. If an `enspack.lock` entry exists for `N`, require `C == lock.cid`. Mismatch
   is a hard error unless `--update`.
6. If no `contenthash`: read `com.enspack.magnet`. Without a manifest there are
   no file hashes, so the client MUST fail closed unless `--allow-unverified`
   is passed, in which case only torrent piece verification applies.
7. Acquire bytes. Preferred order:
   a. `.torrent` metainfo (from `distribution.torrent.cid` via verified fetch,
      else `.url`) — contains webseeds, so the swarm works at zero peers.
   b. `distribution.magnet` + `webseeds[]` passed explicitly to the client.
   c. `--http-only`: fetch each file from `webseeds[]` directly (multi-source).
   d. `distribution.oci` / `.ipfs` when the corresponding tool is available.
8. Verify every `files[]` entry: size, then SHA-256. Any mismatch → move the
   download to `<dir>/.enspack-quarantine/<infohash>/`, exit non-zero, print
   which files failed.
9. Install (§5). Update `enspack.lock` when in project mode.

Clients MUST validate `magnet` strings against
`^magnet:\?xt=urn:btih:[0-9a-fA-F]{40}(&|$)` before passing them to any
external process, and MUST pass them after a `--` argument separator.

---

## 5. Install layout

Default target is the Hugging Face hub cache so `transformers` and
`huggingface_hub` find the model with `HF_HUB_OFFLINE=1`:

```
$HF_HOME/hub/models--{org}--{repo}/
  refs/main                      # contains upstream.revision
  snapshots/{upstream.revision}/ # the verified files (real files, not symlinks)
```

`{org}` and `{repo}` come from `upstream.repo`. If `upstream` is absent, use
`enspack--{model-label}`.

Other targets:

- `--dir <path>`: flat copy of the folder.
- `--emit-modelfile`: write an Ollama `Modelfile` (`FROM ./<gguf>`) next to the
  files when exactly one `.gguf` matches `--select`.
- `--select <glob>`: download and verify only matching files (torrent file
  selection). The lockfile records the selection.

The client prints ready-to-run lines for `transformers`, `llama.cpp` and
`ollama create` where applicable. It does not claim more than that.

---

## 6. Trust model

### 6.1 Who is trusted for what

| Claim                                  | Trusted party                              |
|----------------------------------------|--------------------------------------------|
| "this name means this manifest"        | the name's owner key (ENS)                 |
| "this manifest means these bytes"      | nobody — CID and SHA-256 are checked locally |
| "`x.enspack.eth` is really HF org `x`" | the registrar's attestation (§7) + `com.enspack.hf` |
| "`*.mirrors.enspack.eth` matches upstream" | the project, cross-checked against HF LFS hashes and Hugging Bay hashes at publish time |

Hosts (HF, Hugging Bay, seed nodes, IPFS gateways) are never trusted.

### 6.2 Version immutability without NameWrapper

Subnames live in the plain ENS Registry; the owner can always change records
and the parent can always reclaim a child. Immutability is therefore a client
guarantee: the version manifest CID is pinned in `enspack.lock`, and clients
refuse to proceed when a resolved CID differs from the locked one. Publishers
MUST NOT repoint a version name; indexers flag any `ContenthashChanged` on a
version name after its first value as a policy violation.

### 6.3 Registrar reclaim policy

The `enspack.eth` operator reclaims a publisher subname only for (a) lapsed or
fraudulent HF-org proof, or (b) legal compulsion. Every reclaim is an on-chain
`NewOwner` event from the operator address and is surfaced by the indexer.

---

## 7. Registrar (`enspack.eth` publisher namespaces)

Proof of Hugging Face org/user control binds the label to a wallet:

1. `POST /v1/claims {hfNamespace, address}` → `{claimId, challenge, expiresAt}`.
   `challenge = "enspack-verify:" + 32 random bytes hex`.
2. Requester commits a file `enspack-verify.txt` to a **public** repo under
   `hfNamespace`, containing exactly `<challenge>\n<address>\n`.
3. Requester signs `challenge` with `address` (EIP-191 personal_sign).
4. `POST /v1/claims/{claimId}/verify {repo, signature}`. Registrar checks: repo
   author == `hfNamespace` (HF API), file contents match, signature recovers to
   `address`, `normalize(label)` unclaimed.
5. Registrar operator key (an ENS Registry operator approved by the root owner,
   not the root owner itself) executes:
   - `Registry.setSubnodeRecord(node(enspack.eth), labelhash(label), operator, PublicResolver, 0)`
   - `PublicResolver.multicall([setText(node, "com.enspack.hf", hfNamespace), setText(node, "com.enspack.spec", "enspack/0.1")])`
   - `Registry.setOwner(node, address)`
6. `GET /v1/publishers/{label}` returns the attestation (claim, repo, commit,
   signature, tx hashes) permanently.

Label collisions after normalization (e.g. `a.b` vs `a-b`) are first-come and
flagged for manual review. HF users and orgs are both eligible.

---

## 8. Publishing (reference flow)

1. Build `files[]`: for HF upstreams, take `lfs.oid` (SHA-256) and `size` from
   `GET /api/models/{repo}/tree/{revision}?recursive=true`; hash non-LFS files
   locally. Optionally cross-check against Hugging Bay
   `GET /api/artifacts/{id}/lock`. Any disagreement aborts.
2. Create the torrent (v1 required, hybrid v2 optional) with `webseeds[]` as
   `url-list`, 4 MiB pieces for folders > 1 GiB.
3. Pin the `.torrent` → `distribution.torrent.cid`.
4. Assemble the manifest (`versions[]` = previous manifest's list + this one),
   serialize canonically, pin → `C`.
5. On-chain, from the publisher key:
   - first publish of a model: `Registry.setSubnodeRecord(publisherNode, labelhash(model), publisher, resolver, 0)`
   - every version: `Registry.setSubnodeRecord(modelNode, labelhash(vLabel), publisher, resolver, 0)`
   - one `PublicResolver.multicall([...])` covering both nodes:
     `setContenthash(versionNode, C)`, `setText(versionNode, "com.enspack.spec", ...)`,
     `setText(versionNode, "com.enspack.magnet", ...)`, `setContenthash(modelNode, C)`,
     `setText(modelNode, "com.enspack.spec", ...)`.
   That is 3 transactions for a new model and 2 for a new version.
6. Hand the torrent to a seed node (`POST /v1/seed {name}`) and optionally
   submit the magnet to Hugging Bay
   (`POST /api/artifacts/{id}/decentralized-fallbacks`).

The resolver used is the one already set on the publisher name.

---

## 9. Lockfile (`enspack.lock`)

Validated against `schema/enspack.lock.schema.json`.

```json
{
  "lockfileVersion": 1,
  "models": {
    "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth": {
      "resolved": "v1-0-0.qwen--qwen2-5-7b-instruct.mirrors.enspack.eth",
      "cid": "bafy...",
      "infohash": "<40 hex>",
      "totalSize": 15242807270,
      "select": ["*"],
      "upstream": { "repo": "Qwen/Qwen2.5-7B-Instruct", "revision": "a09a35..." }
    }
  }
}
```

`enspack install` reads the lockfile, resolves each key, requires the CID to
match, downloads, verifies, installs. `enspack add <ref>` resolves and appends.
`enspack update [<ref>]` re-resolves model names and rewrites entries.

---

## 10. Interop fields (informative)

- `distribution.oci`: an OCI reference to a CNCF ModelPack or Docker Model
  artifact with the same file set. Clients with `docker model`, `kit`, or
  `oras` MAY use it as a transport; verification still uses `files[]`.
- `distribution.hb`: Hugging Bay immutable identity, resolvable at
  `https://huggingbay.xyz/api/resolve/hb?uri=`.
- Future text records reserved: `com.enspack.bep44` (Silmaril-style DHT key),
  `com.enspack.nostr` (npub for LibreSeed-style discovery).

---

## 11. Non-goals for 0.1

Custom resolver contracts, NameWrapper fuses, token incentives, on-chain file
storage, a new archive format, gated/license-acceptance downloads, private
models, and a browsing UI. Names carrying non-redistributable licenses are the
publisher's liability; the reference tooling refuses to publish them unless
`--i-have-redistribution-rights` is passed.
