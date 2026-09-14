import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { http, createPublicClient, createWalletClient, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensV2ConfigFor } from "../../src/ens/v2/config.js";
import { hasRootRolesV2, nameStateV2 } from "../../src/ens/v2/discovery.js";
import { REGISTRY_ROLES, RESOLVER_ROLES } from "../../src/ens/v2/roles.js";
import { planEnsSetup, runEnsSetup } from "../../src/ens/v2/setup.js";
import {
  type PublishResultV2,
  canonicalJson,
  createPublisher,
  manifestCid,
  validateManifest,
} from "../../src/index.js";
import { tinyManifest } from "../helpers/tiny-manifest.js";
import {
  ANVIL_0_KEY,
  ANVIL_1_KEY,
  anvilAvailable,
  anvilBin,
  killPid,
  provisionV2Name,
  startSepoliaAnvil,
} from "./v2-helpers.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cliBin = join(repoRoot, "packages/cli/bin/enspack.js");
const cliDist = join(repoRoot, "packages/cli/dist/index.js");
const cliBuilt = existsSync(cliDist);

const NAME = "enspack-test.eth";
const MIRRORS = "mirrors.enspack-test.eth";
const OPERATOR_ROLES = REGISTRY_ROLES.REGISTRAR | REGISTRY_ROLES.RENEW;

function spawnCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 60_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliBin, ...args], {
      env,
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`enspack ${args.join(" ")} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => {
      out.push(c);
    });
    child.stderr.on("data", (c: Buffer) => {
      err.push(c);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

describe.skipIf(!anvilAvailable)("ens-setup anvil sepolia fork", { timeout: 300_000 }, () => {
  let proc: ChildProcess | undefined;
  let rpcUrl: string;
  let cfg: ReturnType<typeof ensV2ConfigFor>;
  let freshTxCount = 0;

  beforeAll(async () => {
    if (anvilBin === null) {
      return;
    }
    const started = await startSepoliaAnvil(anvilBin);
    proc = started.proc;
    rpcUrl = started.url;
    cfg = ensV2ConfigFor("sepolia");
    const { publicClient, wallet0 } = clients();
    await provisionV2Name(publicClient, wallet0, cfg, { rpcUrl, setupPublisher: false });
  }, 240_000);

  afterAll(() => {
    if (proc !== undefined) {
      killPid(proc);
    }
  });

  function clients() {
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const account0 = privateKeyToAccount(ANVIL_0_KEY);
    const account1 = privateKeyToAccount(ANVIL_1_KEY);
    const wallet0 = createWalletClient({
      account: account0,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    return { publicClient, account0, account1, wallet0 };
  }

  it.skipIf(!cliBuilt)("CLI child-process dry-run against the fork sends nothing", async () => {
    const { account1, publicClient, account0 } = clients();
    const nonceBefore = await publicClient.getTransactionCount({ address: account0.address });
    const result = await spawnCli(
      [
        "ens-setup",
        "--chain",
        "sepolia",
        "--name",
        NAME,
        "--subname",
        "mirrors",
        "--operator",
        account1.address,
        "--dry-run",
        "--json",
      ],
      {
        ...process.env,
        SEPOLIA_RPC_URL: rpcUrl,
        ENSPACK_OPERATOR_KEY: ANVIL_0_KEY,
        ENSPACK_ENS_VERSION: "v2",
      },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/deployProxy/);
    expect(result.stderr).toMatch(/setResolver/);
    expect(result.stderr).toMatch(/Registry\.register\(mirrors/);
    const payload = JSON.parse(result.stdout) as { txs: unknown[]; name: string };
    expect(payload.name).toBe(NAME);
    expect(payload.txs).toEqual([]);
    expect(await publicClient.getTransactionCount({ address: account0.address })).toBe(nonceBefore);
  });

  it("runEnsSetup deploys resolver, registry, mirrors, and grants the operator", async () => {
    const { publicClient, wallet0, account0, account1 } = clients();
    const plan = await planEnsSetup(publicClient, cfg, {
      name: NAME,
      subnames: ["mirrors"],
      operator: account1.address,
      account: account0.address,
    });
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.some((s) => /deployProxy/.test(s.description))).toBe(true);

    const result = await runEnsSetup(
      publicClient,
      wallet0,
      cfg,
      {
        name: NAME,
        subnames: ["mirrors"],
        operator: account1.address,
        account: account0.address,
      },
      { plan },
    );
    freshTxCount = result.txs.length;
    expect(result.txs.length).toBeGreaterThanOrEqual(10);
    for (const hash of result.txs) {
      expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
    }

    const root = await nameStateV2(publicClient, cfg, NAME);
    expect(root.resolver).not.toBe(zeroAddress);
    expect(root.subregistry).not.toBe(zeroAddress);
    expect(result.resolver.toLowerCase()).toBe(root.resolver.toLowerCase());
    expect(result.registry.toLowerCase()).toBe(root.subregistry.toLowerCase());

    const mirrors = await nameStateV2(publicClient, cfg, MIRRORS);
    expect(mirrors.owner.toLowerCase()).toBe(account0.address.toLowerCase());
    expect(mirrors.subregistry).not.toBe(zeroAddress);
    expect(mirrors.resolver.toLowerCase()).toBe(root.resolver.toLowerCase());

    expect(
      await hasRootRolesV2(publicClient, root.subregistry, OPERATOR_ROLES, account1.address),
    ).toBe(true);
    expect(
      await hasRootRolesV2(publicClient, mirrors.subregistry, OPERATOR_ROLES, account1.address),
    ).toBe(true);
    expect(
      await hasRootRolesV2(publicClient, root.resolver, RESOLVER_ROLES.SET_TEXT, account1.address),
    ).toBe(true);
  });

  it("re-running ens-setup is 0 transactions", async () => {
    const { publicClient, wallet0, account0, account1 } = clients();
    const nonceBefore = await publicClient.getTransactionCount({ address: account0.address });
    const result = await runEnsSetup(publicClient, wallet0, cfg, {
      name: NAME,
      subnames: ["mirrors"],
      operator: account1.address,
      account: account0.address,
    });
    expect(result.txs).toHaveLength(0);
    expect(await publicClient.getTransactionCount({ address: account0.address })).toBe(nonceBefore);
  });

  it("createPublisher v2 publishes a model under mirrors in 4 txs with no setup", async () => {
    const { publicClient, wallet0, account1 } = clients();
    const manifest = validateManifest(
      tinyManifest({
        publisher: MIRRORS,
        model: `tiny-model.${MIRRORS}`,
      }),
    );
    const cid = await manifestCid(canonicalJson(manifest));
    const publisher = createPublisher({
      client: publicClient,
      wallet: wallet0,
      ensVersion: "v2",
    });
    const live = (await publisher.publish({
      manifest,
      manifestCid: cid,
      chain: "sepolia",
    })) as PublishResultV2;
    expect(live.txs).toHaveLength(4);
    expect(live.setup).toEqual([]);
    expect(live.calls.every((c) => !c.description.startsWith("setup:"))).toBe(true);
    for (const hash of live.txs) {
      expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
    }

    const root = await nameStateV2(publicClient, cfg, NAME);
    const registrarApproved = await hasRootRolesV2(
      publicClient,
      root.subregistry,
      OPERATOR_ROLES,
      account1.address,
    );
    const resolverApproved = await hasRootRolesV2(
      publicClient,
      root.resolver,
      RESOLVER_ROLES.SET_TEXT,
      account1.address,
    );
    expect(registrarApproved && resolverApproved).toBe(true);
    expect(freshTxCount).toBeGreaterThan(0);
  });
});
