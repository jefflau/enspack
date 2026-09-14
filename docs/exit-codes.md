# Exit codes

From `@enspack/core` `EXIT_CODES` (`packages/core/src/error.ts`). The CLI maps
every `EnspackError.code` through `exitCodeFor` (`packages/cli/src/io.ts`).
Unexpected throws are exit 1. Commander usage errors are exit 1.

| Exit | `EnspackError.code` | Meaning |
|------|---------------------|---------|
| 0 | — | Success (`--help` included) |
| 1 | — | Unexpected error (one-line message on stderr) |
| 2 | `RESOLVE`, `FETCH` | Name resolution or verified-fetch failure |
| 3 | `VERIFY`, `LOCK` | SHA-256 / schema / lockfile CID mismatch |
| 4 | `DOWNLOAD` | aria2c / HTTP download failure |
| 5 | `PUBLISH`, `POLICY` | On-chain publish, pin, license gate, seed-node 403/422 |

`--json` payloads go to stdout only. Human text (including errors) goes to
stderr. RPC URLs and keys are redacted.

Proven in `packages/cli/test/exit-codes.test.ts` and the local e2e lock-mismatch
case (exit 3).
