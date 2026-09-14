import { join } from "node:path";
import {
  EnspackError,
  lockEntryFrom,
  lockKeyFor,
  readLock,
  updateLock,
  writeLock,
} from "@enspack/core";
import type { Manifest } from "@enspack/core";
import type { Command } from "commander";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, parseChain, rpcUrlFor } from "../opts.js";
import type { CliDeps } from "../types.js";

/** SPEC §9: re-resolve model names and rewrite lock entries. */
export async function runUpdate(
  deps: CliDeps,
  ref: string | undefined,
  flags: { json?: boolean; chain?: string },
): Promise<void> {
  const chain = parseChain(flags.chain ?? "mainnet");
  const path = join(deps.cwd, "enspack.lock");
  const lock = await readLock(path);
  const keys = ref !== undefined ? [lockKeyFor(ref)] : Object.keys(lock.models);
  if (keys.length === 0) {
    throw new EnspackError("LOCK", "enspack.lock has no models");
  }
  let next = lock;
  const updated: { key: string; cid: string; resolved: string }[] = [];
  const resolver = deps.resolverFactory(chain, rpcUrlFor(chain, deps.env));
  for (const key of keys) {
    if (next.models[key] === undefined && ref !== undefined) {
      throw new EnspackError("LOCK", `${key} is not in the lockfile; run enspack add`);
    }
    const resolved = await resolver.resolve(key, { chain });
    if (resolved.cid === null || resolved.manifest === null) {
      throw new EnspackError("LOCK", `${resolved.name} has no CID; cannot update the lockfile`);
    }
    const prev = next.models[key];
    const entry = lockEntryFrom(
      { ...resolved, manifest: resolved.manifest as Manifest, cid: resolved.cid },
      prev?.select,
    );
    next = updateLock(next, key, entry);
    updated.push({ key, cid: entry.cid, resolved: entry.resolved });
  }
  await writeLock(next, path);
  if (flags.json === true) {
    writeJson(deps.stdout, { updated });
    return;
  }
  for (const row of updated) {
    human(deps.stderr, `updated ${row.key} → ${row.resolved} cid=${row.cid}`);
  }
}

export function registerUpdate(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("update")
      .description("Re-resolve lockfile model names (SPEC §9)")
      .argument("[ref]", "limit the update to one lock key"),
  ).action(async (ref: string | undefined, flags: { json?: boolean; chain?: string }) => {
    await runUpdate(deps, ref, flags);
  });
}
