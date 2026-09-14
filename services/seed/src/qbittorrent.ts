import { EnspackError } from "@enspack/core";

export type FetchLike = typeof fetch;

function joinUrl(base: string, pathAndQuery: string): string {
  return `${base.replace(/\/+$/, "")}${pathAndQuery}`;
}

/** qBittorrent `/api/v2/torrents/info` fields the seed API maps (MVP.md §4.2). */
export interface QbtTorrentInfo {
  hash: string;
  state: string;
  progress: number;
  num_seeds: number;
  num_leechs: number;
  uploaded: number;
}

export interface AddTorrentInput {
  metainfo: Uint8Array;
  savepath: string;
  category: string;
  tags: string;
}

export interface AddMagnetInput {
  magnet: string;
  savepath: string;
  category: string;
  tags: string;
}

/**
 * MVP.md WP-09: thin qBittorrent WebAPI client (`auth/login`, `torrents/add`, status, optional `addWebSeeds`).
 */
export interface QbittorrentClient {
  login(): Promise<void>;
  addTorrent(input: AddTorrentInput): Promise<void>;
  addMagnet(input: AddMagnetInput): Promise<void>;
  addWebSeeds(infohash: string, urls: string[]): Promise<boolean>;
  torrentInfo(infohash: string): Promise<QbtTorrentInfo | null>;
  appVersion(): Promise<string | null>;
  health(): Promise<boolean>;
}

export interface QbittorrentClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  fetch?: FetchLike;
}

