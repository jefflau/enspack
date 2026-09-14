import { randomUUID } from "node:crypto";
import { type Db, asBool, asIso } from "./db.js";

export type ClaimRow = {
  id: string;
  hfNamespace: string;
  label: string;
  address: string;
  challenge: string;
  expiresAt: string;
  verified: boolean;
  createdAt: string;
};

export type Attestation = {
  claimId: string;
  hfNamespace: string;
  label: string;
  address: string;
  repo: string;
  commit: string;
  signature: string;
  challenge: string;
  txs: string[];
  verifiedAt: string;
};

export type ReviewRow = {
  id: string;
  label: string;
  hfNamespace: string;
  existingHfNamespace: string;
  reason: string;
  createdAt: string;
};

type ClaimSql = {
  id: unknown;
  hf_namespace: unknown;
  label: unknown;
  address: unknown;
  challenge: unknown;
  expires_at: unknown;
  verified: unknown;
  created_at: unknown;
};

type AttestationSql = {
  claim_id: unknown;
  hf_namespace: unknown;
  label: unknown;
  address: unknown;
  repo: unknown;
  commit: unknown;
  signature: unknown;
  challenge: unknown;
  txs: unknown;
  verified_at: unknown;
};

function str(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`expected string ${field}`);
  }
  return value;
}

function mapClaim(row: ClaimSql): ClaimRow {
  return {
    id: str(row.id, "id"),
    hfNamespace: str(row.hf_namespace, "hf_namespace"),
    label: str(row.label, "label"),
    address: str(row.address, "address"),
    challenge: str(row.challenge, "challenge"),
    expiresAt: asIso(row.expires_at),
    verified: asBool(row.verified),
    createdAt: asIso(row.created_at),
  };
}

function parseTxs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
  }
  throw new Error("expected txs array");
}

function mapAttestation(row: AttestationSql): Attestation {
  return {
    claimId: str(row.claim_id, "claim_id"),
    hfNamespace: str(row.hf_namespace, "hf_namespace"),
    label: str(row.label, "label"),
    address: str(row.address, "address"),
    repo: str(row.repo, "repo"),
    commit: str(row.commit, "commit"),
    signature: str(row.signature, "signature"),
    challenge: str(row.challenge, "challenge"),
    txs: parseTxs(row.txs),
    verifiedAt: asIso(row.verified_at),
  };
}

export async function insertClaim(
  db: Db,
  row: Omit<ClaimRow, "verified" | "createdAt"> & { createdAt: string },
): Promise<void> {
  await db.query(
    `INSERT INTO claims (id, hf_namespace, label, address, challenge, expires_at, verified, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7)`,
    [row.id, row.hfNamespace, row.label, row.address, row.challenge, row.expiresAt, row.createdAt],
  );
}

export async function getClaim(db: Db, id: string): Promise<ClaimRow | undefined> {
  const { rows } = await db.query<ClaimSql>(
    `SELECT id, hf_namespace, label, address, challenge, expires_at, verified, created_at
     FROM claims WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? undefined : mapClaim(row);
}

export async function getVerifiedForLabel(db: Db, label: string): Promise<ClaimRow | undefined> {
  const { rows } = await db.query<ClaimSql>(
    `SELECT id, hf_namespace, label, address, challenge, expires_at, verified, created_at
     FROM claims WHERE label = $1 AND verified = TRUE LIMIT 1`,
    [label],
  );
  const row = rows[0];
  return row === undefined ? undefined : mapClaim(row);
}

export async function getCollision(
  db: Db,
  label: string,
  hfNamespace: string,
  nowIso: string,
): Promise<{ hfNamespace: string } | undefined> {
  const pending = await db.query<{ hf_namespace: unknown }>(
    `SELECT hf_namespace FROM claims
     WHERE label = $1 AND hf_namespace <> $2 AND verified = FALSE AND expires_at > $3
     LIMIT 1`,
    [label, hfNamespace, nowIso],
  );
  const pendingRow = pending.rows[0];
  if (pendingRow !== undefined) {
    return { hfNamespace: str(pendingRow.hf_namespace, "hf_namespace") };
  }
  const att = await db.query<{ hf_namespace: unknown }>(
    "SELECT hf_namespace FROM attestations WHERE label = $1 AND hf_namespace <> $2 LIMIT 1",
    [label, hfNamespace],
  );
  const attRow = att.rows[0];
  if (attRow !== undefined) {
    return { hfNamespace: str(attRow.hf_namespace, "hf_namespace") };
  }
  return undefined;
}

export async function insertReview(
  db: Db,
  row: Omit<ReviewRow, "id" | "createdAt"> & { createdAt: string },
): Promise<void> {
  await db.query(
    `INSERT INTO reviews (id, label, hf_namespace, existing_hf_namespace, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), row.label, row.hfNamespace, row.existingHfNamespace, row.reason, row.createdAt],
  );
}

export async function listReviews(db: Db, label?: string): Promise<ReviewRow[]> {
  const sql =
    label === undefined
      ? "SELECT id, label, hf_namespace, existing_hf_namespace, reason, created_at FROM reviews"
      : "SELECT id, label, hf_namespace, existing_hf_namespace, reason, created_at FROM reviews WHERE label = $1";
  const { rows } = await db.query<{
    id: unknown;
    label: unknown;
    hf_namespace: unknown;
    existing_hf_namespace: unknown;
    reason: unknown;
    created_at: unknown;
  }>(sql, label === undefined ? [] : [label]);
  return rows.map((row) => ({
    id: str(row.id, "id"),
    label: str(row.label, "label"),
    hfNamespace: str(row.hf_namespace, "hf_namespace"),
    existingHfNamespace: str(row.existing_hf_namespace, "existing_hf_namespace"),
    reason: str(row.reason, "reason"),
    createdAt: asIso(row.created_at),
  }));
}

export async function insertAttestation(db: Db, att: Attestation): Promise<void> {
  await db.query(
    `INSERT INTO attestations
      (claim_id, hf_namespace, label, address, repo, commit, signature, challenge, txs, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      att.claimId,
      att.hfNamespace,
      att.label,
      att.address,
      att.repo,
      att.commit,
      att.signature,
      att.challenge,
      JSON.stringify(att.txs),
      att.verifiedAt,
    ],
  );
  await db.query("UPDATE claims SET verified = TRUE WHERE id = $1", [att.claimId]);
}

export async function getAttestationByLabel(
  db: Db,
  label: string,
): Promise<Attestation | undefined> {
  const { rows } = await db.query<AttestationSql>(
    `SELECT claim_id, hf_namespace, label, address, repo, commit, signature, challenge, txs, verified_at
     FROM attestations WHERE label = $1`,
    [label],
  );
  const row = rows[0];
  return row === undefined ? undefined : mapAttestation(row);
}

export async function getAttestationByClaim(
  db: Db,
  claimId: string,
): Promise<Attestation | undefined> {
  const { rows } = await db.query<AttestationSql>(
    `SELECT claim_id, hf_namespace, label, address, repo, commit, signature, challenge, txs, verified_at
     FROM attestations WHERE claim_id = $1`,
    [claimId],
  );
  const row = rows[0];
  return row === undefined ? undefined : mapAttestation(row);
}
