import type { ChildProcess } from "node:child_process";
import {
  REGISTRY_ROLES,
  RESOLVER_ROLES,
  SPEC_STRING,
  TEXT_KEYS,
  adminOf,
  dnsEncodeName,
  ensV2ConfigFor,
  labelId,
  namehashOf,
  permissionedResolverAbi,
  registryV2Abi,
} from "@enspack/core";
import { http, type Address, createPublicClient, createWalletClient, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  provisionV2Name,
  startSepoliaAnvil,
} from "../../../../packages/core/test/chain/v2-helpers.js";
import { createApp } from "../../src/app.js";
import { publisherRecordsV2 } from "../../src/chain-v2.js";
import { createRegistrarChain } from "../../src/chain.js";
import { verifyFileContents } from "../../src/claim.js";
import { createDb } from "../../src/db.js";
import { ANVIL_1_KEY, type HfState, PUBLIC_DIR, createFakeHf } from "../helpers.js";
import { anvilAvailable, anvilBin, killPid } from "./helpers.js";

const ROOT_NAME = "enspack-test.eth";
const ANVIL_3_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
/** Anvil account 5 — root owner. Account 0 is ERC1155InvalidReceiver on this Sepolia fork. */
const ANVIL_5_KEY = "0x8b3a350cf5c34c9194ca85829a1df3844143dcd6bddaa20671b0f12e6badbc1b";
/** Anvil account 6 — claimant. Well-known accounts 0 and 2 can have code on Sepolia. */
const ANVIL_6_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8e30d5ee3342f59";

