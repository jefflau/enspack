import type { EnspackChainName } from "@enspack/core";
import { EnspackError } from "@enspack/core";
import type { Progress } from "@enspack/core";
import type { Command } from "commander";
import type { Writer } from "./types.js";

/** Repeatable `--select` / `--webseed` collector (commander). */
export function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export function addGlobalOpts(cmd: Command): Command {
  return cmd
    .option("--json", "print machine-readable JSON to stdout (nothing else on stdout)")
    .option("--chain <chain>", "ENS chain: mainnet or sepolia", "mainnet")
    .option(
      "--ens-version <version>",
      "ENS version: v1 or v2 (default: v2 on sepolia, v1 on mainnet)",
    );
}

/** SPEC / AGENTS.md: `--chain mainnet|sepolia`. */
export function parseChain(value: string): EnspackChainName {
  if (value === "mainnet" || value === "sepolia") {
    return value;
  }
  throw new EnspackError("RESOLVE", `invalid --chain ${value} (expected mainnet|sepolia)`);
}

export function rpcUrlFor(chain: EnspackChainName, env: NodeJS.ProcessEnv): string {
  if (chain === "sepolia") {
    const url = env.SEPOLIA_RPC_URL;
    if (url !== undefined && url !== "") {
      return url;
    }
    throw new EnspackError("RESOLVE", "SEPOLIA_RPC_URL is not set");
  }
  const url = env.ETH_RPC_URL;
  if (url !== undefined && url !== "") {
    return url;
  }
  throw new EnspackError("RESOLVE", "ETH_RPC_URL is not set");
}

export function selectOf(select: string[] | undefined): string[] | undefined {
  if (select === undefined || select.length === 0) {
    return undefined;
  }
  return select;
}

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

export function formatBytes(n: number): string {
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  const unit = UNITS[i] ?? "B";
  if (i === 0) {
    return `${n}${unit}`;
  }
  return `${v.toFixed(1)}${unit}`;
}

/**
 * SPEC §4 step 7: progress on stderr, throttled, no ANSI when stderr is not a TTY.
 */
export function createProgressWriter(stderr: Writer, intervalMs = 500): (p: Progress) => void {
  let last = 0;
  let lastLen = 0;
  const tty = stderr.isTTY === true;
  return (p) => {
    const now = Date.now();
    const done = p.bytesTotal > 0 && p.bytesDone >= p.bytesTotal;
    if (!done && now - last < intervalMs) {
      return;
    }
    last = now;
    const speed = p.speed !== undefined ? ` ${formatBytes(p.speed)}/s` : "";
    const line = `${p.phase} ${formatBytes(p.bytesDone)}/${formatBytes(p.bytesTotal)}${speed}`;
    if (tty) {
      const pad = lastLen > line.length ? " ".repeat(lastLen - line.length) : "";
      stderr.write(`\r${line}${pad}`);
      lastLen = line.length;
      if (done) {
        stderr.write("\n");
        lastLen = 0;
      }
    } else {
      stderr.write(`${line}\n`);
    }
  };
}
