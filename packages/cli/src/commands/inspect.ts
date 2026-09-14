import { EnspackError, ensVersionFor } from "@enspack/core";
import type { Command } from "commander";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, parseChain, rpcUrlFor } from "../opts.js";
import type { CliDeps } from "../types.js";

function formatBytes(n: number): string {
  return String(n);
}

/** SPEC §3: print a manifest summary, or the full document with `--json`. */
export async function runInspect(
  deps: CliDeps,
  ref: string,
  flags: { json?: boolean; chain?: string },
): Promise<void> {
  const chain = parseChain(flags.chain ?? "mainnet");
  const ensVersion = ensVersionFor(chain, deps.env);
  const resolved = await deps.resolverFactory(chain, rpcUrlFor(chain, deps.env)).resolve(ref, {
    chain,
  });
  const manifest = resolved.manifest;
  if (manifest === null) {
    throw new EnspackError("VERIFY", `${resolved.name} has no manifest (no contenthash)`);
  }
  if (flags.json === true) {
    writeJson(deps.stdout, { ...manifest, ensVersion });
    return;
  }
  const lines = [
    `name ${manifest.name}`,
    `model ${manifest.model}`,
    `publisher ${manifest.publisher}`,
    `version ${manifest.version}`,
    `license ${manifest.license}`,
    `upstream ${manifest.upstream !== undefined ? `${manifest.upstream.repo}@${manifest.upstream.revision}` : "-"}`,
    `totalSize ${formatBytes(manifest.totalSize)}`,
    `files ${manifest.files.length}`,
    `infohash ${manifest.distribution.infohash}`,
    `webseeds ${manifest.distribution.webseeds.join(" ")}`,
    `canonical ${manifest.canonical ?? "-"}`,
  ];
  for (const line of lines) {
    human(deps.stderr, line);
  }
}

export function registerInspect(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("inspect")
      .description("Print a manifest summary (SPEC §3)")
      .argument("<ref>", "enspack ref (SPEC §1.3)"),
  ).action(async (ref: string, flags: { json?: boolean; chain?: string }) => {
    await runInspect(deps, ref, flags);
  });
}
