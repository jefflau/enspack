import { EnspackError } from "@enspack/core";
import type { Command } from "commander";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, parseChain, rpcUrlFor } from "../opts.js";
import type { CliDeps } from "../types.js";

interface SeedErrorBody {
  error?: unknown;
  code?: unknown;
}

/** MVP.md §4.2: `POST /v1/seed {name}` → `{infohash, state}`. 403/422 is exit 5. */
export async function runSeed(
  deps: CliDeps,
  ref: string,
  flags: { seedNode: string; json?: boolean; chain?: string },
): Promise<void> {
  const chain = parseChain(flags.chain ?? "mainnet");
  const resolved = await deps.resolverFactory(chain, rpcUrlFor(chain, deps.env)).resolve(ref, {
    chain,
  });
  const base = flags.seedNode.replace(/\/+$/, "");
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${base}/v1/seed`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ name: resolved.name }),
    });
  } catch (cause) {
    throw new EnspackError("PUBLISH", "seed-node request failed", cause);
  }
  if (res.status === 403 || res.status === 422) {
    let body: SeedErrorBody = {};
    try {
      body = (await res.json()) as SeedErrorBody;
    } catch {
      body = {};
    }
    const error = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    const code = typeof body.code === "string" ? body.code : String(res.status);
    throw new EnspackError("PUBLISH", `${error} (${code})`);
  }
  if (res.status !== 202 && res.status !== 200) {
    throw new EnspackError("PUBLISH", `seed node HTTP ${res.status}`);
  }
  const json = (await res.json()) as { infohash?: unknown; state?: unknown };
  const infohash = typeof json.infohash === "string" ? json.infohash : "";
  const state = typeof json.state === "string" ? json.state : "";
  const payload = { infohash, state };
  if (flags.json === true) {
    writeJson(deps.stdout, payload);
    return;
  }
  human(deps.stderr, `seeded ${infohash} state=${state}`);
}

export function registerSeed(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("seed")
      .description("Ask a seed node to fetch and seed a name (MVP.md §4.2)")
      .argument("<ref>", "enspack ref (SPEC §1.3)")
      .requiredOption("--seed-node <url>", "seed node base URL"),
  ).action(async (ref: string, flags: { seedNode: string; json?: boolean; chain?: string }) => {
    await runSeed(deps, ref, flags);
  });
}
