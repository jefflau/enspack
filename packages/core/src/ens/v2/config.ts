import { getAddress, isAddress } from "viem";
import { EnspackError } from "../../error.js";
import type { EnspackChainName } from "../client.js";

/** Feature flag for the ENSv1 vs ENSv2 read/write path (issue #17). */
export type EnsVersion = "v1" | "v2";

/** Sepolia ENSv2 deployment addresses; overridable because ENS redeploys periodically (issue #17). */
export interface EnsV2Config {
  universalResolver: `0x${string}`;
  verifiableFactory: `0x${string}`;
  userRegistryImpl: `0x${string}`;
  permissionedResolverImpl: `0x${string}`;
  ethRegistrar: `0x${string}`;
}

const SEPOLIA_DEFAULTS = {
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
  verifiableFactory: "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef",
  userRegistryImpl: "0x624a25d67b59d587752ebec8dded8827dae52050",
  permissionedResolverImpl: "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e",
  ethRegistrar: "0xa88553f454b77203b0d036a05c894d555eaaa2cc",
} as const;

const ENV_KEYS = {
  universalResolver: "ENSPACK_ENSV2_UNIVERSAL_RESOLVER",
  verifiableFactory: "ENSPACK_ENSV2_VERIFIABLE_FACTORY",
  userRegistryImpl: "ENSPACK_ENSV2_USER_REGISTRY_IMPL",
  permissionedResolverImpl: "ENSPACK_ENSV2_PERMISSIONED_RESOLVER_IMPL",
  ethRegistrar: "ENSPACK_ENSV2_ETH_REGISTRAR",
} as const;

type EnvLike = Record<string, string | undefined>;

function parseAddress(value: string, envName: string): `0x${string}` {
  if (!isAddress(value)) {
    throw new EnspackError("RESOLVE", `${envName} is not a valid address`);
  }
  return getAddress(value);
}

function addressFrom(env: EnvLike, envName: string, fallback: string): `0x${string}` {
  const raw = env[envName];
  if (raw === undefined || raw === "") {
    return parseAddress(fallback, envName);
  }
  return parseAddress(raw, envName);
}

/** Sepolia ENSv2 config from defaults + env; mainnet has no v2 deployment (issue #17). */
export function ensV2ConfigFor(chain: EnspackChainName, env: EnvLike = process.env): EnsV2Config {
  if (chain === "mainnet") {
    throw new EnspackError("RESOLVE", "ENSv2 is not deployed on mainnet");
  }
  return {
    universalResolver: addressFrom(
      env,
      ENV_KEYS.universalResolver,
      SEPOLIA_DEFAULTS.universalResolver,
    ),
    verifiableFactory: addressFrom(
      env,
      ENV_KEYS.verifiableFactory,
      SEPOLIA_DEFAULTS.verifiableFactory,
    ),
    userRegistryImpl: addressFrom(
      env,
      ENV_KEYS.userRegistryImpl,
      SEPOLIA_DEFAULTS.userRegistryImpl,
    ),
    permissionedResolverImpl: addressFrom(
      env,
      ENV_KEYS.permissionedResolverImpl,
      SEPOLIA_DEFAULTS.permissionedResolverImpl,
    ),
    ethRegistrar: addressFrom(env, ENV_KEYS.ethRegistrar, SEPOLIA_DEFAULTS.ethRegistrar),
  };
}

/** `ENSPACK_ENS_VERSION` override, else Sepolia → v2 and mainnet → v1 (issue #17). */
export function ensVersionFor(chain: EnspackChainName, env: EnvLike = process.env): EnsVersion {
  const override = env.ENSPACK_ENS_VERSION;
  if (override === "v1" || override === "v2") {
    return override;
  }
  if (override !== undefined && override !== "") {
    throw new EnspackError("RESOLVE", "ENSPACK_ENS_VERSION must be v1 or v2");
  }
  return chain === "sepolia" ? "v2" : "v1";
}