describe.skipIf(!anvilAvailable)("registrar v2 anvil sepolia fork", { timeout: 240_000 }, () => {
  let proc: ChildProcess | undefined;
  let rpcUrl: string;
  let rootRegistry: Address;
  let resolver: Address;

  beforeAll(async () => {
    if (anvilBin === null) {
      return;
    }
    const started = await startSepoliaAnvil(anvilBin);
    proc = started.proc;
    rpcUrl = started.url;
    const ensV2 = ensV2ConfigFor("sepolia", process.env as Record<string, string | undefined>);
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const account5 = privateKeyToAccount(ANVIL_5_KEY);
    const wallet0 = createWalletClient({
      account: account5,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    const provisioned = await provisionV2Name(publicClient, wallet0, ensV2, {
      label: "enspack-test",
      rpcUrl,
    });
    rootRegistry = provisioned.rootUserRegistry;
    resolver = provisioned.resolver;

    const account1 = privateKeyToAccount(ANVIL_1_KEY);
    const grantReg = await wallet0.writeContract({
      address: rootRegistry,
      abi: registryV2Abi,
      functionName: "grantRootRoles",
      args: [REGISTRY_ROLES.REGISTRAR | REGISTRY_ROLES.RENEW, account1.address],
    });
    const grantRegReceipt = await publicClient.waitForTransactionReceipt({ hash: grantReg });
    if (grantRegReceipt.status !== "success") {
      throw new Error("grantRootRoles(REGISTRAR|RENEW) failed");
    }

    const grantText = await wallet0.writeContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: "authorizeNameRoles",
      args: [
        dnsEncodeName(""),
        RESOLVER_ROLES.SET_TEXT | adminOf(RESOLVER_ROLES.SET_TEXT),
        account1.address,
        true,
      ],
    });
    const grantTextReceipt = await publicClient.waitForTransactionReceipt({ hash: grantText });
    if (grantTextReceipt.status !== "success") {
      throw new Error("authorizeNameRoles(SET_TEXT) failed");
    }
  }, 180_000);

  afterAll(() => {
    if (proc !== undefined) {
      killPid(proc);
    }
  });

  it("issues the subname in 2 txs; owner and text records match; second claim is 409; health approved", async () => {
    const db = await createDb();
    const hf: HfState = {
      namespace: "alice",
      name: "proof",
      file: null,
      sha: "b".repeat(40),
      private: false,
    };
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const operator = privateKeyToAccount(ANVIL_1_KEY);
    const wallet = createWalletClient({
      account: operator,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    const ensV2 = ensV2ConfigFor("sepolia", process.env as Record<string, string | undefined>);
    const chain = createRegistrarChain({
      client: publicClient,
      wallet,
      operator: operator.address,
      ensVersion: "v2",
      ensV2,
      rootName: ROOT_NAME,
    });
    const app = createApp({
      db,
      hf: { fetch: createFakeHf(hf) },
      chain,
      now: () => new Date("2026-09-14T00:00:00.000Z"),
      random: () => Uint8Array.from({ length: 32 }, () => 0xcd),
      publicDir: PUBLIC_DIR,
      chainName: "sepolia",
    });

    const health = await app.request("/v1/health");
    const healthBody = (await health.json()) as { approved?: boolean; ensVersion?: string };
    expect(health.status, JSON.stringify(healthBody)).toBe(200);
    expect(healthBody.ensVersion).toBe("v2");
    expect(healthBody.approved).toBe(true);

    const claimant = privateKeyToAccount(ANVIL_6_KEY);
    const created = await app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: claimant.address }),
    });
    expect(created.status).toBe(201);
    const claim = (await created.json()) as {
      claimId: string;
      label: string;
      challenge: string;
    };
    expect(claim.label).toBe("alice");

    hf.file = verifyFileContents(claim.challenge, claimant.address);
    const signature = await claimant.signMessage({ message: claim.challenge });
    const verified = await app.request(`/v1/claims/${claim.claimId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "alice/proof", signature }),
    });
    const body = (await verified.json()) as {
      error?: string;
      code?: string;
      txs?: string[];
      owner?: string;
      name?: string;
    };
    expect(verified.status, JSON.stringify(body)).toBe(200);
    expect(body.txs).toHaveLength(2);
    expect(body.owner).toBe(claimant.address);
    expect(body.name).toBe(`alice.${ROOT_NAME}`);

    const owner = await publicClient.readContract({
      address: rootRegistry,
      abi: registryV2Abi,
      functionName: "getOwner",
      args: [labelId("alice")],
    });
    expect(owner).toBe(claimant.address);
    expect(owner).not.toBe(zeroAddress);

    const records = await publisherRecordsV2(chain, "alice");
    expect(records.hf).toBe("alice");
    expect(records.spec).toBe(SPEC_STRING);

    const hfText = await publicClient.readContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: "text",
      args: [namehashOf(`alice.${ROOT_NAME}`), TEXT_KEYS.hf],
    });
    expect(hfText).toBe("alice");

    const again = await app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: claimant.address }),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "TAKEN" });

    await db.close();
  });

  it("fails verify 5xx with no partial state when the operator lacks ROLE_SET_TEXT", async () => {
    const db = await createDb();
    const hf: HfState = {
      namespace: "bob",
      name: "proof",
      file: null,
      sha: "c".repeat(40),
      private: false,
    };
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const account5 = privateKeyToAccount(ANVIL_5_KEY);
    const wallet0 = createWalletClient({
      account: account5,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    const operator3 = privateKeyToAccount(ANVIL_3_KEY);
    const grantReg = await wallet0.writeContract({
      address: rootRegistry,
      abi: registryV2Abi,
      functionName: "grantRootRoles",
      args: [REGISTRY_ROLES.REGISTRAR | REGISTRY_ROLES.RENEW, operator3.address],
    });
    await publicClient.waitForTransactionReceipt({ hash: grantReg });

    const wallet = createWalletClient({
      account: operator3,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    const ensV2 = ensV2ConfigFor("sepolia", process.env as Record<string, string | undefined>);
    const chain = createRegistrarChain({
      client: publicClient,
      wallet,
      operator: operator3.address,
      ensVersion: "v2",
      ensV2,
      rootName: ROOT_NAME,
    });
    const app = createApp({
      db,
      hf: { fetch: createFakeHf(hf) },
      chain,
      now: () => new Date("2026-09-14T00:00:00.000Z"),
      random: () => Uint8Array.from({ length: 32 }, () => 0xef),
      publicDir: PUBLIC_DIR,
      chainName: "sepolia",
    });

    const claimant = privateKeyToAccount(ANVIL_6_KEY);
    const created = await app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "bob", address: claimant.address }),
    });
    expect(created.status).toBe(201);
    const claim = (await created.json()) as { claimId: string; challenge: string };
    hf.file = verifyFileContents(claim.challenge, claimant.address);
    const signature = await claimant.signMessage({ message: claim.challenge });
    const verified = await app.request(`/v1/claims/${claim.claimId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "bob/proof", signature }),
    });
    const body = (await verified.json()) as { error?: string; code?: string };
    expect(verified.status).toBeGreaterThanOrEqual(500);
    expect(String(body.error ?? body.code)).toMatch(/SET_TEXT|resolver/i);

    const owner = await publicClient.readContract({
      address: rootRegistry,
      abi: registryV2Abi,
      functionName: "getOwner",
      args: [labelId("bob")],
    });
    expect(owner).toBe(zeroAddress);
    await db.close();
  });
});
