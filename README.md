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
