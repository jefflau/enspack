-- SPEC §7 / MVP.md §4.1: registrar persistence.
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  hf_namespace TEXT NOT NULL,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS claims_label_idx ON claims (label);

CREATE TABLE IF NOT EXISTS attestations (
  claim_id TEXT PRIMARY KEY REFERENCES claims (id),
  hf_namespace TEXT NOT NULL,
  label TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  repo TEXT NOT NULL,
  commit TEXT NOT NULL,
  signature TEXT NOT NULL,
  challenge TEXT NOT NULL,
  txs TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  hf_namespace TEXT NOT NULL,
  existing_hf_namespace TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS reviews_label_idx ON reviews (label);
