import { access } from "node:fs/promises";
import { join } from "node:path";
import { EnspackError, readLock } from "@enspack/core";
import type { Command } from "commander";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, parseChain } from "../opts.js";
import { runPipeline } from "../pipeline.js";
import type { CliDeps, GetJson } from "../types.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** SPEC §9: install every lock key, asserting CID match. */
export async function runInstall(
  deps: CliDeps,
  flags: {
    frozen?: boolean;
    dir?: string;
    httpOnly?: boolean;
    json?: boolean;
    chain?: string;
  },
): Promise<void> {
  const chain = parseChain(flags.chain ?? "mainnet");
  const path = join(deps.cwd, "enspack.lock");
  if (flags.frozen === true && !(await fileExists(path))) {
    throw new EnspackError("LOCK", "enspack.lock is missing (--frozen)");
  }
  const lock = await readLock(path);
  const keys = Object.keys(lock.models);
  if (keys.length === 0) {
    throw new EnspackError("LOCK", "enspack.lock has no models");
  }
  const installed: GetJson[] = [];
  for (const key of keys) {
    const entry = lock.models[key];
    if (entry === undefined) {
      if (flags.frozen === true) {
        throw new EnspackError("LOCK", `lock key ${key} is missing`);
      }
      continue;
    }
    const result = await runPipeline(deps, {
      ref: key,
      chain,
      lockKey: key,
      writeLock: flags.frozen !== true,
      frozen: flags.frozen === true,
      ...(entry.select !== undefined ? { select: entry.select } : {}),
      ...(flags.dir !== undefined ? { dir: flags.dir } : {}),
      ...(flags.httpOnly === true ? { httpOnly: true } : {}),
    });
    installed.push({
      name: result.name,
      node: result.node,
      cid: result.cid,
      infohash: result.infohash,
      installedPath: result.installedPath,
      files: result.files,
      totalSize: result.totalSize,
      verified: result.verified,
    });
  }
  if (flags.json === true) {
    writeJson(deps.stdout, { installed });
    return;
  }
  human(deps.stderr, `installed ${installed.length} model(s)`);
}

export function registerInstall(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("install")
      .description("Install every enspack.lock entry (SPEC §9)")
      .option("--frozen", "refuse to write the lockfile; fail if it is missing")
      .option("--dir <path>", "install to a flat directory (SPEC §5)")
      .option("--http-only", "fetch files from webseeds[] over HTTP"),
  ).action(
    async (flags: {
      frozen?: boolean;
      dir?: string;
      httpOnly?: boolean;
      json?: boolean;
      chain?: string;
    }) => {
      await runInstall(deps, flags);
    },
  );
}
