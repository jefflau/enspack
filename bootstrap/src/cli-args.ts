import { parseArgs } from "node:util";
import { EnspackError } from "@enspack/core";

export interface CliOptions {
  command: "plan" | "run";
  tier: number;
  only: string[];
  json: boolean;
  limit?: number;
  chain: "sepolia" | "mainnet";
  ensVersion?: "v1" | "v2";
  downloads?: string;
  pin: "kubo" | "seed";
  seedNode?: string;
  submitHb: boolean;
  resume: boolean;
  help: boolean;
}

const HELP = `enspack-bootstrap — mirror models.yaml under mirrors.enspack.eth (BOOTSTRAP.md §5)

Usage:
  enspack-bootstrap plan [--tier 1] [--only <repo>...] [--json]
                       [--chain sepolia|mainnet] [--ens-version v1|v2]
  enspack-bootstrap run  [--tier 1] [--only <repo>...] [--limit n]
                         [--chain sepolia|mainnet] [--ens-version v1|v2]
                         [--downloads <dir>]
                         [--pin kubo|seed] [--seed-node URL]
                         [--submit-hb] [--resume]

Env: SEPOLIA_RPC_URL / ETH_RPC_URL, ENSPACK_OPERATOR_KEY, HF_TOKEN,
     ENSPACK_KUBO_API, ENSPACK_SEED_NODE, ENSPACK_BOOTSTRAP_ALLOW_MAINNET,
     ENSPACK_BOOTSTRAP_STATE (state.json path; default <package>/state.json),
     ENSPACK_ENS_VERSION (v1|v2; default v2 on sepolia, v1 on mainnet),
     ENSPACK_ENSV2_* (Universal Resolver / factory / implementations)
`;

/**
 * BOOTSTRAP.md §5 / MVP.md WP-12: parse `enspack-bootstrap` argv.
 */
export function parseCli(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tier: { type: "string" },
      only: { type: "string", multiple: true },
      json: { type: "boolean", default: false },
      limit: { type: "string" },
      chain: { type: "string" },
      "ens-version": { type: "string" },
      downloads: { type: "string" },
      pin: { type: "string" },
      "seed-node": { type: "string" },
      "submit-hb": { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = positionals[0];
  const help = values.help === true;
  if (help || command === undefined) {
    return {
      command: "plan",
      tier: 1,
      only: [],
      json: false,
      chain: "sepolia",
      pin: "seed",
      submitHb: false,
      resume: false,
      help: true,
    };
  }
  if (command !== "plan" && command !== "run") {
    throw new EnspackError("POLICY", `unknown command ${JSON.stringify(command)}`);
  }
  const chain = values.chain ?? "sepolia";
  if (chain !== "sepolia" && chain !== "mainnet") {
    throw new EnspackError("POLICY", "--chain must be sepolia or mainnet");
  }
  const ensVersionRaw = values["ens-version"];
  if (
    ensVersionRaw !== undefined &&
    ensVersionRaw !== "" &&
    ensVersionRaw !== "v1" &&
    ensVersionRaw !== "v2"
  ) {
    throw new EnspackError("POLICY", "--ens-version must be v1 or v2");
  }
  const pin = values.pin ?? "seed";
  if (pin !== "kubo" && pin !== "seed") {
    throw new EnspackError("POLICY", "--pin must be kubo or seed");
  }
  const tier = Number(values.tier ?? "1");
  if (!Number.isInteger(tier) || tier < 1) {
    throw new EnspackError("POLICY", "--tier must be a positive integer");
  }
  const opts: CliOptions = {
    command,
    tier,
    only: values.only ?? [],
    json: values.json === true,
    chain,
    pin,
    submitHb: values["submit-hb"] === true,
    resume: values.resume === true,
    help: false,
  };
  if (ensVersionRaw === "v1" || ensVersionRaw === "v2") {
    opts.ensVersion = ensVersionRaw;
  }
  if (values.limit !== undefined) {
    const n = Number(values.limit);
    if (!Number.isInteger(n) || n < 1) {
      throw new EnspackError("POLICY", "--limit must be a positive integer");
    }
    opts.limit = n;
  }
  if (values.downloads !== undefined) opts.downloads = values.downloads;
  if (values["seed-node"] !== undefined) opts.seedNode = values["seed-node"];
  return opts;
}

export { HELP };
