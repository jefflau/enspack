export type Chain = "mainnet" | "sepolia";
export type DataSource = "http" | "demo";

export interface SiteConfig {
  indexUrl: string;
  registrarUrl: string;
  chain: Chain;
  dataSource: DataSource;
  repoUrl: string;
}

function stripSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

/** Reads Vite env once. Only public URLs and the chain name; never keys or RPC URLs. */
export function readConfig(env: ImportMetaEnv = import.meta.env): SiteConfig {
  const chain: Chain = env.VITE_CHAIN === "mainnet" ? "mainnet" : "sepolia";
  const dataSource: DataSource = env.VITE_DATA_SOURCE === "demo" ? "demo" : "http";
  return {
    indexUrl: stripSlash(env.VITE_INDEX_URL ?? "https://index.enspack.dev"),
    registrarUrl: stripSlash(env.VITE_REGISTRAR_URL ?? "https://registrar.enspack.dev"),
    chain,
    dataSource,
    repoUrl: "https://github.com/jefflau/enspack",
  };
}

export const config: SiteConfig = readConfig();

/** react-router wants the base path without a trailing slash; Vite's BASE_URL always has one. */
export function routerBasename(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
