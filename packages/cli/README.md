# @enspack/cli

`enspack` resolves an ENS name to a content-addressed manifest, fetches the
bytes (BitTorrent + HTTP webseeds), verifies every `files[]` SHA-256 locally,
and installs into the Hugging Face hub cache (or `--dir`). `ensget` is an alias
for `enspack get`.

```bash
enspack get qwen--qwen2-5-7b-instruct.mirrors.enspack.eth
ensget qwen--qwen2-5-7b-instruct.mirrors.enspack.eth --http-only --json
```

Human messages go to stderr. `--json` prints a single JSON payload to stdout
and nothing else on stdout.

## Commands

| Command | Purpose |
|---------|---------|
| `get <ref>` | SPEC §4 end to end: resolve, lock-check, download, verify, install |
| `inspect <ref>` | Manifest summary (or full JSON with `--json`) |
| `versions <ref>` | `manifest.versions[]`, latest marked |
| `verify <ref> <dir>` | SHA-256 verify an existing directory |
| `add <ref>` | Resolve and append `enspack.lock` |
| `install` | Reproduce every lock key (SPEC §9) |
| `update [<ref>]` | Re-resolve model names and rewrite lock entries |
| `publish --from-hf …` | SPEC §8 reference flow from a Hugging Face repo |
| `seed <ref> --seed-node URL` | `POST /v1/seed {name}` (MVP.md §4.2) |

Every command has `--help`. `--chain mainnet|sepolia` defaults to mainnet.
`--ens-version v1|v2` (or `ENSPACK_ENS_VERSION`) overrides the chain default:
Sepolia is ENSv2, mainnet is ENSv1. See `docs/ens-v2.md`.

### `get`

```
enspack get <ref> [--dir <path>] [--select <glob>...] [--http-only]
  [--allow-unverified] [--emit-modelfile] [--json] [--chain] [--update] [--save]
```

Default install target is `$HF_HOME/hub/models--{org}--{repo}/` (SPEC §5).
`--dir` copies files flat into that directory.

If `enspack.lock` in the current working directory already has an entry for the
name, a CID mismatch is a hard error (exit 3) unless `--update`. The lockfile
is rewritten only when that entry already exists, or when `--save` is passed
(which creates the file / entry).

Names with no `contenthash` fail closed (exit 3). `--allow-unverified` downloads
via the magnet with torrent-piece verification only and prints a loud warning.

### Sepolia E2E (blocked on secrets in this environment)

Once `SEPOLIA_RPC_URL` is set and a fixture name is published on Sepolia:

```bash
SEPOLIA_RPC_URL=… enspack get tiny-model.enspack.eth --chain sepolia --http-only --json
```

Local acceptance uses an Anvil mainnet fork plus a loopback IPFS gateway and
webseed; see `packages/cli/test/get.e2e.test.ts`.

## Environment

| Variable | Used for |
|----------|----------|
| `ETH_RPC_URL` | Mainnet (and Anvil fork) JSON-RPC |
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC |
| `ENSPACK_ENS_VERSION` | `v1` or `v2`. Overrides `--chain` default (Sepolia → v2, mainnet → v1) |
| `ENSPACK_ENSV2_UNIVERSAL_RESOLVER` | ENSv2 Universal Resolver (default `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`) |
| `ENSPACK_ENSV2_VERIFIABLE_FACTORY` | VerifiableFactory (Sepolia redeploys; override if ENS docs change) |
| `ENSPACK_ENSV2_USER_REGISTRY_IMPL` | UserRegistry implementation |
| `ENSPACK_ENSV2_PERMISSIONED_RESOLVER_IMPL` | PermissionedResolver implementation |
| `ENSPACK_ENSV2_ETH_REGISTRAR` | ETHRegistrar (ROLE_REGISTRAR on ETHRegistry) |
| `ENSPACK_PUBLISHER_KEY` | 32-byte hex private key for `publish` (wired to core `createPublisher`; never logged) |
| `HF_TOKEN` | Optional Hugging Face read token |
| `PINATA_JWT` | `--pin pinata` |
| `ENSPACK_SEED_NODE` | Default seed-node base URL (`--pin seed`, `seed`) |
| `ENSPACK_IPFS_GATEWAYS` | Comma-separated gateway templates (`{cid}`), prepended to core `DEFAULT_GATEWAYS` |
| `ENSPACK_KUBO_API` | Kubo HTTP API base for `--pin kubo` |
| `HF_HOME` | Hugging Face cache root (default `~/.cache/huggingface`) |

RPC URLs and keys are never printed.

## Exit codes

From `@enspack/core` `EXIT_CODES`:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Unexpected error (one-line message on stderr) |
| 2 | Resolution / fetch (`RESOLVE`, `FETCH`) |
| 3 | Verification / lock (`VERIFY`, `LOCK`) |
| 4 | Download (`DOWNLOAD`) |
| 5 | Publish / policy (`PUBLISH`, `POLICY`) |
