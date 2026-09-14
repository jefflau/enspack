import { EnspackError } from "@enspack/core";
import type { Command } from "commander";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, collect, parseChain, rpcUrlFor, selectOf } from "../opts.js";
import type { CliDeps } from "../types.js";

/** SPEC §4 step 8: verify `files[]` in an existing directory. */
export async function runVerify(
  deps: CliDeps,
  ref: string,
  dir: string,
  flags: { select?: string[]; json?: boolean; chain?: string },
): Promise<void> {
  const chain = parseChain(flags.chain ?? "mainnet");
  const resolved = await deps.resolverFactory(chain, rpcUrlFor(chain, deps.env)).resolve(ref, {
    chain,
  });
  const manifest = resolved.manifest;
  if (manifest === null) {
    throw new EnspackError("VERIFY", `${resolved.name} has no manifest (no contenthash)`);
  }
  const select = selectOf(flags.select);
  const result = await deps.verifier.verify(manifest, dir, select);
  if (!result.ok) {
    for (const f of result.failures) {
      human(deps.stderr, `${f.path}: ${f.reason}`);
    }
    if (flags.json === true) {
      writeJson(deps.stdout, result);
    }
    throw new EnspackError(
      "VERIFY",
      `verification failed (${result.failures.map((f) => f.path).join(", ")})`,
    );
  }
  if (flags.json === true) {
    writeJson(deps.stdout, { ok: true });
    return;
  }
  human(deps.stderr, `verified ${manifest.name} in ${dir}`);
}

export function registerVerify(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("verify")
      .description("Verify files[] SHA-256 in a directory (SPEC §4 step 8)")
      .argument("<ref>", "enspack ref (SPEC §1.3)")
      .argument("<dir>", "directory that already contains the files")
      .option("--select <glob>", "verify only matching files (repeatable)", collect),
  ).action(
    async (
      ref: string,
      dir: string,
      flags: { select?: string[]; json?: boolean; chain?: string },
    ) => {
      await runVerify(deps, ref, dir, flags);
    },
  );
}
