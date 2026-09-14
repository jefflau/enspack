import type { Chain } from "./config.js";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "–";
  let v = n;
  let i = 0;
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000;
    i += 1;
  }
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${UNITS[i]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/** `0xabcd…1234` style; keeps the full value available via `title` at the call site. */
export function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** First label of an ENS name: `jeff.enspack.eth` → `jeff`. */
export function firstLabel(name: string): string {
  return name.split(".")[0] ?? name;
}

export function explorerTx(chain: Chain, hash: string): string {
  const host = chain === "mainnet" ? "etherscan.io" : "sepolia.etherscan.io";
  return `https://${host}/tx/${hash}`;
}

export function explorerBlock(chain: Chain, block: number): string {
  const host = chain === "mainnet" ? "etherscan.io" : "sepolia.etherscan.io";
  return `https://${host}/block/${block}`;
}

export function ensAppUrl(chain: Chain, name: string): string {
  const host = chain === "mainnet" ? "app.ens.domains" : "sepolia.app.ens.domains";
  return `https://${host}/${name}`;
}

export function ipfsUrl(cid: string): string {
  return `https://${cid}.ipfs.dweb.link/`;
}

export function hfUrl(namespaceOrRepo: string): string {
  return `https://huggingface.co/${namespaceOrRepo}`;
}

export function isTxHash(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

export function isAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}
