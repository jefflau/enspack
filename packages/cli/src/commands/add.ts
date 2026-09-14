import { join } from "node:path";
import {
  EnspackError,
  addToLock,
  lockEntryFrom,
  lockKeyFor,
  readLock,
  writeLock,
} from "@enspack/core";
import type { Manifest } from "@enspack/core";
import type { Command } from "commander";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, collect, parseChain, rpcUrlFor, selectOf } from "../opts.js";
import type { CliDeps } from "../types.js";

/** SPEC §9: resolve and append an `enspack.lock` entry. */
export async function runAdd(
  deps: CliDeps,
  ref: string,
  flags: { select?: string[]; json?: boolean; chain?: string },
): Promise<void> {
  const chain = parseChain(flags.chain ?? "mainnet");
  const resolved = await deps.resolverFactory(chain, rpcUrlFor(chain, deps.env)).resolve(ref, {
    chain,
  });
  if (resolved.cid === null || resolved.manifest === null) {
    throw new EnspackError("LOCK", `${resolved.name} has no CID; cannot add to the lockfile`);
  }
  const path = join(deps.cwd, "enspack.lock");
  const lock = await readLock(path);
  const key = lockKeyFor(ref);
  const entry = lockEntryFrom(
    { ...resolved, manifest: resolved.manifest as Manifest, cid: resolved.cid },
    selectOf(flags.select),
  );
  await writeLock(addToLock(lock, key, entry), path);
  if (flags.json === true) {
    writeJson(deps.stdout, { key, ...entry });
    return;
  }
  human(deps.stderr, `added ${key} → ${entry.resolved} cid=${entry.cid}`);
}

export function registerAdd(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("add")
      .description("Resolve a ref and append enspack.lock (SPEC §9)")
      .argument("<ref>", "enspack ref (SPEC §1.3)")
      .option("--select <glob>", "record a file selection in the lock entry (repeatable)", collect),
  ).action(async (ref: string, flags: { select?: string[]; json?: boolean; chain?: string }) => {
    await runAdd(deps, ref, flags);
  });
}
