import {
  type EnsVersion,
  type EnspackChainName,
  EnspackError,
  type IpfsManifestStore,
  LICENSE_ALLOWLIST,
  MAGNET_RE,
  MANIFEST_MAX_BYTES,
  type Pinner,
  type Resolved,
  type Resolver,
  TORRENT_MAX_BYTES,
  ensVersionFor,
  fetchTorrentVerified,
  isEnspackError,
  manifestCid,
  validateManifest,
} from "@enspack/core";
import { injectWebseeds, metainfoMatchesManifest, parseTorrent } from "@enspack/torrent";
import { Hono } from "hono";
import { mediaType, readCappedRequest } from "./body.js";
import type { KuboClient } from "./kubo.js";
import { checkAllowRoots, checkLicense, checkQuota } from "./policy.js";
import { type QbittorrentClient, isQbittorrent5 } from "./qbittorrent.js";
import { findByName, loadState, quotaUsedByPublisher, upsertRecord } from "./state.js";

export interface SeedLogEvent {
  ts: string;
  method: string;
  path: string;
  status: number;
  ms: number;
}

/** MVP.md §4.2: injectable collaborators for `createApp` (tests swap resolver/store/qbt/kubo). */
export interface SeedAppDeps {
  resolver: Resolver;
  store: IpfsManifestStore;
  qbt: QbittorrentClient;
  kubo: KuboClient;
  pinner: Pinner;
  allowRoots: readonly string[];
  licenseAllowlist?: readonly string[];
  quotaBytesPerPublisher: number;
  downloadDir: string;
  chain: EnspackChainName;
  ensVersion?: EnsVersion;
  fetch?: typeof fetch;
  now?: () => Date;
  log?: (event: SeedLogEvent) => void;
}

const INFOHASH_RE = /^[0-9a-fA-F]{40}$/;
const PIN_JSON = "application/json";
const PIN_TORRENT = "application/x-bittorrent";

function jsonError(
  error: string,
  code: string,
  status: 400 | 403 | 404 | 413 | 415 | 422 | 500 | 502,
): Response {
  return Response.json({ error, code }, { status });
}

function mapEnspack(err: EnspackError): Response {
  switch (err.code) {
    case "RESOLVE":
      return jsonError(err.message, "RESOLVE", 404);
    case "POLICY":
      return jsonError(err.message, "POLICY", 403);
    case "VERIFY":
      return jsonError(err.message, "VERIFY", 422);
    case "PUBLISH":
      return jsonError(err.message, "PUBLISH", 500);
    case "FETCH":
      return jsonError(err.message, "FETCH", 502);
    case "DOWNLOAD":
      return jsonError(err.message, "DOWNLOAD", 502);
    case "LOCK":
      return jsonError(err.message, "LOCK", 422);
    default:
      return jsonError(err.message, err.code, 500);
  }
}

function mapUnknown(err: unknown): Response {
  if (isEnspackError(err)) return mapEnspack(err);
  const message = err instanceof Error ? err.message : "internal error";
  return jsonError(message, "INTERNAL", 500);
}

function defaultLog(event: SeedLogEvent): void {
  console.error(JSON.stringify(event));
}

/**
 * MVP.md §4.2 Seed node HTTP contract: `/v1/seed`, `/v1/pin`, `/v1/status/:infohash`, `/v1/health`.
 */
