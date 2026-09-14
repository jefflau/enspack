# Bootstrapping enspack with content and users

A registry with no names is a spec. This document covers how the project
seeds the first models, who they are published as, what it costs, and how we
get the first publishers and consumers.

## 1. Principle: mirror honestly, reserve the real names

We publish mirrors of redistributable upstream repos under a namespace that
says what it is: `mirrors.enspack.eth`. Model labels are `<org>--<repo>` so
the upstream is obvious, and every mirror manifest carries
`canonical: <model>.<org>.enspack.eth`, the name the real publisher will own
once they claim `<org>.enspack.eth` through the registrar.

We never publish under a lab's or quantizer's label. `qwen.enspack.eth` is
reserved for whoever proves control of `huggingface.co/Qwen`; until then it
does not exist. When they claim it, `enspack get` on the mirror name prints
"a publisher-verified name exists: …" and the mirror keeps working.

## 2. Selection criteria (enforced by the bootstrap runner, not by judgment)

A repo is eligible only if all of these hold at publish time:

1. Not gated on HF (`gated == false`) and public.
2. `cardData.license` ∈ `{apache-2.0, mit, bsd-3-clause, bsd-2-clause, cc0-1.0, cc-by-4.0, odc-by}` — the same allowlist Hugging Bay uses for mirroring.
   Missing license ⇒ ineligible, regardless of the base model's license.
3. Every LFS file has an `lfs.oid` from the HF tree API, and where Hugging Bay
   has a `lock` for the artifact, every hash agrees. Any disagreement stops
   the whole run for that repo.
4. Snapshot size at the pinned revision fits the current seedbox budget.

Excluded on purpose: Gemma (gemma license, gated), Llama (llama license,
gated), any repo whose license field is empty (e.g. several third-party GGUF
repos), and all third-party quantizer repos even when licensed — those are
the people we want as publishers, not as mirror targets. Official first-party
GGUF repos (e.g. `Qwen/Qwen3-8B-GGUF`) are eligible.

## 3. Initial list (`bootstrap/models.yaml`)

Verified against the HF API on 2026-09-14 (license, gating, current
revision). `usedStorage` from HF counts all revisions and formats, so the
numbers in the yaml are upper bounds; the runner computes exact snapshot sizes
from the tree at the pinned revision.

- **Tier 1 (launch, 16 repos, ≈ 220 GB estimated snapshot; 351 GB HF storage upper bound):** the highest-demand models
  that fit on consumer hardware, one official GGUF repo for each family users
  actually run locally, three embedding models, Whisper. Includes
  `openai/gpt-oss-20b` (apache-2.0).
- **Tier 2 (≈ 700 GB):** 14B–32B dense models, MoE, Phi-4, Mistral Nemo/Small,
  OLMo, SmolLM2, e5.
- **Tier 3 (after a second seedbox):** `openai/gpt-oss-120b`, large official
  GGUF collections.

Tier 1 is the MVP acceptance target (≥ 25 names counts model names plus
version names; 16 repos yields 32).

## 4. Infrastructure

- **Seedbox:** one dedicated server, unmetered 1 Gbit, 4 TB storage, running
  the WP-09 compose stack (qBittorrent-nox, Kubo, seed API). This holds Tier 1
  and Tier 2 with headroom. A second box in another region is Tier 3's
  prerequisite and also gives redundancy; until then, HF and Hugging Bay
  webseeds are the second source.
- **IPFS pins:** manifests and `.torrent` files only (kilobytes). Pinned on
  the seedbox Kubo and on one commercial pinning service so manifests survive
  a seedbox outage.
- **Wallets:** `enspack.eth` owner in cold storage. A hot *operator* key is
  approved via `Registry.setApprovalForAll` and used by the registrar and the
  bootstrap runner; it holds only enough ETH for expected transactions.
  `mirrors.enspack.eth` is owned by the operator key.
- **Gas:** each mirror = 3 transactions on first publish (model subnode,
  version subnode, resolver multicall). Roughly 0.4 M gas per model
  including record writes; Tier 1 is on the order of 6–7 M gas total. Confirm
  against the Sepolia dry run before mainnet.

## 5. Runner behaviour (WP-12)

For each entry, resumable, state in `bootstrap/state.json`:

1. Gate: fetch model info; check §2 conditions; record revision.
2. Build `files[]` from the tree API; cross-check with Hugging Bay `lock`.
3. Download the snapshot to the seedbox (`huggingface_hub` or aria2c from
   `resolve/<revision>/`).
4. Re-hash every file locally and require equality with step 2. Bootstrap is
   the one place we hash everything ourselves, because these manifests are
   what every later consumer trusts.
5. Create the torrent with webseeds `[HF resolve/<revision>/, HB downloads/<id>/ if hosted]`.
6. Pin `.torrent` and manifest; publish under `mirrors.enspack.eth` with
   `version: 1.0.0`, `canonical` set.
7. `POST /v1/seed {name}` on the seedbox; confirm 100 % seeding.
8. Optional: `POST /api/artifacts/{id}/decentralized-fallbacks` on Hugging Bay
   with `displayName: "enspack: <name>"` so their users become peers.
9. `enspack get <name>` from a *different* machine must succeed before the
   entry is marked done.

Re-runs skip done entries. A new upstream revision is a new enspack version
(`1.1.0`), never an overwrite.

## 6. Getting the first publishers

The mirrors exist to make the tool useful on day one, not to be the content
strategy. The content strategy is publishers.

1. **Quantizers first.** unsloth, bartowski and mradermacher publish daily,
   their repos are hundreds of GB where multi-source download and selective
   file fetch matter, and their users run models locally. Approach each with:
   their namespace already reserved for them, a working `enspack publish
   --from-hf` against one of their repos on Sepolia, and an offer to seed
   their first ten releases on our box. Ask for one thing: run `enspack
   publish` as part of their release flow.
2. **Labs second**, with the argument that their namespace is protected
   whether or not they use it, and that a signed name under their control is
   a better citation target than a mutable HF URL.
3. **Hugging Bay** as a distribution partner, not a platform: submit magnets
   through their fallback endpoint and file one feature request for an `ens`
   field on artifacts and peer fallbacks.

## 7. Getting the first consumers

- `enspack.lock` in starter repos that already pin models (local RAG
  templates, agent frameworks' example projects, eval harnesses). A PR adding
  a lockfile and `enspack install` to a README is low-friction and shows the
  reproducibility story.
- An MCP server wrapping `inspect` / `get` / `versions` so agents can fetch
  by name. Hugging Bay and unmuzzle both target agents; we should be at least
  as easy to call.
- One public demo: a 40-node cluster pulling the same model through the swarm
  in the time HF takes to serve it once. This is the demo that sells the
  transport to anyone running GPUs.
- ENS ecosystem: enspack is a concrete non-wallet use of ENS with content
  hashes; ENS DAO small grants and the ENS builders' channels are a natural
  first audience and a possible source of funding for the seedbox.

## 8. What we do not do to bootstrap

No republishing of gated or non-redistributable weights, no scraping of
private repos, no publishing under names that imply publisher endorsement,
no token or points program for seeders. If a mirrored upstream is taken down
for a license reason, the mirror is repointed to a manifest with an empty
`files[]` and a `x-withdrawn` reason, and the indexer marks it.
