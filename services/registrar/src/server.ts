import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENS_REGISTRY, ROOT_NAME, ensV2ConfigFor, publicClientFor } from "@enspack/core";
import { serve } from "@hono/node-server";
import { http, type Hex, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { createApp } from "./app.js";
import { createRegistrarChain, readOperatorApproval, registrarEnsVersion } from "./chain.js";
import { createDbFromEnv } from "./db.js";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function requireEnv(name: string): string {
  const value = env(name);
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function operatorAccount() {
  const key = env("ENSPACK_OPERATOR_KEY");
  if (key === undefined || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("ENSPACK_OPERATOR_KEY must be a 0x-prefixed 32-byte hex private key");
  }
  return privateKeyToAccount(key as Hex);
}

function chainName(): "mainnet" | "sepolia" {
  const raw = env("REGISTRAR_CHAIN") ?? "mainnet";
  if (raw !== "mainnet" && raw !== "sepolia") {
    throw new Error("REGISTRAR_CHAIN must be mainnet or sepolia");
  }
  return raw;
}

function rpcUrl(chain: "mainnet" | "sepolia"): string {
  if (chain === "sepolia") {
    return requireEnv("SEPOLIA_RPC_URL");
  }
  return requireEnv("ETH_RPC_URL");
}

/** SPEC §7: wire env, operator wallet, database, and the HTTP server. */
export async function start(): Promise<void> {
  const chain = chainName();
  const rpc = rpcUrl(chain);
  const account = operatorAccount();
  const client = publicClientFor(chain, rpc);
  const wallet = createWalletClient({
    account,
    chain: chain === "sepolia" ? sepolia : mainnet,
    transport: http(rpc),
  });
  const db = await createDbFromEnv();
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");
  const hfToken = env("HF_TOKEN");
  const ensVersion = registrarEnsVersion(chain);
  const ensV2 =
    ensVersion === "v2"
      ? ensV2ConfigFor(chain, process.env as Record<string, string | undefined>)
      : undefined;
  const registrarChain = createRegistrarChain({
    client,
    wallet,
    operator: account.address,
    registry: ENS_REGISTRY,
    rootName: ROOT_NAME,
    ensVersion,
    ...(ensV2 !== undefined ? { ensV2 } : {}),
  });
  const deps = {
    db,
    hf: {
      fetch: globalThis.fetch.bind(globalThis),
      ...(hfToken !== undefined ? { token: hfToken } : {}),
    },
    chain: registrarChain,
    now: () => new Date(),
    random: () => randomBytes(32),
    publicDir,
    chainName: chain,
  };

  try {
    const approval = await readOperatorApproval(deps.chain);
    if (!approval.approved) {
      const extra =
        ensVersion === "v2"
          ? `, registrar=${String(approval.registrarApproved)} resolver=${String(approval.resolverApproved)}`
          : `, rootOwner=${approval.rootOwner}`;
      process.stderr.write(
        `operator ${account.address} is not approved for ${deps.chain.rootName} (ensVersion=${ensVersion}${extra})\n`,
      );
    } else {
      process.stderr.write(
        `operator ${account.address} is approved for ${deps.chain.rootName} (ensVersion=${ensVersion})\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `could not read operator approval: ${err instanceof Error ? err.message : "unknown"}\n`,
    );
  }

  const app = createApp(deps);
  const port = Number(env("PORT") ?? "8787");
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  process.stderr.write(`registrar listening on :${port} (${chain})\n`);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  start().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : "failed to start"}\n`);
    process.exit(1);
  });
}
