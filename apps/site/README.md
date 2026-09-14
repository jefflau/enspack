# @enspack/site

Read-only catalog for enspack names. Someone who has never heard of enspack
should see, on one page, what a name is, what it points at, and that the bytes
verify. The site is a window onto the indexer JSON API (`MVP.md` §4.3). No
wallet, no writes, no keys, no RPC URL in the bundle.

`@enspack/core` is a type-only (dev) dependency. Runtime core is never imported
into the browser bundle (it would pull viem and IPFS).

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_INDEX_URL` | `https://index.enspack.dev` | Indexer base URL |
| `VITE_REGISTRAR_URL` | `https://registrar.enspack.dev` | Registrar base URL (attestations, claim-page link) |
| `VITE_CHAIN` | `sepolia` | `sepolia` \| `mainnet`; drives the testnet banner and explorer / ENS-app links |
| `VITE_DATA_SOURCE` | `http` | `http` \| `demo`; `demo` serves the recorded fixtures in-app |

## Develop

From the repo root:

```sh
pnpm --filter @enspack/site dev
```

Without a live indexer, serve the recorded fixtures:

```sh
VITE_DATA_SOURCE=demo pnpm --filter @enspack/site dev
```

```sh
pnpm --filter @enspack/site build
pnpm --filter @enspack/site preview
```

## Deploy (Cloudflare Pages)

Hosting target is `enspack.dev`. DNS and the Pages project are manual.

| | |
| --- | --- |
| Build command | `pnpm --filter @enspack/site build` |
| Output directory | `apps/site/dist` |
| SPA fallback | `public/_redirects` (`/* /index.html 200`) |

The built bundle contains no keys and no RPC URLs. Chain state arrives only
through the indexer (or demo fixtures).
