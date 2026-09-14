# Instructions for agents working in this repository

You are one of several agents building enspack in parallel. Read, in order:
`SPEC.md` (protocol, frozen), `MVP.md` (work packages, interfaces, HTTP
contracts), then the package you were assigned.

## Rules

1. **The spec is the contract.** Do not change record keys, manifest fields,
   label rules, CLI exit codes or HTTP contracts. If you need to, open an issue
   labelled `spec-change` with the exact diff and continue behind a feature
   flag. Never edit `SPEC.md` or `schema/*` in a WP branch.
2. **Import interfaces from `@enspack/core`**, never redefine them. If core
   lacks something you need, add it to core in a separate small PR first.
3. **Fail closed.** Anything that cannot be verified (manifest CID, file
   SHA-256, name/node match, lockfile CID) is an error, not a warning.
4. **Never trust a host.** IPFS gateways, HF, Hugging Bay, seed nodes and RPC
   responses are inputs to verification, not sources of truth.
5. **Never pass untrusted strings to a shell.** Use `spawn` with argv arrays,
   validate magnets against the SPEC regex, put `--` before positional args.
6. **No network in unit tests.** Record fixtures under `test/fixtures/`.
   Chain tests use an Anvil mainnet fork. E2E uses Sepolia only.
7. **Keys and RPC URLs come from env.** Never write them to disk or logs.
   Operator/publisher keys in tests are Anvil's default accounts only.
8. **One WP per branch**, named `wp-XX-short-name`. Small PRs. Rebase, don't
   merge, onto `main`.
9. **Definition of done** is in `MVP.md §5`. Do not mark a WP done without the
   acceptance tests listed for it passing in CI.
10. **Comments explain why, not what.** No narration comments, no TODOs
    without an issue number.

## Conventions

- TypeScript strict, ESM, Node 22, pnpm. `pnpm -r check` before pushing.
- Errors are typed: `EnspackError { code: "RESOLVE" | "FETCH" | "VERIFY" | "LOCK" | "DOWNLOAD" | "PUBLISH" | "POLICY"; message; cause? }`.
  CLI maps codes to exit codes per `MVP.md` WP-08.
- Logging: `stderr` for humans, `stdout` only for `--json` payloads.
- Sizes are `number` bytes (safe up to 2^53), hashes are lowercase hex
  strings without prefixes, CIDs are CIDv1 base32 strings.

## Addresses and constants

- ENS Registry (mainnet and Sepolia): `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`
- Public resolver: read from the parent name at runtime; do not hardcode.
- Root name: `enspack.eth`. Mirror namespace: `mirrors.enspack.eth`.
- Text record keys: `com.enspack.spec`, `com.enspack.magnet`, `com.enspack.hf`.
- Spec string: `enspack/0.1`.

## When blocked

Write what you tried, what you observed and what you need in the PR
description, mark the PR draft, and pick up the next unblocked task in your
WP. Do not idle and do not widen scope.
