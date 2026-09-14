# FLEET.md — running the enspack build with Grok Bot + Cursor cloud agents

This is the playbook for the Bots. Each Bot reads this, `MVP.md` and
`AGENTS.md` on first message and saves them to memory.

## Roster (5 Bots)

| Bot        | Owns                                        | Work packages              |
|------------|---------------------------------------------|----------------------------|
| **Ops**    | board, assignment, daily sync, postmortems  | none (coordination only)   |
| **Core**   | `packages/core`                             | WP-01, 02, 03, 04, 07      |
| **Transport** | `packages/hf`, `packages/torrent`, `packages/cli` | WP-05, 06, 08       |
| **Services** | `services/*`                              | WP-09, 10, 11              |
| **Release** | `bootstrap/`, `test/e2e`, docs, seedbox     | WP-12, 13                  |

Domain owners can work across areas but default to their own. Ops is the only
Bot that reassigns work.

## Board

One shared board (Notion database or GitHub Project), one row per WP, columns:
`WP · Owner Bot · Cloud agent URL · Branch · PR · Status · Blockers · Last check`.
Status ∈ `todo · working · ci-failing · needs-human · ready-for-review · merged`.

## How a Bot runs a WP

1. Read the WP entry in `MVP.md §3`. Do not start a WP whose "depends on" is
   not merged unless it can be built purely against the `@enspack/core`
   interfaces in `MVP.md §2`.
2. Launch a Cursor cloud agent on the repo with the prompt template below.
   Branch name `wp-XX-short-name`.
3. Poll the transcript every 15 minutes (5 for P0). If the agent is stalled
   on environment flakiness, unblock it with a follow-up message. If it is
   drifting from the spec, interrupt and correct it.
4. When the PR opens: wait for CI, Bugbot and the acceptance tests listed in
   the WP. Reply to every Bugbot finding: fix or explain.
5. Read the PR's proof (test output, screenshots, Sepolia tx links). Verify
   against the WP acceptance list line by line. Reject if any line lacks
   evidence.
6. Set `ready-for-review`. Low blast radius (no spec, no schema, no on-chain
   writes, no service auth) + green CI + Bugbot clean ⇒ merge. Otherwise wait
   for the human.
7. Report in the shared group chat: WP, PR, what was verified, what is left.

## Cloud agent prompt template

```
Repository: <repo url>. Read AGENTS.md, SPEC.md, and MVP.md before anything.
You are implementing WP-XX (<name>) exactly as specified in MVP.md §3.
Create branch wp-XX-<short-name> from master.

Scope: only the deliverable listed for WP-XX. Import shared types from
@enspack/core (MVP.md §2); do not redefine them. If core lacks something,
stop and report instead of adding it in this branch.

Definition of done: every acceptance bullet for WP-XX in MVP.md has a test
that proves it and passes in `pnpm -r check`. No network in unit tests.
Chain tests use an Anvil mainnet fork with Anvil default accounts.

Proof: in the PR description paste the `pnpm -r check` output, list each
acceptance bullet with the test file:line that covers it, and attach any
Sepolia transaction links. Open the PR as draft if anything is unproven and
say exactly what.

If the spec needs to change to do this, do NOT change SPEC.md or schema/*.
Open an issue labelled spec-change with the exact proposed diff and
implement behind a flag.
```

## Routines

- **Ops, daily 05:00:** 1:1 with every Bot: re-read `AGENTS.md` rules,
  review blockers, re-state what "proof" means. Onboard new Bots.
- **Every Bot, every 30 min:** scan own rows on the board for failing CI,
  Bugbot findings, merge conflicts, stalled agents; act; update `Last check`.
- **Release, nightly 03:00:** run `test/e2e` on Sepolia; run the bootstrap
  dry-run over `models.yaml`; file issues for regressions.
- **Ops, on any mistake:** root-cause with the Bot involved, update this file,
  announce to the group.

## Hard limits (also encode these as Bot allow/block rules in Settings → Agent)

- No mainnet transactions from any Bot or cloud agent. Mainnet publishing is
  human-run from the `bootstrap/` runner.
- Never handle `ENSPACK_OPERATOR_KEY` for mainnet. Sepolia keys only, via
  Cursor Cloud Agent Secrets, never pasted in chat or committed.
- No force-push to `master`, no edits to `SPEC.md`/`schema/*` outside a
  human-approved `spec-change` PR.
- No publishing under any label other than `*.mirrors.enspack.eth` on Sepolia.
- Escalate to the human for: spec changes, anything touching wallets,
  seedbox provisioning, registrar issuance policy, external outreach.

## Waves

1. Core: WP-01 · Transport: WP-05, WP-06 (parallel)
2. Core: WP-02, WP-03, WP-07
3. Core: WP-04 · Transport: WP-08 · Services: WP-09, WP-11
4. Services: WP-10 · Release: WP-12
5. Release: WP-13

Ops opens the next wave for a Bot as soon as that Bot's dependencies are
merged; waves are per-Bot, not global.
