import {
  type EnsSetupPlan,
  type EnsSetupResult,
  EnspackError,
  ensSetupResultJson,
  ensVersionFor,
  formatEnsSetupPlan,
} from "@enspack/core";
import type { Command } from "commander";
import { type Address, getAddress, isAddress } from "viem";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, collect, parseChain, rpcUrlFor } from "../opts.js";
import type { CliDeps } from "../types.js";

export interface EnsSetupFlags {
  name: string;
  subname?: string[];
  operator?: string;
  dryRun?: boolean;
  json?: boolean;
  chain?: string;
}

function parseOperator(raw: string | undefined): Address | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  if (!isAddress(raw, { strict: false })) {
    throw new EnspackError("PUBLISH", "--operator is not a valid address");
  }
  return getAddress(raw);
}

function parseSubnames(raw: string[] | undefined, parent: string): string[] {
  if (raw === undefined || raw.length === 0) {
    return [];
  }
  const suffix = `.${parent}`;
  return raw.map((value) => {
    if (value === "" || value.startsWith(".") || value.endsWith(".")) {
      throw new EnspackError("PUBLISH", `invalid --subname ${JSON.stringify(value)}`);
    }
    if (!value.includes(".")) {
      return value;
    }
    if (!value.endsWith(suffix) || value.slice(0, -suffix.length).includes(".")) {
      throw new EnspackError("PUBLISH", `--subname ${value} is not a direct child of ${parent}`);
    }
    return value.slice(0, -suffix.length);
  });
}

function printSummary(stderr: CliDeps["stderr"], result: EnsSetupResult): void {
  human(stderr, `resolver ${result.resolver}`);
  human(stderr, `registry ${result.registry}`);
  for (const sub of result.subnames) {
    human(stderr, `subname ${sub.name} registry=${sub.registry}`);
  }
  if (result.operator !== null) {
    human(stderr, `operator ${result.operator} REGISTRAR|RENEW + resolver record roles granted`);
  }
}

/**
 * WP-18: one-shot ENSv2 on-chain setup (Sepolia). Signer is
 * `ENSPACK_OPERATOR_KEY`, falling back to `ENSPACK_PUBLISHER_KEY`.
 */
export async function runEnsSetupCommand(deps: CliDeps, flags: EnsSetupFlags): Promise<void> {
  const chain = parseChain(flags.chain ?? "mainnet");
  const ensVersion = ensVersionFor(chain, deps.env);
  if (ensVersion !== "v2") {
    throw new EnspackError("PUBLISH", "ens-setup is ENSv2 only");
  }
  const rpcUrl = rpcUrlFor(chain, deps.env);
  if (deps.ensSetupFactory === undefined) {
    throw new EnspackError("PUBLISH", "ens-setup factory is not configured");
  }
  const operator = parseOperator(flags.operator);
  const subnames = parseSubnames(flags.subname, flags.name);
  const handle = deps.ensSetupFactory(chain, rpcUrl);
  const input = { name: flags.name, subnames, ...(operator !== undefined ? { operator } : {}) };
  const plan: EnsSetupPlan = await handle.plan(input);
  const formatted = formatEnsSetupPlan(plan);
  if (formatted.length > 0) {
    human(deps.stderr, formatted);
  }

  if (flags.dryRun === true) {
    if (flags.json === true) {
      writeJson(
        deps.stdout,
        ensSetupResultJson({
          name: plan.name,
          resolver: plan.resolver,
          registry: plan.registry,
          subnames: plan.subnames.map((s) => ({ name: s.name, registry: s.registry })),
          operator: plan.operator,
          txs: [],
          skipped: plan.already,
        }),
      );
    }
    return;
  }

  const result = await handle.run(input, {
    plan,
    onTx: (hash, description) => {
      human(deps.stderr, `${description} tx=${hash}`);
    },
  });
  printSummary(deps.stderr, result);
  if (flags.json === true) {
    writeJson(deps.stdout, ensSetupResultJson(result));
  }
}

export function registerEnsSetup(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("ens-setup")
      .description("One-shot ENSv2 on-chain setup for a publisher name (Sepolia)")
      .requiredOption("--name <name>", "ENS name to set up (e.g. enspack.eth)")
      .option("--subname <label>", "direct child label to register (repeatable)", collect)
      .option(
        "--operator <address>",
        "hot operator to grant REGISTRAR|RENEW and resolver record roles",
      )
      .option("--dry-run", "print the plan without sending transactions"),
  ).action(async (flags: EnsSetupFlags) => {
    await runEnsSetupCommand(deps, flags);
  });
}
