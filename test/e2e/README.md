# `@enspack/e2e`

End-to-end suites for WP-13.

| Suite | When it runs | Needs |
|-------|----------------|-------|
| `local-swarm.e2e.test.ts` | `pnpm check` / `pnpm --filter @enspack/e2e test` | Anvil, `aria2c`, built `@enspack/cli` |
| `sepolia.e2e.test.ts` | same command; **skips** unless `SEPOLIA_RPC_URL` and `ENSPACK_PUBLISHER_KEY` are set | Sepolia RPC + publisher key; pin via `ENSPACK_SEED_NODE` or `ENSPACK_KUBO_API` |

```bash
pnpm --filter @enspack/cli build
pnpm --filter @enspack/e2e test
```

Anvil fork tests use `ETH_RPC_URL` or the public fallback in the helpers. Never pass mainnet keys. Sepolia publishing is only under `*.mirrors.enspack.eth` (FLEET.md).
