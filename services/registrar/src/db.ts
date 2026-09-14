import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";

export type SqlRow = Record<string, unknown>;

/** Shared SQL surface for PGlite (local/test) and node-postgres (production). */
export interface Db {
  readonly driver: "pglite" | "pg";
  query<T extends SqlRow = SqlRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Choose the driver from `DATABASE_URL` (Postgres) vs PGlite. */
export function selectDriver(databaseUrl: string | undefined): "pg" | "pglite" {
  if (databaseUrl !== undefined && databaseUrl !== "") {
    return "pg";
  }
  return "pglite";
}

function schemaPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
}

/** Load `schema.sql` from next to this module (src in tests, dist after build). */
export function loadSchemaSql(): string {
  return readFileSync(schemaPath(), "utf8");
}

/** SPEC §7: apply claims / attestations / reviews DDL (idempotent). */
export async function applySchema(db: Db, sql = loadSchemaSql()): Promise<void> {
  await db.exec(sql);
}

/** SPEC §7: in-memory or directory-backed PGlite (local / CI). */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const pglite = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  return {
    driver: "pglite",
    async query<T extends SqlRow = SqlRow>(sql: string, params: unknown[] = []) {
      const result = await pglite.query<T>(sql, params);
      return { rows: result.rows };
    },
    async exec(sql: string) {
      await pglite.exec(sql);
    },
    async close() {
      await pglite.close();
    },
  };
}

/** SPEC §7: Postgres via `pg` when `DATABASE_URL` is set (production). */
export async function createPgDb(connectionString: string): Promise<Db> {
  const client = new Client({ connectionString });
  await client.connect();
  return {
    driver: "pg",
    async query<T extends SqlRow = SqlRow>(sql: string, params: unknown[] = []) {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
    async close() {
      await client.end();
    },
  };
}

/**
 * Open the registrar database. `DATABASE_URL` selects Postgres via `pg`;
 * otherwise PGlite (in-memory, or `PGLITE_DATA_DIR` when set).
 */
export async function createDb(
  opts: {
    databaseUrl?: string;
    pglitePath?: string;
  } = {},
): Promise<Db> {
  if (selectDriver(opts.databaseUrl) === "pg") {
    const url = opts.databaseUrl;
    if (url === undefined || url === "") {
      throw new Error("DATABASE_URL required for pg driver");
    }
    const db = await createPgDb(url);
    await applySchema(db);
    return db;
  }
  const db = await createPgliteDb(opts.pglitePath);
  await applySchema(db);
  return db;
}

/** SPEC §7: `DATABASE_URL` → Postgres; otherwise PGlite. */
export async function createDbFromEnv(): Promise<Db> {
  const databaseUrl = process.env.DATABASE_URL;
  const pglitePath = process.env.PGLITE_DATA_DIR;
  return createDb({
    ...(databaseUrl !== undefined && databaseUrl !== "" ? { databaseUrl } : {}),
    ...(pglitePath !== undefined && pglitePath !== "" ? { pglitePath } : {}),
  });
}

export function asIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
    return value;
  }
  throw new Error("expected timestamptz");
}

export function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}
