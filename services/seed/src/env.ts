import { type EnspackChainName, LICENSE_ALLOWLIST } from "@enspack/core";

const TWO_TIB = 2 * 1024 * 1024 * 1024 * 1024;

export interface SeedEnv {
  port: number;
  qbtUrl: string;
  qbtUser: string;
  qbtPass: string;
  kuboApi: string;
  ethRpcUrl: string | undefined;
  sepoliaRpcUrl: string | undefined;
  chain: EnspackChainName;
  allowRoots: string[];
  quotaBytesPerPublisher: number;
  licenseAllowlist: readonly string[];
  downloadDir: string;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new Error(`missing required env ${name}`);
  }
  return value;
}

function parseChain(value: string | undefined): EnspackChainName {
  if (value === undefined || value === "" || value === "sepolia") return "sepolia";
  if (value === "mainnet") return "mainnet";
  throw new Error(`ENSPACK_CHAIN must be "mainnet" or "sepolia"`);
}

function parseAllowRoots(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return ["enspack.eth"];
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseLicenseAllowlist(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === "") {
    return LICENSE_ALLOWLIST;
  }
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function parseQuota(value: string | undefined): number {
  if (value === undefined || value === "") return TWO_TIB;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("SEED_QUOTA_BYTES_PER_PUBLISHER must be a non-negative number");
  }
  return n;
}

/**
 * MVP.md WP-09: load seed-node env. RPC URLs and qBittorrent credentials never go to disk or logs.
 */
export function loadSeedEnv(env: NodeJS.ProcessEnv = process.env): SeedEnv {
  const chain = parseChain(env.ENSPACK_CHAIN);
  const ethRpcUrl = env.ETH_RPC_URL === "" ? undefined : env.ETH_RPC_URL;
  const sepoliaRpcUrl = env.SEPOLIA_RPC_URL === "" ? undefined : env.SEPOLIA_RPC_URL;
  return {
    port: Number(env.PORT ?? "8080"),
    qbtUrl: required("QBT_URL", env.QBT_URL),
    qbtUser: required("QBT_USER", env.QBT_USER),
    qbtPass: required("QBT_PASS", env.QBT_PASS),
    kuboApi: required("KUBO_API", env.KUBO_API),
    ethRpcUrl,
    sepoliaRpcUrl,
    chain,
    allowRoots: parseAllowRoots(env.SEED_ALLOW_ROOTS),
    quotaBytesPerPublisher: parseQuota(env.SEED_QUOTA_BYTES_PER_PUBLISHER),
    licenseAllowlist: parseLicenseAllowlist(env.SEED_LICENSE_ALLOWLIST),
    downloadDir:
      env.SEED_DOWNLOAD_DIR === undefined || env.SEED_DOWNLOAD_DIR === ""
        ? "/downloads"
        : env.SEED_DOWNLOAD_DIR,
  };
}

export function rpcUrlFor(env: SeedEnv): string {
  const url = env.chain === "sepolia" ? env.sepoliaRpcUrl : env.ethRpcUrl;
  return required(env.chain === "sepolia" ? "SEPOLIA_RPC_URL" : "ETH_RPC_URL", url);
}
