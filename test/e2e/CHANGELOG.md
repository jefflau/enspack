# @enspack/e2e

## 0.1.0

- WP-17: Sepolia-fork ENSv2 suite (`sepolia-fork.e2e.test.ts`) in `pnpm check`.
  Real Sepolia suite expects v2 tx counts and `ensVersion: "v2"`. Mainnet v1
  `local-swarm.e2e.test.ts` unchanged.
- WP-13: local Anvil-fork swarm suite (`local-swarm.e2e.test.ts`) in `pnpm check`.
- WP-13: Sepolia suite (`sepolia.e2e.test.ts`) self-skips without secrets; nightly workflow at 03:00 UTC.
