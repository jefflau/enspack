# Registrar

SPEC §7 / MVP.md §4.1. Implementation: `services/registrar`. Default listen
port `8787` (`PORT`). Operator key is an ENS Registry operator approved by the
root owner (`setApprovalForAll`), not the root owner.

Live issuance **requires Sepolia/mainnet** (`ENSPACK_OPERATOR_KEY`,
`REGISTRAR_CHAIN`, `ETH_RPC_URL` / `SEPOLIA_RPC_URL`). Local tests use PGlite
+ an Anvil fork with a fake HF.

## HTTP

Errors: `{ "error": string, "code": string }`.

```
POST /v1/claims                        { "hfNamespace": "<org-or-user>", "address": "0x..." }
  201 { claimId, label, challenge, expiresAt, instructions }

POST /v1/claims/:id/verify             { "repo": "<hfNamespace>/<name>", "signature": "0x..." }
  200 { label, name, owner, txs, attestationUrl }
  401 BAD_SIGNATURE / CHALLENGE_MISMATCH
  403 AUTHOR_MISMATCH / PRIVATE
  404 FILE_NOT_FOUND / NOT_FOUND
  409 TAKEN / COLLISION
  410 EXPIRED

GET  /v1/claims/:id                    { claimId, label, status, expiresAt, ... }
GET  /v1/publishers/:label             attestation JSON (public, permanent)
GET  /v1/health                        { ok, chain, operator, approved, balanceWei }
GET  /
```

`address` must be checksummed or lowercase `0x`. `label = normalizeLabel(hfNamespace)`
(SPEC §1.2). Challenge is `enspack-verify:` plus 32 random bytes hex. Claims
expire after 24 h.

## `enspack-verify.txt`

Commit this file to a **public** Hugging Face repo under `hfNamespace`
(model, dataset, or space). Contents are exactly:

```
<challenge>
<address>
```

that is `` `${challenge}\n${address}\n` `` — challenge, newline, address, newline.
Then EIP-191 `personal_sign` the challenge with `address`.

Example (values from `POST /v1/claims`):

```bash
# requires a running registrar — Sepolia/mainnet
curl -sS -X POST http://127.0.0.1:8787/v1/claims \
  -H 'content-type: application/json' \
  -d '{"hfNamespace":"example","address":"0x..."}'

# after committing enspack-verify.txt and signing:
curl -sS -X POST http://127.0.0.1:8787/v1/claims/<claimId>/verify \
  -H 'content-type: application/json' \
  -d '{"repo":"example/enspack-verify","signature":"0x..."}'
```

## Operator approval

From the **root owner** key, never from `ENSPACK_OPERATOR_KEY`:

```bash
# requires the root-owner key on Sepolia/mainnet
REG=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
cast send $REG "setApprovalForAll(address,bool)" $OPERATOR true \
  --rpc-url $ETH_RPC_URL --private-key $ROOT_OWNER_KEY
```

Issuance then:

1. `Registry.setSubnodeRecord(node(enspack.eth), labelhash(label), operator, PublicResolver, 0)`
2. `PublicResolver.multicall([setText(hf), setText(spec)])`
3. `Registry.setOwner(node, claimant)`

PublicResolver is discovered from the parent name at runtime.

## Collision review

Label collisions after normalization (`a.b` vs `a-b`) are first-come:
`409 COLLISION` and a `reviews` row. A label already owned or verified is
`409 TAKEN`. Duplicate verify of the same claim is not re-issued.
