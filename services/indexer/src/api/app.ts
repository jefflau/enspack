import type { Manifest } from "@enspack/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { decodeNamesCursor, encodeNamesCursor } from "../cursor.js";
import type { IndexerReader, NameRow, VersionRow } from "../repo.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type NameListItem = {
  model: string;
  publisher: string;
  latest: { name: string; version: string; cid: string };
  upstream: string;
  license: string;
  totalSize: number;
};

export type NameDetail = {
  model: string;
  versions: Array<{ name: string; version: string; cid: string; createdAt: string }>;
  manifest: Manifest;
};

function jsonError(error: string, code: string): { error: string; code: string } {
  return { error, code };
}

function toListItem(row: NameRow): NameListItem {
  return {
    model: row.model,
    publisher: row.publisher,
    latest: { name: row.latestName, version: row.latestVersion, cid: row.latestCid },
    upstream: row.upstreamRepo,
    license: row.license,
    totalSize: row.totalSize,
  };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return DEFAULT_LIMIT;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("invalid limit");
  }
  return Math.min(n, MAX_LIMIT);
}

function preferName(rows: NameRow[]): NameRow | undefined {
  const mainnet = rows.find((r) => r.chain === "mainnet");
  if (mainnet !== undefined) {
    return mainnet;
  }
  return rows[0];
}

/**
 * MVP.md §4.3: JSON API for names, publishers, violations, and health.
 */
export function createIndexerApi(repo: IndexerReader): Hono {
  const app = new Hono();

  app.use("/v1/*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));

  app.get("/v1/health", (c) => c.json({ ok: true }));

  app.get("/v1/names", async (c) => {
    try {
      const limit = parseLimit(c.req.query("limit"));
      const publisher = c.req.query("publisher");
      const q = c.req.query("q");
      const cursorRaw = c.req.query("cursor");
      let after: string | undefined;
      if (cursorRaw !== undefined && cursorRaw !== "") {
        try {
          after = decodeNamesCursor(cursorRaw);
        } catch {
          return c.json(jsonError("invalid cursor", "INVALID"), 400);
        }
      }

      let rows = await repo.listNames();
      if (publisher !== undefined && publisher !== "") {
        rows = rows.filter((r) => r.publisher === publisher);
      }
      if (q !== undefined && q !== "") {
        const needle = q.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.model.toLowerCase().includes(needle) ||
            r.displayName.toLowerCase().includes(needle) ||
            r.upstreamRepo.toLowerCase().includes(needle),
        );
      }
      if (after !== undefined) {
        rows = rows.filter((r) => r.model > after);
      }

      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor =
        page.length === limit && last !== undefined && rows.length > page.length
          ? encodeNamesCursor(last.model)
          : null;
      return c.json({ items: page.map(toListItem), nextCursor });
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid request";
      if (message === "invalid limit") {
        return c.json(jsonError(message, "INVALID"), 400);
      }
      return c.json(jsonError(message, "INTERNAL"), 500);
    }
  });

  app.get("/v1/names/:name", async (c) => {
    const name = c.req.param("name");
    const names = await repo.listNames();
    const versions = await repo.listVersions();

    let nameRow = preferName(names.filter((r) => r.model === name));
    if (nameRow === undefined) {
      const versionRow = versions.find((r) => r.name === name);
      if (versionRow !== undefined) {
        nameRow = preferName(
          names.filter((r) => r.model === versionRow.model && r.chain === versionRow.chain),
        );
      }
    }
    if (nameRow === undefined) {
      return c.json(jsonError("unknown name", "NOT_FOUND"), 404);
    }

    const modelVersions: VersionRow[] = versions
      .filter((r) => r.model === nameRow.model && r.chain === nameRow.chain)
      .sort((a, b) => a.block - b.block);

    const latest =
      modelVersions.find((r) => r.cid === nameRow.latestCid) ??
      modelVersions[modelVersions.length - 1];
    if (latest === undefined) {
      return c.json(jsonError("unknown name", "NOT_FOUND"), 404);
    }

    let manifest: Manifest;
    try {
      manifest = JSON.parse(latest.manifestJson) as Manifest;
    } catch {
      return c.json(jsonError("invalid stored manifest", "INTERNAL"), 500);
    }

    const body: NameDetail = {
      model: nameRow.model,
      versions: modelVersions.map((r) => ({
        name: r.name,
        version: r.version,
        cid: r.cid,
        createdAt: r.createdAt,
      })),
      manifest,
    };
    return c.json(body);
  });

  app.get("/v1/publishers", async (c) => {
    const pubs = await repo.listPublishers();
    const names = await repo.listNames();
    const items = pubs.map((p) => ({
      name: p.name,
      hf: p.hf === "" ? null : p.hf,
      models: names.filter((n) => n.publisher === p.name && n.chain === p.chain).length,
    }));
    return c.json({ items });
  });

  app.get("/v1/violations", async (c) => {
    const rows = await repo.listViolations();
    return c.json({
      items: rows.map((r) => ({
        name: r.name,
        node: r.node,
        previousCid: r.previousCid,
        newCid: r.newCid,
        block: r.block,
      })),
    });
  });

  return app;
}
