import { onchainTable, primaryKey } from "ponder";

export const names = onchainTable(
  "names",
  (t) => ({
    model: t.text().notNull(),
    publisher: t.text().notNull(),
    chain: t.text().notNull(),
    latestName: t.text().notNull(),
    latestVersion: t.text().notNull(),
    latestCid: t.text().notNull(),
    upstreamRepo: t.text().notNull(),
    upstreamRevision: t.text().notNull(),
    license: t.text().notNull(),
    totalSize: t.doublePrecision().notNull(),
    displayName: t.text().notNull(),
    updatedBlock: t.integer().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.model, table.chain] }),
  }),
);

export const versions = onchainTable(
  "versions",
  (t) => ({
    name: t.text().notNull(),
    model: t.text().notNull(),
    chain: t.text().notNull(),
    node: t.hex().notNull(),
    version: t.text().notNull(),
    cid: t.text().notNull(),
    createdAt: t.text().notNull(),
    block: t.integer().notNull(),
    txHash: t.hex().notNull(),
    manifestJson: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.node, table.chain] }),
  }),
);

export const publishers = onchainTable(
  "publishers",
  (t) => ({
    name: t.text().notNull(),
    chain: t.text().notNull(),
    hf: t.text().notNull(),
    spec: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.name, table.chain] }),
  }),
);

export const violations = onchainTable(
  "violations",
  (t) => ({
    name: t.text().notNull(),
    node: t.hex().notNull(),
    chain: t.text().notNull(),
    previousCid: t.text().notNull(),
    newCid: t.text().notNull(),
    block: t.integer().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.node, table.chain, table.block, table.txHash] }),
  }),
);

export const nodes = onchainTable(
  "nodes",
  (t) => ({
    node: t.hex().notNull(),
    chain: t.text().notNull(),
    name: t.text().notNull(),
    hf: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.node, table.chain] }),
  }),
);

export const errors = onchainTable(
  "errors",
  (t) => ({
    node: t.hex().notNull(),
    chain: t.text().notNull(),
    reason: t.text().notNull(),
    block: t.integer().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.node, table.chain, table.block, table.txHash] }),
  }),
);
