import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const infraRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Read a file under `infra/` as utf8. */
export function readInfra(rel: string): string {
  return readFileSync(join(infraRoot, rel), "utf8");
}

/** Compose `${VAR}` / `${VAR:-default}` names in document order. */
export function interpolateVars(raw: string): string[] {
  const names = new Set<string>();
  for (const m of raw.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) {
    const name = m[1];
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

/** KEY= lines from .env.example, ignoring comments. */
export function envExampleKeys(raw: string): Set<string> {
  const keys = new Set<string>();
  for (const line of raw.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m?.[1] !== undefined) keys.add(m[1]);
  }
  return keys;
}

/** Parse `.env.example` into a map (empty values stay empty strings). */
export function parseEnvExample(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1] === undefined) continue;
    env[m[1]] = m[2] ?? "";
  }
  return env;
}

/** Substitute `${VAR}` and `${VAR:-default}` the way Compose does for `config`. */
export function interpolateCompose(raw: string, env: Record<string, string>): string {
  return raw.replace(
    /\$\{([A-Z][A-Z0-9_]*)(:-([^}]*))?\}/g,
    (_all, name: string, _d, def?: string) => {
      const value = env[name];
      if (value !== undefined && value !== "") return value;
      return def ?? "";
    },
  );
}

export type ComposeService = {
  restart?: unknown;
  healthcheck?: { test?: unknown };
  ports?: unknown;
  profiles?: unknown;
  environment?: Record<string, unknown>;
};

/** Host ports published by a compose service (short or long syntax). */
export function publishedHostPorts(service: unknown): number[] {
  if (typeof service !== "object" || service === null) return [];
  const ports = (service as { ports?: unknown }).ports;
  if (!Array.isArray(ports)) return [];
  const out: number[] = [];
  for (const p of ports) {
    if (typeof p === "string") {
      const noProto = p.replace(/\/(tcp|udp)$/i, "");
      const parts = noProto.split(":");
      if (parts.length === 2 && parts[0] !== undefined) {
        out.push(Number(parts[0]));
      } else if (parts.length === 3 && parts[1] !== undefined) {
        out.push(Number(parts[1]));
      }
    } else if (typeof p === "object" && p !== null && "published" in p) {
      const published = (p as { published?: unknown }).published;
      if (typeof published === "number" || typeof published === "string") {
        out.push(Number(published));
      }
    }
  }
  return out.filter((n) => Number.isInteger(n));
}

/** Host ports that must stay on the compose network (API / WebUI / app HTTP). */
export const INTERNAL_ONLY_HOST_PORTS = [5001, 8080, 8081, 8787, 42069] as const;

/** Private-key shape that must never appear in compose or Caddyfile. */
export const KEY_RE = /0x[0-9a-fA-F]{64}/;
/** Hugging Face / GitHub / OpenAI token prefixes that must never be baked in. */
export const TOKEN_RE = /\b(?:ghp_|github_pat_|hf_|sk-)[A-Za-z0-9]+/;
