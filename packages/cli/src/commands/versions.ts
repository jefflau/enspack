import { EnspackError } from "@enspack/core";
import type { Command } from "commander";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, parseChain, rpcUrlFor } from "../opts.js";
import type { CliDeps } from "../types.js";

/** SPEC §3: list `versions[]`, marking the latest (last entry). */
export async function runVersions(
  deps: CliDeps,
  ref: string,
  flags: { json?: boolean; chain?: string },
): Promise<void> {
  const chain = parseChain(flags.chain ?? "mainnet");
  const resolved = await deps.resolverFactory(chain, rpcUrlFor(chain, deps.env)).resolve(ref, {
    chain,
  });
  const manifest = resolved.manifest;
  if (manifest === null) {
    throw new EnspackError("VERIFY", `${resolved.name} has no manifest (no contenthash)`);
  }
  const last = manifest.versions[manifest.versions.length - 1];
  const rows = manifest.versions.map((v) => ({
    version: v.version,
    name: v.name,
    cid: v.cid,
    createdAt: v.createdAt,
    latest: last !== undefined && v === last,
  }));
  if (flags.json === true) {
    writeJson(deps.stdout, { versions: rows });
    return;
  }
  for (const row of rows) {
    const mark = row.latest ? " latest" : "";
    human(deps.stderr, `${row.version} ${row.name} ${row.cid} ${row.createdAt}${mark}`);
  }
}

export function registerVersions(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("versions")
      .description("List manifest.versions[] (SPEC §3)")
      .argument("<ref>", "enspack ref (SPEC §1.3)"),
  ).action(async (ref: string, flags: { json?: boolean; chain?: string }) => {
    await runVersions(deps, ref, flags);
  });
}
