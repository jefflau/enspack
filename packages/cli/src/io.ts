import { EXIT_CODES, isEnspackError } from "@enspack/core";
import type { Writer } from "./types.js";

const SECRET_KEYS = [
  "ETH_RPC_URL",
  "SEPOLIA_RPC_URL",
  "ENSPACK_PUBLISHER_KEY",
  "ENSPACK_OPERATOR_KEY",
  "HF_TOKEN",
  "PINATA_JWT",
] as const;

/** Never print keys or RPC URLs (AGENTS.md). */
export function redact(text: string, env: NodeJS.ProcessEnv): string {
  let out = text;
  for (const key of SECRET_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "") {
      out = out.split(value).join(`[${key}]`);
    }
  }
  return out;
}

export function human(stderr: Writer, line: string): void {
  stderr.write(line.endsWith("\n") ? line : `${line}\n`);
}

export function writeJson(stdout: Writer, payload: unknown): void {
  stdout.write(`${JSON.stringify(payload, jsonReplacer)}\n`);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return nl === -1 ? text : text.slice(0, nl);
}

/** Map a thrown value to a process exit code (MVP.md WP-08). */
export function exitCodeFor(err: unknown, stderr: Writer, env: NodeJS.ProcessEnv): number {
  if (isEnspackError(err)) {
    human(stderr, redact(err.message, env));
    return EXIT_CODES[err.code];
  }
  const raw = err instanceof Error ? err.message : String(err);
  human(stderr, redact(firstLine(raw), env));
  return 1;
}
