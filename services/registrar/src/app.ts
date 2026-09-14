import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeLabel } from "@enspack/core";
import type { FetchLike } from "@enspack/hf";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { type Address, type Hex, verifyMessage } from "viem";
import {
  type RegistrarChain,
  isLabelTakenOnChain,
  issuePublisherSubname,
  publisherName,
  readOperatorApproval,
} from "./chain.js";
import {
  CLAIM_TTL_MS,
  claimInstructions,
  makeChallenge,
  parseClaimAddress,
  verifyFileContents,
} from "./claim.js";
import type { Db } from "./db.js";
import { assertAuthor, assertPublicRepo, lookupHfRepo, parseRepo, readVerifyFile } from "./hf.js";
import { HttpError, jsonError } from "./http-error.js";
import {
  type Attestation,
  getAttestationByClaim,
  getAttestationByLabel,
  getClaim,
  getCollision,
  getVerifiedForLabel,
  insertAttestation,
  insertClaim,
  insertReview,
} from "./store.js";

export type RegistrarDeps = {
  db: Db;
  hf: { fetch: FetchLike; baseUrl?: string; token?: string };
  chain: RegistrarChain;
  now: () => Date;
  random: () => Uint8Array;
  publicDir: string;
  chainName: "mainnet" | "sepolia";
};

export type ClaimStatus = "pending" | "verified" | "expired";

