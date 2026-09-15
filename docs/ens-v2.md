# ENSv2 on Sepolia (issue #17)

SPEC.md stays frozen at ENSv1 (`Registry.setSubnodeRecord`, 3/2 publish txs).
Sepolia's live path is ENSv2 (`ensdomains/contracts-v2`) behind
`ENSPACK_ENS_VERSION=v1|v2` (default **v2 on Sepolia**, **v1 on mainnet**).
Record keys, manifest, lockfile and the resolution algorithm are unchanged:
`contenthash`, `com.enspack.spec`, `com.enspack.magnet`, `com.enspack.hf`.

See [spec-change #17](https://github.com/jefflau/enspack/issues/17).

## What changed vs SPEC

| ENSv1 (SPEC.md / mainnet) | ENSv2 (Sepolia) |
|---|---|
| One ENS Registry, `owner(node)` | Per-name registries: subnames live in a `UserRegistry` proxy the parent points at via `setSubregistry` |
| `setSubnodeRecord(parent, labelhash, owner, resolver, 0)` | `Registry(parent).register(label, owner, subregistry, resolver, roleBitmap, expiry)`; caller needs `ROLE_REGISTRAR` |
| `setApprovalForAll(operator)` | `grantRootRoles(ROLE_REGISTRAR \| ROLE_RENEW, operator)` on the UserRegistry |
| PublicResolver, auth = registry owner | `PermissionedResolver` proxy per publisher (`ROLE_SET_TEXT` / `ROLE_SET_CONTENTHASH`). `PublicResolverV2` only authorises NameWrapper names, so it is unusable for fresh v2 subnames |
| Resolver discovery: `Registry.resolver(node)` | `UniversalResolverV2.findResolver(dnsName)`; registry discovery `findExactRegistry`, `ROOT_REGISTRY()` |
| New model = 3 txs, new version = 2 | New model = **4** txs (deploy model UserRegistry, register model with it, register version, resolver multicall); new version = **2** |
| Registrar issuance = 3 txs | **2** txs (`register` with claimant as owner, resolver multicall) |

Version names are still immutable from the client's point of view. ENSv2
cannot repoint an existing version `contenthash`; move the **model** pointer by
publishing a new version (for example `1.1.0`).

## Flag and env

| Surface | How |
|---------|-----|
| CLI / bootstrap | `--chain sepolia` → v2; `--ens-version v1\|v2` overrides; `ENSPACK_ENS_VERSION` |
| Seed | `ENSPACK_CHAIN` + `ENSPACK_ENS_VERSION` |
| Indexer | `ensVersionFor(network)` at config time |
| Registrar | `REGISTRAR_ENS_VERSION` (else `ensVersionFor`) |

`--ens-version` / `ENSPACK_ENS_VERSION` win over the chain default. Mainnet v2
fails closed (`ENSv2 is not deployed on mainnet`).

### Discovery anchor

The only configured discovery address is a `UniversalResolverV2`; everything
else is read at runtime: `ROOT_REGISTRY()` → `getSubregistry("eth")` → ETHRegistry
→ … The default is the `UniversalResolverV2` of one specific Sepolia deployment
(`0x4a1817d13e9cf196f471725176355c1234b63c70`, root `0x8115…4354`), **not** the
public `UpgradableUniversalResolverProxy` `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`:
ENS repoints that proxy between Sepolia redeploys (observed twice on 2026-09-14/15),
which moves `ROOT_REGISTRY` and orphans every name registered on the previous
stack — including `enspack.eth`. Pinning keeps discovery, the implementation
addresses and the ETHRegistrar (used by fork tests) mutually consistent. Set
`ENSPACK_ENSV2_UNIVERSAL_RESOLVER` to the proxy to follow ENS, and update all
five overrides together when moving to a new deployment. Names on a pinned
deployment resolve through enspack tooling and services; the ENS app only shows
whatever deployment the proxy currently points at.

### Deployment-specific overrides

| Env | Default (docs.ens.domains Sepolia table) |
|-----|-------------------------------------------|
| `ENSPACK_ENSV2_UNIVERSAL_RESOLVER` | `0x4a1817d13e9cf196f471725176355c1234b63c70` (deployment's UniversalResolverV2; proxy `0xeEeE…EeEe` follows ENS) |
| `ENSPACK_ENSV2_VERIFIABLE_FACTORY` | `0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef` |
| `ENSPACK_ENSV2_USER_REGISTRY_IMPL` | `0x624a25d67b59d587752ebec8dded8827dae52050` |
| `ENSPACK_ENSV2_PERMISSIONED_RESOLVER_IMPL` | `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` |
| `ENSPACK_ENSV2_ETH_REGISTRAR` | `0xa88553f454b77203b0d036a05c894d555eaaa2cc` |

## Transaction counts

| Flow | v1 | v2 |
|------|----|----|
| New model | 3 | **4** (+ first-time publisher `setup:` deploys) |
| New version | 2 | **2** |
| Idempotent re-run | 0 | **0** |
| Registrar issuance | 3 | **2** |

`enspack publish` prints `setup:` lines from `PublishResultV2.setup` /
`formatPublishPlan` and the expected tx count. `--json` includes `ensVersion`
and `setup`.

## On-chain setup (once, Sepolia)

Requires Node 22+ (`node --version`). If `enspack.eth` was registered from a wallet other than
the hot key, either transfer the name (ERC-1155 `safeTransferFrom` on the ETHRegistry) or, from
the owner, delegate the two roles `ens-setup` needs on the name itself — no deployment involved:

```
ETHRegistry.grantRoles(labelId("enspack"), ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER, <hot key>)
```

(`(1<<20) | (1<<24)` = `17825792`). `ens-setup` then runs signed by the hot key; the proxies it
deploys are initialised with the hot key as admin and `mirrors.enspack.eth` is registered to it.

Owner and signer = the hot wallet that registered `enspack.eth`. Optional
`--operator` is a second address (registrar + bootstrap) granted
`ROLE_REGISTRAR | ROLE_RENEW` on the UserRegistries and resolver record
roles. If you omit it, the signer already holds those roles from
`initialize`.

Signer key: `ENSPACK_OPERATOR_KEY`, falling back to `ENSPACK_PUBLISHER_KEY`.
RPC: `SEPOLIA_RPC_URL`. Keys and RPC URLs are never logged.

1. Register `enspack.eth` in the [Sepolia ENS app](https://sepolia.app.ens.domains/)
   with this hot wallet.

2. Dry-run the plan (prints `skip:` for already-satisfied steps; sends nothing):

   ```
   enspack ens-setup --chain sepolia --name enspack.eth --subname mirrors --dry-run
   ```

3. Send the transactions:

   ```
   enspack ens-setup --chain sepolia --name enspack.eth --subname mirrors
   ```

   Add `--operator 0x…` when the registrar/bootstrap key is not the signer.
   `--json` prints `{ name, resolver, registry, subnames, operator, txs, skipped }`
   to stdout. Exit 0 on success, 5 if the name is not owned (`register
   enspack.eth first (ENS Sepolia app) with this wallet`) or the chain is
   ENSv1, 2 on RPC/resolve failure. Re-runs are idempotent (0 txs).

4. Secrets to set (operator env / GitHub):

   | Variable | Value |
   |----------|--------|
   | `SEPOLIA_RPC_URL` | Sepolia JSON-RPC |
   | `ENSPACK_OPERATOR_KEY` | hot key (ens-setup signer; registrar + bootstrap) |
   | `ENSPACK_PUBLISHER_KEY` | same key for `publish` under `mirrors.enspack.eth`, or a dedicated publisher |

After this, `enspack publish --publisher mirrors.enspack.eth` is 4 txs for a
new model (no `setup:` deploys). `enspack.eth` is **not registered on
Sepolia** until step 1 is done.

## Appendix: manual calls

The same flow as `enspack ens-setup`, written out as contract calls. Prefer
the command. Role bitmaps live in `@enspack/core` (`REGISTRY_ROLES`,
`RESOLVER_ROLES`, `USER_REGISTRY_ROOT_ROLES`, `RESOLVER_ADMIN_ROLES`,
`NAME_OWNER_ROLES`). Admin variant of a role is `role << 128`.

1. Register `enspack.eth` on Sepolia ENSv2 (ENS app, or `ETHRegistrar`
   commit/reveal with the deployment's mock USDC). Owner = the hot wallet `O`.

2. Deploy the project resolver:

   ```
   VerifiableFactory.deployProxy(
     PermissionedResolverImpl,
     salt,
     initialize(O, RESOLVER_ADMIN_ROLES, [])
   ) → RESOLVER
   ```

   `RESOLVER_ADMIN_ROLES` =
   `ROLE_SET_TEXT | ROLE_SET_TEXT_ADMIN | ROLE_SET_CONTENTHASH | ROLE_SET_CONTENTHASH_ADMIN | ROLE_SET_ADDR | ROLE_SET_ADDR_ADMIN | ROLE_UPGRADE | ROLE_UPGRADE_ADMIN`
   (`(1<<4) | (1<<132) | (1<<8) | (1<<136) | (1<<0) | (1<<128) | (1<<124) | (1<<252)`).

   Set it on the name:

   ```
   ETHRegistry.setResolver(labelId("enspack"), RESOLVER)
   ```

   `labelId(label) = uint256(keccak256(bytes(label)))`.

3. Deploy the root UserRegistry:

   ```
   VerifiableFactory.deployProxy(
     UserRegistryImpl,
     salt,
     initialize(O, USER_REGISTRY_ROOT_ROLES)
   ) → R_ROOT
   ETHRegistry.setSubregistry(labelId("enspack"), R_ROOT)
   ```

   optionally `R_ROOT.setParent(ETHRegistry, "enspack")`.

   `USER_REGISTRY_ROOT_ROLES` =
   `ROLE_REGISTRAR | ROLE_REGISTRAR_ADMIN | ROLE_RENEW | ROLE_RENEW_ADMIN | ROLE_SET_PARENT | ROLE_SET_PARENT_ADMIN | ROLE_SET_SUBREGISTRY | ROLE_SET_SUBREGISTRY_ADMIN | ROLE_SET_RESOLVER | ROLE_SET_RESOLVER_ADMIN | ROLE_UPGRADE | ROLE_UPGRADE_ADMIN`.

4. Grant the hot operator `OP` on `R_ROOT` and `RESOLVER` (only when `OP` ≠ `O`):

   ```
   R_ROOT.grantRootRoles(ROLE_REGISTRAR | ROLE_RENEW, OP)
   # ROLE_REGISTRAR = 1<<0, ROLE_RENEW = 1<<16

   RESOLVER.authorizeNameRoles(dnsEncode(""), ROLE_SET_TEXT | ROLE_SET_CONTENTHASH, OP, true)
   # dnsEncode("") == 0x00 is ROOT_RESOURCE (any name)
   # ROLE_SET_TEXT = 1<<4, ROLE_SET_CONTENTHASH = 1<<8
   ```

5. `mirrors.enspack.eth`:

   ```
   R_ROOT.register(
     "mirrors",
     O,
     0x0,
     RESOLVER,
     NAME_OWNER_ROLES,
     expiry(enspack.eth)
   )
   ```

   then deploy a UserRegistry for mirrors and `R_ROOT.setSubregistry(labelId("mirrors"), R_MIRRORS)`.
   If `--operator` is set, `R_MIRRORS.grantRootRoles(ROLE_REGISTRAR | ROLE_RENEW, OP)`.

6. Fund `O` with Sepolia ETH. Put the secrets from step 4 in operator env.
   Never write keys to disk or logs.

`enspack publish` v2 still performs first-time publisher deploys when a
publisher name has no UserRegistry / writable resolver. After `ens-setup`,
`mirrors.enspack.eth` needs none of that.


## Indexer

On Sepolia the contracts to index are per-publisher PermissionedResolver
proxies. Config-time discovery: `findResolverV2(enspack.eth)` and
`findResolverV2(mirrors.enspack.eth)` (skip zero), union
`ENSPACK_INDEXER_RESOLVERS_SEPOLIA`. Mainnet stays v1
`readResolverAddress(enspack.eth)`.

`TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value)`
and `ContenthashChanged(bytes32 indexed node, bytes hash)` match the v1
PublicResolver — PermissionedResolver inherits `ITextResolver` /
`IContentHashResolver` ([contracts-v2 indexing docs](https://github.com/ensdomains/contracts-v2/blob/main/docs/indexing-ensv2-events.md)).
The TextChanged handler already reads `contenthash` from `event.log.address`.

New publishers' resolvers are added via the env list. A future
`ResolverUpdated` subscription is **out of scope**.
