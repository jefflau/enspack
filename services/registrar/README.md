# @enspack/registrar

Hugging Face proof → `enspack.eth` publisher subname (SPEC §7, MVP.md §4.1).

The operator key is an **ENS Registry operator** approved by the root owner (`setApprovalForAll`). It is not the root owner. Keys and RPC URLs come from the environment only and are never written to disk or logs.

## HTTP (MVP.md §4.1)

```
POST /v1/claims                        { hfNamespace, address }
  201 { claimId, label, challenge, expiresAt, instructions }
POST /v1/claims/:id/verify             { repo, signature }
  200 { label, name, owner, txs, attestationUrl }
GET  /v1/claims/:id                     { claimId, label, status, expiresAt, ... }
GET  /v1/publishers/:label              attestation JSON (public, permanent)
GET  /v1/health                         { ok, chain, operator, approved, balanceWei, ensVersion, … }
GET  /
```

Errors are `{ error, code }` with 4xx/5xx.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `INVALID_ADDRESS` | `address` is not checksummed or lowercase 0x |
| 403 | `AUTHOR_MISMATCH` | `repo` author is not the claimed `hfNamespace` |
| 403 | `PRIVATE` | repo is private (or gated-private) |
| 401 | `BAD_SIGNATURE` | EIP-191 `personal_sign` does not recover to `address` |
| 401 | `CHALLENGE_MISMATCH` | `enspack-verify.txt` is not exactly challenge, newline, address, newline |
| 404 | `FILE_NOT_FOUND` | `enspack-verify.txt` missing on `main` |
| 404 | `NOT_FOUND` | unknown claim or publisher label |
| 409 | `TAKEN` | label owned on-chain or already verified |
| 409 | `COLLISION` | a different `hfNamespace` already claimed the same normalized label (`a.b` vs `a-b`); a `reviews` row is inserted |
| 410 | `EXPIRED` | claim older than 24 h |

`label = normalizeLabel(hfNamespace)` (SPEC §1.2). Challenge is `enspack-verify:` plus 32 random bytes hex (SPEC §7).

Repo author mismatch is **403 `AUTHOR_MISMATCH`** (authorization), not 401.

## Env

| Variable | Purpose |
| --- | --- |
| `ENSPACK_OPERATOR_KEY` | Operator private key (`0x` + 64 hex). Never logged. |
| `REGISTRAR_CHAIN` | `mainnet` or `sepolia`. |
| `REGISTRAR_ENS_VERSION` | `v1` or `v2`. Overrides core `ensVersionFor` (default v2 on Sepolia, v1 on mainnet). |
| `ETH_RPC_URL` | Mainnet JSON-RPC (`REGISTRAR_CHAIN=mainnet`). |
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC (`REGISTRAR_CHAIN=sepolia`). |
| `DATABASE_URL` | Postgres URL. Unset → PGlite. |
| `PGLITE_DATA_DIR` | Optional PGlite data directory (unset → in-memory). |
| `PORT` | HTTP port. Default `8787`. |
| `HF_TOKEN` | Optional read-only HF token. |

See `.env.example`.

## Run locally (PGlite)

Postgres and Docker are not required.

```sh
# from the repo root
export ENSPACK_OPERATOR_KEY=0x...   # Anvil account 1 in tests; a funded operator in real use
export REGISTRAR_CHAIN=sepolia
export SEPOLIA_RPC_URL=https://...
export PGLITE_DATA_DIR=./services/registrar/.pglite
pnpm --filter @enspack/registrar build
pnpm --filter @enspack/registrar start
```

Open `http://127.0.0.1:8787/` for the claim page (injected wallet + `personal_sign`).

`GET /v1/health` reports whether the operator is approved and the on-chain balance.

## Deploy with Postgres

Set `DATABASE_URL=postgres://...`. The same `src/schema.sql` is applied on startup (`CREATE TABLE IF NOT EXISTS`). The `pg` driver is production-only; local tests use PGlite.

```sh
docker build -f services/registrar/Dockerfile -t enspack-registrar .
docker run --rm -p 8787:8787 \
  -e ENSPACK_OPERATOR_KEY \
  -e REGISTRAR_CHAIN=mainnet \
  -e ETH_RPC_URL \
  -e DATABASE_URL \
  enspack-registrar
```

## Operator approval (root owner)

The operator must **not** own `enspack.eth`. The root owner grants ERC-721-style operator rights on the ENS Registry:

```sh
# ENS Registry (mainnet and Sepolia)
REG=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e

# from the root owner key — never from ENSPACK_OPERATOR_KEY
cast send $REG "setApprovalForAll(address,bool)" $OPERATOR true \
  --rpc-url $ETH_RPC_URL --private-key $ROOT_OWNER_KEY
```

`isApprovedForAll(rootOwner, operator)` is checked at process start and on `GET /v1/health`. Issuance still goes through:

1. `Registry.setSubnodeRecord(node(enspack.eth), labelhash(label), operator, PublicResolver, 0)`
2. `PublicResolver.multicall([setText(hf), setText(spec)])`
3. `Registry.setOwner(node, claimant)`