function claimStatus(verified: boolean, expiresAt: string, now: Date): ClaimStatus {
  if (verified) {
    return "verified";
  }
  if (new Date(expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return "pending";
}

async function readJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<
  Record<string, unknown>
> {
  try {
    const body: unknown = await c.req.json();
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // invalid JSON
  }
  throw new HttpError(400, "INVALID_JSON", "request body must be a JSON object");
}

/**
 * SPEC §7 / MVP.md §4.1: registrar HTTP API (`/v1/claims`, verify, publishers, health).
 */
export function createApp(deps: RegistrarDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        jsonError(err.message, err.code),
        err.status as 400 | 401 | 403 | 404 | 409 | 410 | 502,
      );
    }
    process.stderr.write(`registrar error: ${err instanceof Error ? err.message : "unknown"}\n`);
    return c.json(jsonError("internal error", "INTERNAL"), 500);
  });

  app.post("/v1/claims", async (c) => {
    const body = await readJsonBody(c);
    const hfNamespace = body.hfNamespace;
    if (typeof hfNamespace !== "string" || hfNamespace.trim() === "") {
      throw new HttpError(400, "INVALID_NAMESPACE", "hfNamespace is required");
    }
    const address = parseClaimAddress(body.address);
    const label = normalizeLabel(hfNamespace);
    if (label === "") {
      throw new HttpError(400, "INVALID_LABEL", "hfNamespace normalizes to an empty label");
    }

    if (await isLabelTakenOnChain(deps.chain, label)) {
      throw new HttpError(409, "TAKEN", `label ${label} is already owned on-chain`);
    }
    if ((await getVerifiedForLabel(deps.db, label)) !== undefined) {
      throw new HttpError(409, "TAKEN", `label ${label} is already verified`);
    }
    if ((await getAttestationByLabel(deps.db, label)) !== undefined) {
      throw new HttpError(409, "TAKEN", `label ${label} is already verified`);
    }

    const now = deps.now();
    const collision = await getCollision(deps.db, label, hfNamespace, now.toISOString());
    if (collision !== undefined) {
      await insertReview(deps.db, {
        label,
        hfNamespace,
        existingHfNamespace: collision.hfNamespace,
        reason: "collision",
        createdAt: now.toISOString(),
      });
      throw new HttpError(
        409,
        "COLLISION",
        `label ${label} collides with hfNamespace ${collision.hfNamespace} after normalization`,
      );
    }

    const challenge = makeChallenge(deps.random());
    const claimId = randomUUID();
    const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
    await insertClaim(deps.db, {
      id: claimId,
      hfNamespace,
      label,
      address,
      challenge,
      expiresAt,
      createdAt: now.toISOString(),
    });

    return c.json(
      {
        claimId,
        label,
        challenge,
        expiresAt,
        instructions: claimInstructions(hfNamespace, challenge, address),
      },
      201,
    );
  });

  app.post("/v1/claims/:id/verify", async (c) => {
    const claimId = c.req.param("id");
    const claim = await getClaim(deps.db, claimId);
    if (claim === undefined) {
      throw new HttpError(404, "NOT_FOUND", "claim not found");
    }
    const now = deps.now();
    if (claimStatus(claim.verified, claim.expiresAt, now) === "expired") {
      throw new HttpError(410, "EXPIRED", "claim has expired");
    }
    if (claim.verified) {
      throw new HttpError(409, "TAKEN", "claim is already verified");
    }

    const body = await readJsonBody(c);
    const { repo } = parseRepo(body.repo, claim.hfNamespace);
    const signature = body.signature;
    if (typeof signature !== "string" || signature === "") {
      throw new HttpError(400, "INVALID_SIGNATURE", "signature is required");
    }

    const hfOpts = {
      fetch: deps.hf.fetch,
      ...(deps.hf.baseUrl !== undefined ? { baseUrl: deps.hf.baseUrl } : {}),
      ...(deps.hf.token !== undefined ? { token: deps.hf.token } : {}),
    };
    const info = await lookupHfRepo(hfOpts.fetch, repo, {
      ...(hfOpts.baseUrl !== undefined ? { baseUrl: hfOpts.baseUrl } : {}),
      ...(hfOpts.token !== undefined ? { token: hfOpts.token } : {}),
    });
    assertAuthor(info, claim.hfNamespace);
    assertPublicRepo(info);

    const file = await readVerifyFile(hfOpts.fetch, info, {
      ...(hfOpts.baseUrl !== undefined ? { baseUrl: hfOpts.baseUrl } : {}),
    });
    const expected = verifyFileContents(claim.challenge, claim.address);
    if (file.body !== expected) {
      throw new HttpError(
        401,
        "CHALLENGE_MISMATCH",
        "enspack-verify.txt does not match the challenge",
      );
    }

    let ok = false;
    try {
      ok = await verifyMessage({
        address: claim.address as Address,
        message: claim.challenge,
        signature: signature as Hex,
      });
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new HttpError(401, "BAD_SIGNATURE", "signature does not recover to address");
    }

    if (await isLabelTakenOnChain(deps.chain, claim.label)) {
      throw new HttpError(409, "TAKEN", `label ${claim.label} is already owned on-chain`);
    }

    const txs = await issuePublisherSubname(deps.chain, {
      label: claim.label,
      hfNamespace: claim.hfNamespace,
      address: claim.address as Address,
    });

    const attestation: Attestation = {
      claimId: claim.id,
      hfNamespace: claim.hfNamespace,
      label: claim.label,
      address: claim.address,
      repo,
      commit: file.commit,
      signature,
      challenge: claim.challenge,
      txs,
      verifiedAt: now.toISOString(),
    };
    await insertAttestation(deps.db, attestation);

    const name = publisherName(claim.label, deps.chain.rootName);
    return c.json({
      label: claim.label,
      name,
      owner: claim.address,
      txs,
      attestationUrl: `/v1/publishers/${claim.label}`,
    });
  });

  app.get("/v1/claims/:id", async (c) => {
    const claim = await getClaim(deps.db, c.req.param("id"));
    if (claim === undefined) {
      throw new HttpError(404, "NOT_FOUND", "claim not found");
    }
    const now = deps.now();
    const status = claimStatus(claim.verified, claim.expiresAt, now);
    const payload: Record<string, unknown> = {
      claimId: claim.id,
      label: claim.label,
      status,
      expiresAt: claim.expiresAt,
      hfNamespace: claim.hfNamespace,
      address: claim.address,
    };
    if (status === "pending") {
      payload.challenge = claim.challenge;
    }
    if (status === "verified") {
      const att = await getAttestationByClaim(deps.db, claim.id);
      if (att !== undefined) {
        payload.attestationUrl = `/v1/publishers/${claim.label}`;
        payload.txs = att.txs;
      }
    }
    return c.json(payload);
  });

  app.get("/v1/publishers/:label", async (c) => {
    const label = normalizeLabel(c.req.param("label"));
    const att = await getAttestationByLabel(deps.db, label);
    if (att === undefined) {
      throw new HttpError(404, "NOT_FOUND", "unknown publisher label");
    }
    return c.json(att);
  });

  app.get("/v1/health", async (c) => {
    try {
      const { approved } = await readOperatorApproval(deps.chain);
      const balance = await deps.chain.client.getBalance({ address: deps.chain.operator });
      return c.json({
        ok: true,
        chain: deps.chainName,
        operator: deps.chain.operator,
        approved,
        balanceWei: balance.toString(),
      });
    } catch (err) {
      process.stderr.write(
        `health check failed: ${err instanceof Error ? err.message : "unknown"}\n`,
      );
      return c.json(
        {
          ok: false,
          chain: deps.chainName,
          operator: deps.chain.operator,
          approved: false,
          balanceWei: "0",
          ...jsonError(err instanceof Error ? err.message : "health check failed", "HEALTH"),
        },
        503,
      );
    }
  });

  app.get("/", async (c) => {
    const html = await readFile(join(deps.publicDir, "index.html"), "utf8");
    return c.html(html);
  });
  app.use(
    "/*",
    serveStatic({
      root: deps.publicDir,
    }),
  );

  return app;
}
