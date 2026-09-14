import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyFileContents } from "../src/claim.js";
import type { Db } from "../src/db.js";
import { listReviews } from "../src/store.js";
import { ANVIL_0_KEY, CLAIMANT, FIXED_RANDOM, createFakeChain, createTestApp } from "./helpers.js";

vi.mock("@enspack/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@enspack/core")>();
  const { keccak256, toBytes } = await import("viem");
  const extra = actual as typeof actual & { labelId?: (label: string) => bigint };
  return {
    ...actual,
    labelId: extra.labelId ?? ((label: string) => BigInt(keccak256(toBytes(label)))),
    nameStateV2: vi.fn(async () => ({
      name: "enspack.eth",
      label: "enspack",
      parentRegistry: actual.ENS_REGISTRY,
      tokenIdOrLabelId: 0n,
      owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      expiry: 2_000_000_000n,
      resolver: "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63",
      subregistry: "0x1111111111111111111111111111111111111111",
      status: 2,
    })),
    hasRootRolesV2: vi.fn(async () => true),
  };
});

const CHALLENGE_HEX = [...FIXED_RANDOM].map((b) => b.toString(16).padStart(2, "0")).join("");
const CHALLENGE = `enspack-verify:${CHALLENGE_HEX}`;
const ADDRESS = CLAIMANT.address;
const ENS_VERSIONS = ["v1", "v2"] as const;

let db: Db | undefined;