PublicResolver is read at runtime from the parent name (`readResolverAddress`), never hardcoded.

## ENSv2 (Sepolia)

Sepolia uses ENSv2 (`ensdomains/contracts-v2`). Set `REGISTRAR_ENS_VERSION=v2` (or leave it unset on Sepolia — core `ensVersionFor` defaults to v2). Issue #17 replaces the three v1 txs with two. The v1 path and its Anvil mainnet-fork test stay intact.

### Required operator roles

The operator is **not** the owner of `enspack.eth`. The name owner grants:

```sh
# On enspack.eth's UserRegistry (R_ROOT = nameStateV2("enspack.eth").subregistry)
cast send $R_ROOT "grantRootRoles(uint256,address)" \
  $(( (1 << 0) | (1 << 16) )) $OPERATOR \
  --rpc-url $SEPOLIA_RPC_URL --private-key $ROOT_OWNER_KEY
# ROLE_REGISTRAR | ROLE_RENEW

# On the project PermissionedResolver (RES = nameStateV2("enspack.eth").resolver)
# dnsEncode("") == 0x00 grants ROOT_RESOURCE (any name), equivalent to grantRootRoles.
cast send $RES "authorizeNameRoles(bytes,uint256,address,bool)" \
  0x00 $(( 1 << 4 )) $OPERATOR true \
  --rpc-url $SEPOLIA_RPC_URL --private-key $ROOT_OWNER_KEY
# ROLE_SET_TEXT
```

`GET /v1/health` reports `ensVersion`, `rootRegistry`, `resolver`, and both flags (`registrarApproved`, `resolverApproved`). `approved` is true only when both are true.

Issuance (SPEC §7 step 5 as amended by [issue #17](https://github.com/jefflau/enspack/issues/17)):

1. `R_ROOT.register(label, claimant, 0x0, RES, NAME_OWNER_ROLES, expiryRoot)` — claimant is the owner immediately.
2. `RES.multicall([setText(com.enspack.hf), setText(com.enspack.spec)])`.

`NAME_OWNER_ROLES` is `SET_SUBREGISTRY | SET_SUBREGISTRY_ADMIN | SET_RESOLVER | SET_RESOLVER_ADMIN | CAN_TRANSFER_ADMIN`. The claimant can later repoint the name to their own resolver (`SET_RESOLVER`) and attach their own UserRegistry (`SET_SUBREGISTRY`) without the registrar.

If `enspack.eth` has no UserRegistry, the service fails closed with `503 ROOT_REGISTRY_MISSING` and tells the operator to run the setup in `docs/ens-v2-sepolia` (On-chain setup Jeff must do on Sepolia).

`expiryRoot` is the root name's expiry. If that is 0, issuance uses now+365 days so the child is not registered with a zero expiry.

### Env (v2)

| Variable | Purpose |
| --- | --- |
| `REGISTRAR_ENS_VERSION` | `v1` or `v2`. Unset → `ensVersionFor(chain)`. |
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC. |
| `ENSPACK_OPERATOR_KEY` | Operator key holding the roles above. |
| Core `ensV2ConfigFor` env | Universal Resolver and factory/implementation addresses (see `@enspack/core`). |

## Sepolia E2E (unproven here)

Needs a real HF account plus a Sepolia operator. Procedure:

1. On Sepolia, own a root name with the same operator structure as mainnet (`enspack.eth`, or a test name). From the **root owner**, `setApprovalForAll(operator, true)` on the ENS Registry. Fund the operator with a small Sepolia ETH balance.
2. Create a **public** Hugging Face model (or dataset/space) under the test account namespace. Private and gated-private repos are rejected.
3. `REGISTRAR_CHAIN=sepolia SEPOLIA_RPC_URL=... ENSPACK_OPERATOR_KEY=...` and start the registrar.
4. `POST /v1/claims` with `{ hfNamespace, address }` where `address` is the claimant wallet (checksummed or lowercase).
5. Commit `enspack-verify.txt` on `main` of `<hfNamespace>/<repo>` containing exactly the challenge, a newline, the address, and a trailing newline.
6. `personal_sign` the challenge with `address`. `POST /v1/claims/:id/verify { repo, signature }`.
7. Expect `200` with three transaction hashes. `owner(namehash("<label>.enspack.eth"))` is the claimant. `text(node, "com.enspack.hf")` equals `hfNamespace`. `text(node, "com.enspack.spec")` equals `enspack/0.1`.
8. Repeat the claim for the same label → `409 TAKEN`. Wrong signature → `401 BAD_SIGNATURE`. A colliding namespace (`a.b` vs `a-b`) → `409 COLLISION` and a `reviews` row.
9. `GET /v1/publishers/<label>` returns the attestation JSON (claim, repo, commit, signature, tx hashes) on repeated calls.

This flow is covered against an Anvil mainnet fork in `test/chain/registrar.anvil.test.ts` with a fake HF. The live Sepolia + real HF account path is not run in CI.
