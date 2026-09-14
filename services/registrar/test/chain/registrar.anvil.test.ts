import type { ChildProcess } from "node:child_process";
import { ENS_REGISTRY, SPEC_STRING, TEXT_KEYS, namehashOf } from "@enspack/core";
import { http, createPublicClient, createWalletClient, namehash, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { verifyFileContents } from "../../src/claim.js";
import { createDb } from "../../src/db.js";
import { publicResolverReadAbi, registrarRegistryAbi } from "../../src/ens-abi.js";
import {
  ANVIL_1_KEY,
  ANVIL_2_KEY,
  CLAIMANT,
  type HfState,
  PUBLIC_DIR,
  createFakeHf,
} from "../helpers.js";
import {
  ROOT_NAME,
  anvilAvailable,
  anvilBin,
  killPid,
  provisionRegistrarRoot,
  startAnvil,
} from "./helpers.js";

describe.skipIf(!anvilAvailable)("registrar anvil fork", { timeout: 240_000 }, () => {
  let proc: ChildProcess | undefined;
  let rpcUrl: string;
  let publicResolver: `0x${string}`;

  beforeAll(async () => {
    if (anvilBin === null) {
      return;
    }
    const started = await startAnvil(anvilBin);
    proc = started.proc;
    rpcUrl = started.url;
    const provisioned = await provisionRegistrarRoot(rpcUrl);
    publicResolver = provisioned.publicResolver;
  }, 180_000);

  afterAll(() => {
    if (proc !== undefined) {
      killPid(proc);
    }
  });

  it("issues the subname in 3 txs; owner and text records match; second claim is 409", async () => {
    const db = await createDb();
    const hf: HfState = {
      namespace: "alice",
      name: "proof",
      file: null,
      sha: "b".repeat(40),
      private: false,
    };
    const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const operator = privateKeyToAccount(ANVIL_1_KEY);
    const wallet = createWalletClient({
      account: operator,
      chain: mainnet,
      transport: http(rpcUrl),
    });
    const app = createApp({
      db,
      hf: { fetch: createFakeHf(hf) },
      chain: {
        client: publicClient,
        wallet,
        operator: operator.address,
        registry: ENS_REGISTRY,
        rootName: ROOT_NAME,
      },
      now: () => new Date("2026-09-14T00:00:00.000Z"),
      random: () => Uint8Array.from({ length: 32 }, () => 0xcd),
      publicDir: PUBLIC_DIR,
      chainName: "mainnet",
    });

    const claimant = privateKeyToAccount(ANVIL_2_KEY);
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
    expect(body.txs).toHaveLength(3);
    expect(body.owner).toBe(claimant.address);
    expect(body.name).toBe(`alice.${ROOT_NAME}`);

    const node = namehashOf(`alice.${ROOT_NAME}`);
    const owner = await publicClient.readContract({
      address: ENS_REGISTRY,
      abi: registrarRegistryAbi,
      functionName: "owner",
      args: [node],
    });
    expect(owner).toBe(CLAIMANT.address);
    expect(owner).not.toBe(zeroAddress);

    const hfText = await publicClient.readContract({
      address: publicResolver,
      abi: publicResolverReadAbi,
      functionName: "text",
      args: [node, TEXT_KEYS.hf],
    });
    expect(hfText).toBe("alice");
    const specText = await publicClient.readContract({
      address: publicResolver,
      abi: publicResolverReadAbi,
      functionName: "text",
      args: [node, TEXT_KEYS.spec],
    });
    expect(specText).toBe(SPEC_STRING);

    const again = await app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: claimant.address }),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "TAKEN" });

    expect(namehash(`alice.${ROOT_NAME}`)).toBe(node);
    await db.close();
  });
});
