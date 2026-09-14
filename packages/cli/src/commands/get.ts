import type { Command } from "commander";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, collect, parseChain, selectOf } from "../opts.js";
import { type PipelineOptions, runPipeline } from "../pipeline.js";
import type { CliDeps } from "../types.js";

export interface GetFlags {
  dir?: string;
  select?: string[];
  httpOnly?: boolean;
  allowUnverified?: boolean;
  emitModelfile?: boolean;
  json?: boolean;
  chain?: string;
  update?: boolean;
  save?: boolean;
}

/** SPEC §4: `enspack get` (and `ensget`). */
export async function runGet(deps: CliDeps, ref: string, flags: GetFlags): Promise<void> {
  const opts: PipelineOptions = {
    ref,
    chain: parseChain(flags.chain ?? "mainnet"),
  };
  if (flags.dir !== undefined) opts.dir = flags.dir;
  const select = selectOf(flags.select);
  if (select !== undefined) opts.select = select;
  if (flags.httpOnly === true) opts.httpOnly = true;
  if (flags.allowUnverified === true) opts.allowUnverified = true;
  if (flags.emitModelfile === true) opts.emitModelfile = true;
  if (flags.update === true) opts.update = true;
  if (flags.save === true) opts.save = true;
  const result = await runPipeline(deps, opts);
  if (flags.json === true) {
    writeJson(deps.stdout, {
      name: result.name,
      node: result.node,
      cid: result.cid,
      infohash: result.infohash,
      installedPath: result.installedPath,
      files: result.files,
      totalSize: result.totalSize,
      verified: result.verified,
    });
    return;
  }
  human(
    deps.stderr,
    `installed ${result.name} → ${result.installedPath} files=${result.files} verified=${result.verified}`,
  );
}

export function registerGet(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("get")
      .description("Resolve, download, verify and install a model (SPEC §4)")
      .argument("<ref>", "enspack ref (SPEC §1.3)")
      .option("--dir <path>", "install to a flat directory (SPEC §5)")
      .option("--select <glob>", "download and verify only matching files (repeatable)", collect)
      .option("--http-only", "fetch files from webseeds[] over HTTP (SPEC §4 step 7c)")
      .option("--allow-unverified", "download via magnet when the name has no contenthash")
      .option("--emit-modelfile", "write an Ollama Modelfile next to a single .gguf")
      .option("--update", "accept a lockfile CID change (otherwise exit 3)")
      .option("--save", "write/create an enspack.lock entry for this ref"),
  ).action(async (ref: string, flags: GetFlags) => {
    await runGet(deps, ref, flags);
  });
}