afterEach(async () => {
  if (db !== undefined) {
    await db.close();
    db = undefined;
  }
});

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe.each(ENS_VERSIONS)("POST /v1/claims (ensVersion=%s)", (ensVersion) => {
  it("returns 201 with enspack-verify: + 64 hex challenge and the normalized label", async () => {
    const ctx = await createTestApp({ ensVersion });
    db = ctx.db;
    const res = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "Alice", address: ADDRESS }),
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.label).toBe("alice");
    expect(body.challenge).toBe(CHALLENGE);
    expect(typeof body.challenge).toBe("string");
    expect(body.challenge).toMatch(/^enspack-verify:[0-9a-f]{64}$/);
    expect(typeof body.claimId).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
    expect(typeof body.instructions).toBe("string");
    expect(String(body.instructions)).toContain("enspack-verify.txt");
  });

  it("returns 400 INVALID_ADDRESS for a non-checksum mixed-case address", async () => {
    const ctx = await createTestApp({ ensVersion });
    db = ctx.db;
    const res = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hfNamespace: "alice",
        address: "0x3c44CDDDB6A900FA2B585DD299E03D12FA4293BC",
      }),
    });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ code: "INVALID_ADDRESS" });
  });

  it("returns 409 TAKEN for a duplicate verified label", async () => {
    const ctx = await createTestApp({ ensVersion });
    db = ctx.db;
    const created = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: ADDRESS }),
    });
    const claim = await jsonOf(created);
    ctx.hf.file = verifyFileContents(String(claim.challenge), ADDRESS);
    const signature = await CLAIMANT.signMessage({ message: String(claim.challenge) });
    const verified = await ctx.app.request(`/v1/claims/${claim.claimId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "alice/proof", signature }),
    });
    expect(verified.status).toBe(200);

    const again = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: ADDRESS }),
    });
    expect(again.status).toBe(409);
    expect(await jsonOf(again)).toMatchObject({ code: "TAKEN" });
  });

  it("returns 409 COLLISION for a.b vs a-b and inserts a reviews row", async () => {
    const ctx = await createTestApp({ ensVersion });
    db = ctx.db;
    const first = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "a.b", address: ADDRESS }),
    });
    expect(first.status).toBe(201);
    const firstBody = await jsonOf(first);
    expect(firstBody.label).toBe("a-b");

    const second = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "a-b", address: ADDRESS }),
    });
    expect(second.status).toBe(409);
    expect(await jsonOf(second)).toMatchObject({ code: "COLLISION" });
    const reviews = await listReviews(ctx.db, "a-b");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.hfNamespace).toBe("a-b");
    expect(reviews[0]?.existingHfNamespace).toBe("a.b");
    expect(reviews[0]?.reason).toBe("collision");
  });
});

describe.each(ENS_VERSIONS)("POST /v1/claims/:id/verify (ensVersion=%s)", (ensVersion) => {
  it("returns 401 BAD_SIGNATURE for a signature from the wrong key", async () => {
    const ctx = await createTestApp({ ensVersion });
    db = ctx.db;
    const created = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: ADDRESS }),
    });
    const claim = await jsonOf(created);
    ctx.hf.file = verifyFileContents(String(claim.challenge), ADDRESS);
    const wrong = await privateKeyToAccount(ANVIL_0_KEY).signMessage({
      message: String(claim.challenge),
    });
    const res = await ctx.app.request(`/v1/claims/${claim.claimId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "alice/proof", signature: wrong }),
    });
    expect(res.status).toBe(401);
    expect(await jsonOf(res)).toMatchObject({ code: "BAD_SIGNATURE" });
  });

  it("returns 404 FILE_NOT_FOUND when enspack-verify.txt is missing", async () => {
    const ctx = await createTestApp({ ensVersion });
    db = ctx.db;
    const created = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: ADDRESS }),
    });
    const claim = await jsonOf(created);
    ctx.hf.file = null;
    const signature = await CLAIMANT.signMessage({ message: String(claim.challenge) });
    const res = await ctx.app.request(`/v1/claims/${claim.claimId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "alice/proof", signature }),
    });
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  it("returns 401 CHALLENGE_MISMATCH when the file contents differ", async () => {
    const ctx = await createTestApp({ ensVersion });
    db = ctx.db;
    const created = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: ADDRESS }),
    });
    const claim = await jsonOf(created);
    ctx.hf.file = "wrong\ncontents\n";
    const signature = await CLAIMANT.signMessage({ message: String(claim.challenge) });
    const res = await ctx.app.request(`/v1/claims/${claim.claimId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "alice/proof", signature }),
    });
    expect(res.status).toBe(401);
    expect(await jsonOf(res)).toMatchObject({ code: "CHALLENGE_MISMATCH" });
  });

  it("returns 410 EXPIRED when the claim is past 24h", async () => {
    let now = new Date("2026-09-14T00:00:00.000Z");
    const ctx = await createTestApp({ now: () => now, ensVersion });
    db = ctx.db;
    const created = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: ADDRESS }),
    });
    const claim = await jsonOf(created);
    now = new Date("2026-09-15T00:00:01.000Z");
    ctx.hf.file = verifyFileContents(String(claim.challenge), ADDRESS);
    const signature = await CLAIMANT.signMessage({ message: String(claim.challenge) });
    const res = await ctx.app.request(`/v1/claims/${claim.claimId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "alice/proof", signature }),
    });
    expect(res.status).toBe(410);
    expect(await jsonOf(res)).toMatchObject({ code: "EXPIRED" });
  });

  it("returns 403 AUTHOR_MISMATCH when the repo author is not hfNamespace", async () => {
    const ctx = await createTestApp({ ensVersion });
    db = ctx.db;
    const created = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: ADDRESS }),
    });
    const claim = await jsonOf(created);
    const signature = await CLAIMANT.signMessage({ message: String(claim.challenge) });
    const res = await ctx.app.request(`/v1/claims/${claim.claimId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "bob/proof", signature }),
    });
    expect(res.status).toBe(403);
    expect(await jsonOf(res)).toMatchObject({ code: "AUTHOR_MISMATCH" });
  });

  it("returns the attestation via GET /v1/publishers/:label after success and identically on repeat", async () => {
    const ctx = await createTestApp({ ensVersion });
    db = ctx.db;
    const created = await ctx.app.request("/v1/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hfNamespace: "alice", address: ADDRESS }),
    });
    const claim = await jsonOf(created);
    ctx.hf.file = verifyFileContents(String(claim.challenge), ADDRESS);
    const signature = await CLAIMANT.signMessage({ message: String(claim.challenge) });
    const verified = await ctx.app.request(`/v1/claims/${claim.claimId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "alice/proof", signature }),
    });
    expect(verified.status).toBe(200);
    const verifyBody = await jsonOf(verified);
    expect(verifyBody.txs).toHaveLength(ensVersion === "v2" ? 2 : 3);
    expect(verifyBody.attestationUrl).toBe("/v1/publishers/alice");

    const first = await ctx.app.request("/v1/publishers/alice");
    expect(first.status).toBe(200);
    const att = await jsonOf(first);
    expect(att).toMatchObject({
      claimId: claim.claimId,
      hfNamespace: "alice",
      label: "alice",
      address: ADDRESS,
      repo: "alice/proof",
      signature,
      challenge: claim.challenge,
    });
    expect(att.txs).toEqual(verifyBody.txs);
    const second = await ctx.app.request("/v1/publishers/alice");
    expect(await jsonOf(second)).toEqual(att);
  });
});

describe.each(ENS_VERSIONS)(
  "GET /v1/claims/:id status transitions (ensVersion=%s)",
  (ensVersion) => {
    it("moves pending → verified, and pending → expired", async () => {
      let now = new Date("2026-09-14T00:00:00.000Z");
      const ctx = await createTestApp({ now: () => now, ensVersion });
      db = ctx.db;
      const created = await ctx.app.request("/v1/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hfNamespace: "alice", address: ADDRESS }),
      });
      const claim = await jsonOf(created);
      const pending = await ctx.app.request(`/v1/claims/${claim.claimId}`);
      expect(pending.status).toBe(200);
      expect(await jsonOf(pending)).toMatchObject({
        claimId: claim.claimId,
        label: "alice",
        status: "pending",
      });

      ctx.hf.file = verifyFileContents(String(claim.challenge), ADDRESS);
      const signature = await CLAIMANT.signMessage({ message: String(claim.challenge) });
      expect(
        (
          await ctx.app.request(`/v1/claims/${claim.claimId}/verify`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ repo: "alice/proof", signature }),
          })
        ).status,
      ).toBe(200);
      const verified = await ctx.app.request(`/v1/claims/${claim.claimId}`);
      expect(await jsonOf(verified)).toMatchObject({ status: "verified" });

      const other = await ctx.app.request("/v1/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hfNamespace: "carol", address: ADDRESS }),
      });
      const otherClaim = await jsonOf(other);
      now = new Date("2026-09-16T00:00:00.000Z");
      const expired = await ctx.app.request(`/v1/claims/${otherClaim.claimId}`);
      expect(await jsonOf(expired)).toMatchObject({ status: "expired" });
    });
  },
);

describe.each(ENS_VERSIONS)("GET /v1/health (ensVersion=%s)", (ensVersion) => {
  it("reports operator, approval, and balance", async () => {
    const ctx = await createTestApp({ chain: createFakeChain({ approved: true, ensVersion }) });
    db = ctx.db;
    const res = await ctx.app.request("/v1/health");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.chain).toBe("mainnet");
    expect(body.approved).toBe(true);
    expect(body.ensVersion).toBe(ensVersion);
    expect(typeof body.operator).toBe("string");
    expect(body.balanceWei).toBe((10n ** 18n).toString());
    if (ensVersion === "v2") {
      expect(body.registrarApproved).toBe(true);
      expect(body.resolverApproved).toBe(true);
      expect(body.rootRegistry).toBeDefined();
      expect(body.resolver).toBeDefined();
    }
  });
});
