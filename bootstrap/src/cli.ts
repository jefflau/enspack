#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES, isEnspackError } from "@enspack/core";
import { HELP, parseCli } from "./cli-args.js";
import type { BootstrapDeps } from "./deps.js";
import { assertChainAllowed, isInteractive } from "./guard.js";
import { planBootstrap } from "./plan.js";
import { createProductionDeps } from "./production.js";
import { runBootstrap } from "./run.js";
import { parseModelsYaml, selectModels } from "./yaml.js";

export interface CliIo {
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
}

export interface RunCliOpts {
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  deps?: BootstrapDeps;
  modelsPath?: string;
  statePath?: string;
  io?: CliIo;
}

function packageRoot(): string {
  return fileURLToPath(new URL("..", import.meta.url));
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`;
}

/**
 * BOOTSTRAP.md §5: `enspack-bootstrap plan|run` entry. Human text on stderr, `--json` on stdout.
 */
export async function runCli(argv: string[], opts: RunCliOpts = {}): Promise<number> {
  let env = opts.env ?? process.env;
  const io = opts.io ?? { stdout: process.stdout, stderr: process.stderr };
  try {
    const parsed = parseCli(argv);
    if (parsed.help) {
      io.stderr.write(`${HELP}\n`);
      return 0;
    }
    if (parsed.command === "run") {
      assertChainAllowed(parsed.chain, env, opts.interactive ?? isInteractive());
    }
    if (parsed.ensVersion !== undefined) {
      env = { ...env, ENSPACK_ENS_VERSION: parsed.ensVersion };
    }

    const root = packageRoot();
    const modelsPath = opts.modelsPath ?? join(root, "models.yaml");
    const config = parseModelsYaml(await readFile(modelsPath, "utf8"));
    const select: { tier: number; only?: string[]; limit?: number } = {
      tier: parsed.tier,
      only: parsed.only,
    };
    if (parsed.limit !== undefined) select.limit = parsed.limit;
    const entries = selectModels(config, select);

    const deps =
      opts.deps ??
      createProductionDeps({
        chain: parsed.chain,
        env,
        pin: parsed.pin,
        dryRun: parsed.command === "plan",
        ...(parsed.seedNode !== undefined ? { seedNode: parsed.seedNode } : {}),
      });

    if (parsed.command === "plan") {
      const plan = await planBootstrap(config, entries, parsed.chain, deps);
      if (parsed.json) {
        io.stdout.write(toJson(plan));
      } else {
        for (const row of plan.entries) {
          const bits = [
            row.repo,
            row.status,
            row.snapshotSize !== undefined ? `${row.snapshotSize} B` : "",
            row.fileCount !== undefined ? `${row.fileCount} files` : "",
            row.license ?? "",
            row.hbCrossCheck !== undefined ? `hb=${row.hbCrossCheck}` : "",
            row.gasEstimate !== undefined ? `gas=${row.gasEstimate}` : "",
            row.reason ?? "",
          ].filter((s) => s !== "");
          io.stderr.write(`${bits.join("  ")}\n`);
          if (row.plan !== undefined) io.stderr.write(`${row.plan}\n`);
        }
        io.stderr.write(`totals  bytes=${plan.totals.bytes}  gas=${plan.totals.gasEstimate}\n`);
      }
      return 0;
    }

    const downloads = parsed.downloads ?? join(root, "downloads");
    const statePath = opts.statePath ?? join(root, "state.json");
    const results = await runBootstrap(
      {
        config,
        entries,
        statePath,
        downloads,
        chain: parsed.chain,
        resume: parsed.resume,
        submitHb: parsed.submitHb,
      },
      deps,
    );
    if (parsed.json) {
      io.stdout.write(toJson(results));
    } else {
      for (const r of results) {
        io.stderr.write(`${r.repo}  ${r.status}${r.reason !== undefined ? `  ${r.reason}` : ""}\n`);
      }
    }
    if (results.some((r) => r.status === "failed")) {
      return EXIT_CODES.VERIFY;
    }
    return 0;
  } catch (err) {
    if (isEnspackError(err)) {
      io.stderr.write(`${err.code}: ${err.message}\n`);
      return EXIT_CODES[err.code];
    }
    const message = err instanceof Error ? err.message : String(err);
    io.stderr.write(`${message}\n`);
    return 1;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runCli(argv);
}

function isBin(): boolean {
  const arg = process.argv[1];
  if (arg === undefined) return false;
  return arg.endsWith("/cli.js") || arg.endsWith("/cli.ts") || arg.endsWith("enspack-bootstrap");
}

if (isBin()) {
  void main();
}