export function createApp(deps: SeedAppDeps): Hono {
  const app = new Hono();
  const allowlist = deps.licenseAllowlist ?? LICENSE_ALLOWLIST;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? defaultLog;
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  app.use(async (c, next) => {
    const start = Date.now();
    await next();
    log({
      ts: now().toISOString(),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - start,
    });
  });

  app.post("/v1/seed", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError("invalid JSON body", "BAD_REQUEST", 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return jsonError("body must be an object", "BAD_REQUEST", 400);
    }
    const nameVal = (body as { name?: unknown }).name;
    if (typeof nameVal !== "string" || nameVal.trim() === "") {
      return jsonError("name is required", "BAD_REQUEST", 400);
    }
    const name = nameVal.trim();

    try {
      const existing = await findByName(deps.downloadDir, name);
      if (existing !== undefined) {
        const live = await deps.qbt.torrentInfo(existing.infohash).catch(() => null);
        const state = live?.state ?? existing.state;
        return Response.json({ infohash: existing.infohash, state }, { status: 202 });
      }

      let resolved: Resolved;
      try {
        resolved = await deps.resolver.resolve(name);
      } catch (err) {
        return mapUnknown(err);
      }

      const manifest = resolved.manifest;
      const manifestBytes = resolved.manifestBytes;
      if (manifest === null || manifestBytes === null || resolved.cid === null) {
        return jsonError("resolved name has no verified manifest", "VERIFY", 422);
      }

      checkAllowRoots(manifest.publisher, deps.allowRoots);
      checkLicense(manifest.license, allowlist);
      const disk = await loadState(deps.downloadDir);
      checkQuota(
        manifest.publisher,
        quotaUsedByPublisher(disk, manifest.publisher),
        manifest.totalSize,
        deps.quotaBytesPerPublisher,
      );

      let metainfo: Uint8Array | null;
      try {
        metainfo = await fetchTorrentVerified(deps.store, manifest, fetchImpl);
      } catch (err) {
        return mapUnknown(err);
      }

      const infohash = manifest.distribution.infohash.toLowerCase();
      let seedState: string;

      if (metainfo === null) {
        const magnet = manifest.distribution.magnet;
        if (!MAGNET_RE.test(magnet)) {
          return jsonError("magnet does not match MAGNET_RE", "VERIFY", 422);
        }
        await deps.qbt.addMagnet({
          magnet,
          savepath: deps.downloadDir,
          category: "enspack",
          tags: manifest.publisher,
        });
        seedState = "metadata";
      } else {
        const parsed = await parseTorrent(metainfo);
        if (parsed.infohash !== infohash) {
          return jsonError("torrent infohash does not match distribution.infohash", "VERIFY", 422);
        }
        metainfoMatchesManifest(parsed, manifest);
        const forQbt = await injectWebseeds(metainfo, manifest.distribution.webseeds);
        await deps.qbt.addTorrent({
          metainfo: forQbt,
          savepath: deps.downloadDir,
          category: "enspack",
          tags: manifest.publisher,
        });
        const version = await deps.qbt.appVersion();
        if (isQbittorrent5(version) && manifest.distribution.webseeds.length > 0) {
          await deps.qbt.addWebSeeds(infohash, manifest.distribution.webseeds);
        }
        seedState = "downloading";
      }

      const pinnedManifest = await deps.pinner.pin(manifestBytes, resolved.cid, "application/json");
      if (pinnedManifest !== resolved.cid) {
        return jsonError(`kubo manifest CID ${pinnedManifest} !== ${resolved.cid}`, "PUBLISH", 500);
      }

      if (metainfo !== null) {
        const expectedTorrentCid = manifest.distribution.torrent?.cid;
        const localTorrentCid = await manifestCid(metainfo);
        const pinnedTorrent = await deps.pinner.pin(
          metainfo,
          expectedTorrentCid ?? localTorrentCid,
          "application/x-bittorrent",
        );
        if (expectedTorrentCid !== undefined && pinnedTorrent !== expectedTorrentCid) {
          return jsonError(
            `kubo torrent CID ${pinnedTorrent} !== ${expectedTorrentCid}`,
            "PUBLISH",
            500,
          );
        }
        if (expectedTorrentCid === undefined && pinnedTorrent !== localTorrentCid) {
          return jsonError(
            `kubo torrent CID ${pinnedTorrent} !== ${localTorrentCid}`,
            "PUBLISH",
            500,
          );
        }
      }

      const live = await deps.qbt.torrentInfo(infohash).catch(() => null);
      const state = live?.state ?? seedState;
      await upsertRecord(deps.downloadDir, {
        name,
        publisher: manifest.publisher,
        infohash,
        totalSize: manifest.totalSize,
        state,
        addedAt: now().toISOString(),
      });
      return Response.json({ infohash, state }, { status: 202 });
    } catch (err) {
      return mapUnknown(err);
    }
  });

  app.post("/v1/pin", async (c) => {
    const type = mediaType(c.req.header("content-type"));
    if (type !== PIN_JSON && type !== PIN_TORRENT) {
      return jsonError(
        "content-type must be application/json or application/x-bittorrent",
        "UNSUPPORTED_MEDIA_TYPE",
        415,
      );
    }
    const cap = type === PIN_JSON ? MANIFEST_MAX_BYTES : TORRENT_MAX_BYTES;
    let bytes: Uint8Array;
    try {
      bytes = await readCappedRequest(c.req.raw, cap);
    } catch (err) {
      if (isEnspackError(err) && err.code === "PUBLISH" && err.message.includes("exceeds cap")) {
        return jsonError(err.message, "TOO_LARGE", 413);
      }
      return mapUnknown(err);
    }

    try {
      if (type === PIN_JSON) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch (cause) {
          throw new EnspackError("VERIFY", "pin body is not valid JSON", cause);
        }
        validateManifest(parsed);
      } else {
        await parseTorrent(bytes);
      }
    } catch (err) {
      return mapUnknown(err);
    }

    const expected = await manifestCid(bytes);
    let remote: string;
    try {
      remote = await deps.pinner.pin(bytes, expected, type);
    } catch (err) {
      return mapUnknown(err);
    }
    if (remote !== expected) {
      return jsonError(`kubo CID ${remote} !== local ${expected}`, "PUBLISH", 500);
    }
    return Response.json({ cid: expected }, { status: 201 });
  });

  app.get("/v1/status/:infohash", async (c) => {
    const infohash = c.req.param("infohash");
    if (!INFOHASH_RE.test(infohash)) {
      return jsonError("infohash must be 40 hex characters", "BAD_REQUEST", 400);
    }
    try {
      const info = await deps.qbt.torrentInfo(infohash.toLowerCase());
      if (info === null) {
        return jsonError("unknown infohash", "NOT_FOUND", 404);
      }
      return Response.json({
        state: info.state,
        progress: info.progress,
        peers: info.num_seeds + info.num_leechs,
        uploaded: info.uploaded,
      });
    } catch (err) {
      return mapUnknown(err);
    }
  });

  app.get("/v1/health", async (c) => {
    const [qbittorrent, kubo] = await Promise.all([deps.qbt.health(), deps.kubo.health()]);
    return c.json({
      ok: true,
      qbittorrent,
      kubo,
      chain: deps.chain,
      ensVersion: deps.ensVersion ?? ensVersionFor(deps.chain),
    });
  });

  return app;
}