function cookieHeader(setCookie: readonly string[]): string | null {
  const parts: string[] = [];
  for (const line of setCookie) {
    const pair = line.split(";", 1)[0];
    if (pair !== undefined && pair.length > 0) {
      parts.push(pair.trim());
    }
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function headersGetSetCookie(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single === null ? [] : [single];
}

/**
 * MVP.md WP-09: qBittorrent WebAPI v2 client. CSRF headers match the WebUI origin; SID is kept in memory.
 */
export function createQbittorrentClient(opts: QbittorrentClientOptions): QbittorrentClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  let cookie: string | null = null;

  function commonHeaders(extra?: Record<string, string>): Headers {
    const headers = new Headers(extra);
    headers.set("Referer", base);
    headers.set("Origin", base);
    if (cookie !== null) {
      headers.set("Cookie", cookie);
    }
    return headers;
  }

  async function login(): Promise<void> {
    let res: Response;
    try {
      res = await fetchImpl(joinUrl(base, "/api/v2/auth/login"), {
        method: "POST",
        headers: commonHeaders({ "content-type": "application/x-www-form-urlencoded" }),
        body: new URLSearchParams({ username: opts.username, password: opts.password }),
      });
    } catch (cause) {
      throw new EnspackError("DOWNLOAD", "qBittorrent login request failed", cause);
    }
    const text = await res.text();
    if (!res.ok || text.trim() === "Fails.") {
      throw new EnspackError("DOWNLOAD", `qBittorrent login failed (${res.status})`);
    }
    const next = cookieHeader(headersGetSetCookie(res.headers));
    if (next !== null) {
      cookie = next;
    }
  }

  async function ensureSession(): Promise<void> {
    if (cookie === null) {
      await login();
    }
  }

  async function postForm(path: string, body: FormData | URLSearchParams): Promise<Response> {
    await ensureSession();
    const headers = commonHeaders();
    return fetchImpl(joinUrl(base, path), { method: "POST", headers, body });
  }

  return {
    login,

    async addTorrent(input) {
      const form = new FormData();
      form.append(
        "torrents",
        new Blob([input.metainfo], { type: "application/x-bittorrent" }),
        "file.torrent",
      );
      form.append("savepath", input.savepath);
      form.append("category", input.category);
      form.append("tags", input.tags);
      let res: Response;
      try {
        res = await postForm("/api/v2/torrents/add", form);
      } catch (cause) {
        if (cause instanceof EnspackError) throw cause;
        throw new EnspackError("DOWNLOAD", "qBittorrent torrents/add failed", cause);
      }
      const text = (await res.text()).trim();
      if (!res.ok) {
        throw new EnspackError("DOWNLOAD", `qBittorrent torrents/add HTTP ${res.status}`);
      }
      const already = /already/i.test(text);
      if (text !== "" && text !== "Ok." && !already) {
        throw new EnspackError("DOWNLOAD", `qBittorrent torrents/add: ${text}`);
      }
    },

    async addMagnet(input) {
      const form = new FormData();
      form.append("urls", input.magnet);
      form.append("savepath", input.savepath);
      form.append("category", input.category);
      form.append("tags", input.tags);
      let res: Response;
      try {
        res = await postForm("/api/v2/torrents/add", form);
      } catch (cause) {
        if (cause instanceof EnspackError) throw cause;
        throw new EnspackError("DOWNLOAD", "qBittorrent magnet add failed", cause);
      }
      const text = (await res.text()).trim();
      if (!res.ok) {
        throw new EnspackError("DOWNLOAD", `qBittorrent torrents/add HTTP ${res.status}`);
      }
      const already = /already/i.test(text);
      if (text !== "" && text !== "Ok." && !already) {
        throw new EnspackError("DOWNLOAD", `qBittorrent torrents/add: ${text}`);
      }
    },

    async addWebSeeds(infohash, urls) {
      if (urls.length === 0) return false;
      const form = new URLSearchParams();
      form.set("hash", infohash);
      form.set("urls", urls.join("|"));
      let res: Response;
      try {
        res = await postForm("/api/v2/torrents/addWebSeeds", form);
      } catch {
        return false;
      }
      return res.ok;
    },

    async torrentInfo(infohash) {
      await ensureSession();
      const url = joinUrl(
        base,
        `/api/v2/torrents/info?hashes=${encodeURIComponent(infohash.toLowerCase())}`,
      );
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: commonHeaders() });
      } catch (cause) {
        throw new EnspackError("DOWNLOAD", "qBittorrent torrents/info failed", cause);
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new EnspackError("DOWNLOAD", `qBittorrent torrents/info HTTP ${res.status}`);
      }
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch (cause) {
        throw new EnspackError(
          "DOWNLOAD",
          "qBittorrent torrents/info returned invalid JSON",
          cause,
        );
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return null;
      }
      const row = parsed[0];
      if (typeof row !== "object" || row === null) {
        return null;
      }
      const rec = row as Record<string, unknown>;
      const hash = typeof rec.hash === "string" ? rec.hash : infohash;
      const state = typeof rec.state === "string" ? rec.state : "unknown";
      const progress = typeof rec.progress === "number" ? rec.progress : 0;
      const num_seeds = typeof rec.num_seeds === "number" ? rec.num_seeds : 0;
      const num_leechs = typeof rec.num_leechs === "number" ? rec.num_leechs : 0;
      const uploaded = typeof rec.uploaded === "number" ? rec.uploaded : 0;
      return { hash, state, progress, num_seeds, num_leechs, uploaded };
    },

    async appVersion() {
      await ensureSession();
      let res: Response;
      try {
        res = await fetchImpl(joinUrl(base, "/api/v2/app/version"), {
          headers: commonHeaders(),
        });
      } catch {
        return null;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      return (await res.text()).trim();
    },

    async health() {
      try {
        await login();
        const version = await fetchImpl(joinUrl(base, "/api/v2/app/version"), {
          headers: commonHeaders(),
        });
        return version.ok;
      } catch {
        return false;
      }
    },
  };
}

/** qBittorrent 5.x introduced `/api/v2/torrents/addWebSeeds` (MVP.md WP-09). */
export function isQbittorrent5(version: string | null): boolean {
  if (version === null) return false;
  const match = /v?(\d+)/.exec(version);
  const major = match?.[1];
  return major !== undefined && Number(major) >= 5;
}
