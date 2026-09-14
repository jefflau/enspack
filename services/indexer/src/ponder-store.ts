import { errors, names, nodes, publishers, versions, violations } from "../ponder.schema.js";
import type { IndexerReader, IndexerWriter, NameRow, NodeRow, VersionRow } from "./repo.js";

type Hex = `0x${string}`;

type InsertBuilder = {
  values: (row: Record<string, unknown>) => {
    onConflictDoUpdate: (row: Record<string, unknown>) => Promise<unknown>;
    onConflictDoNothing: () => Promise<unknown>;
  } & Promise<unknown>;
};

type StoreDb = {
  find: (table: never, pk: Record<string, string | number>) => Promise<unknown>;
  insert: (table: never) => InsertBuilder;
};

type SqlDb = {
  select: () => { from: (table: never) => Promise<unknown[]> };
};

function asName(row: unknown): NameRow | null {
  if (row === null || row === undefined) {
    return null;
  }
  return row as NameRow;
}

function asVersion(row: unknown): VersionRow | null {
  if (row === null || row === undefined) {
    return null;
  }
  return row as VersionRow;
}

function asNode(row: unknown): NodeRow | null {
  if (row === null || row === undefined) {
    return null;
  }
  return row as NodeRow;
}

/**
 * Adapt Ponder's indexing store API to {@link IndexerWriter}.
 * `db` is Ponder `context.db` (schema-generic); this adapter only calls find/insert.
 */
export function ponderStoreRepo(db: unknown): IndexerWriter {
  const store = db as StoreDb;
  return {
    async findVersionByNode(node, chain) {
      return asVersion(
        await store.find(versions as never, { node: node.toLowerCase() as Hex, chain }),
      );
    },
    async insertVersion(row) {
      await store.insert(versions as never).values({
        ...row,
        node: row.node.toLowerCase() as Hex,
        txHash: row.txHash.toLowerCase() as Hex,
      });
    },
    async findName(model, chain) {
      return asName(await store.find(names as never, { model, chain }));
    },
    async upsertName(row) {
      await store
        .insert(names as never)
        .values(row)
        .onConflictDoUpdate(row);
    },
    async findPublisher(name, chain) {
      const row = await store.find(publishers as never, { name, chain });
      if (row === null || row === undefined) {
        return null;
      }
      return row as { name: string; chain: string; hf: string; spec: string };
    },
    async upsertPublisher(row) {
      await store
        .insert(publishers as never)
        .values(row)
        .onConflictDoUpdate(row);
    },
    async findNode(node, chain) {
      return asNode(await store.find(nodes as never, { node: node.toLowerCase() as Hex, chain }));
    },
    async upsertNode(row) {
      await store
        .insert(nodes as never)
        .values({ ...row, node: row.node.toLowerCase() as Hex })
        .onConflictDoUpdate({
          name: row.name,
          hf: row.hf,
        });
    },
    async insertViolation(row) {
      await store
        .insert(violations as never)
        .values({
          ...row,
          node: row.node.toLowerCase() as Hex,
          txHash: row.txHash.toLowerCase() as Hex,
        })
        .onConflictDoNothing();
    },
    async insertError(row) {
      await store
        .insert(errors as never)
        .values({
          ...row,
          node: row.node.toLowerCase() as Hex,
          txHash: row.txHash.toLowerCase() as Hex,
        })
        .onConflictDoNothing();
    },
  };
}

/**
 * Adapt Ponder's Drizzle API db to {@link IndexerReader}.
 * `db` is `ponder:api`'s drizzle instance.
 */
export function ponderSqlReader(db: unknown): IndexerReader {
  const sql = db as SqlDb;
  return {
    async listNames() {
      return (await sql.select().from(names as never)) as NameRow[];
    },
    async listVersions() {
      return (await sql.select().from(versions as never)) as VersionRow[];
    },
    async listPublishers() {
      return (await sql.select().from(publishers as never)) as Array<{
        name: string;
        chain: string;
        hf: string;
        spec: string;
      }>;
    },
    async listViolations() {
      return (await sql.select().from(violations as never)) as Array<{
        name: string;
        node: string;
        chain: string;
        previousCid: string;
        newCid: string;
        block: number;
        txHash: string;
      }>;
    },
    async listErrors() {
      return (await sql.select().from(errors as never)) as Array<{
        node: string;
        chain: string;
        reason: string;
        block: number;
        txHash: string;
      }>;
    },
  };
}
