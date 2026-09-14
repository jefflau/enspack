import { createHash } from "node:crypto";
import { EnspackError, type ManifestFile } from "@enspack/core";
import {
  DOWNLOAD_CAP_BYTES,
  type FetchLike,
  bearerHeaders,
  encodePathSegments,
  parseLinkNext,
  readCappedBytes,
  readJson,
  resolveUrl,
} from "./http.js";
import { type LicenseGateOptions, licenseGate } from "./license.js";
import { assertManifestPath, fileRole, sortByPath } from "./path.js";

/** Options for `HfClient` (SPEC §8). `HF_TOKEN` is read from env when `token` is omitted. */
export interface HfClientOptions {
  baseUrl?: string;
  token?: string;
  fetch?: FetchLike;
}

/** Hugging Face LFS pointer (`lfs.oid` is SHA-256) from the tree API (SPEC §8 step 1). */
export interface HfLfsPointer {
  oid: string;
  size: number;
  pointerSize: number;
}

/** File entry from `GET /api/models/{repo}/tree/{revision}` (directories omitted). */
export interface HfTreeEntry {
  path: string;
  size: number;
  oid: string;
  lfs?: HfLfsPointer;
}

/** Model card fields used for gating and license checks (BOOTSTRAP.md §2). */
export interface HfModelInfo {
  gated: boolean | string;
  private: boolean;
  license: string | null;
  sha: string;
  cardData: Record<string, unknown> | null;
}

interface HfTreeApiEntry {
  type?: string;
  path?: unknown;
  size?: unknown;
  oid?: unknown;
  lfs?: {
    oid?: unknown;
    size?: unknown;
    pointerSize?: unknown;
  };
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cardLicense(cardData: Record<string, unknown> | null): string | null {
  const raw = cardData?.license;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return raw.trim().toLowerCase();
}

/**
 * Hugging Face Hub client. Hosts are untrusted; hashes are checked locally (SPEC §6, §8).
 */
export class HfClient {
  readonly baseUrl: string;
  readonly fetchFn: FetchLike;
  readonly #token: string | undefined;

  constructor(opts: HfClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://huggingface.co").replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#token = opts.token ?? process.env.HF_TOKEN;
  }

  /**
   * Recursive file tree at a revision; follows `Link: rel="next"` (SPEC §8 step 1).
   */
  async tree(repo: string, revision: string): Promise<HfTreeEntry[]> {
    const encoded = encodePathSegments(repo);
    let url: string | undefined =
      `${this.baseUrl}/api/models/${encoded}/tree/${encodeURIComponent(revision)}?recursive=true`;
    const files: HfTreeEntry[] = [];

    while (url) {
      const res = await this.#request(url);
      if (!res.ok) {
        throw new EnspackError("FETCH", `HF tree ${repo}@${revision} HTTP ${res.status}`);
      }
      const body = await readJson(res);
      if (!Array.isArray(body)) {
        throw new EnspackError("FETCH", `HF tree ${repo}@${revision} is not an array`);
      }
      for (const item of body as HfTreeApiEntry[]) {
        if (item.type !== undefined && item.type !== "file") continue;
        const path = asString(item.path);
        const oid = asString(item.oid);
        const size = asNumber(item.size);
        if (!path || oid === undefined || size === undefined) continue;
        const entry: HfTreeEntry = { path, size, oid };
        const lfsOid = asString(item.lfs?.oid);
        const lfsSize = asNumber(item.lfs?.size);
        if (lfsOid && lfsSize !== undefined) {
          entry.lfs = {
            oid: lfsOid,
            size: lfsSize,
            pointerSize: asNumber(item.lfs?.pointerSize) ?? 0,
          };
        }
        files.push(entry);
      }
      const next = parseLinkNext(res.headers.get("Link") ?? res.headers.get("link"));
      url = next ? resolveUrl(next, url) : undefined;
    }

    return files;
  }

  /** Full 40-hex commit SHA for a branch, tag, or short ref (SPEC §3, §8). */
  async resolveRevision(repo: string, ref = "main"): Promise<string> {
    const encoded = encodePathSegments(repo);
    const url = `${this.baseUrl}/api/models/${encoded}/revision/${encodeURIComponent(ref)}`;
    const res = await this.#request(url);
    if (!res.ok) {
      throw new EnspackError("FETCH", `HF revision ${repo}@${ref} HTTP ${res.status}`);
    }
    const body = (await readJson(res)) as { sha?: unknown };
    const sha = asString(body.sha)?.toLowerCase();
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
      throw new EnspackError("FETCH", `HF revision ${repo}@${ref} missing 40-hex sha`);
    }
    return sha;
  }

  /** Model card + gating flags from `GET /api/models/{repo}` (BOOTSTRAP.md §2). */
  async info(repo: string): Promise<HfModelInfo> {
    const encoded = encodePathSegments(repo);
    const url = `${this.baseUrl}/api/models/${encoded}`;
    const res = await this.#request(url);
    if (!res.ok) {
      throw new EnspackError("FETCH", `HF info ${repo} HTTP ${res.status}`);
    }
    const body = (await readJson(res)) as {
      gated?: unknown;
      private?: unknown;
      sha?: unknown;
      cardData?: unknown;
    };
    const cardData =
      body.cardData && typeof body.cardData === "object" && !Array.isArray(body.cardData)
        ? (body.cardData as Record<string, unknown>)
        : null;
    const gated = body.gated;
    return {
      gated: typeof gated === "boolean" || typeof gated === "string" ? gated : false,
      private: body.private === true,
      license: cardLicense(cardData),
      sha: asString(body.sha)?.toLowerCase() ?? "",
      cardData,
    };
  }

  /** SPDX id from `cardData.license`, lowercased, or null (BOOTSTRAP.md §2). */
  async license(repo: string): Promise<string | null> {
    const info = await this.info(repo);
    return info.license;
  }

  /**
   * Download a single file for local hashing. Size-capped at 64 MiB; LFS weights
   * must use `lfs.oid` instead (SPEC §8 step 1).
   */
  async download(repo: string, revision: string, path: string): Promise<Uint8Array> {
    const encodedRepo = encodePathSegments(repo);
    const encodedPath = encodePathSegments(path);
    const url = `${this.baseUrl}/${encodedRepo}/resolve/${encodeURIComponent(revision)}/${encodedPath}`;
    const res = await this.#request(url);
    if (!res.ok) {
      throw new EnspackError("FETCH", `HF download ${repo}@${revision}:${path} HTTP ${res.status}`);
    }
    return readCappedBytes(res, DOWNLOAD_CAP_BYTES);
  }

  /**
   * Build `files[]` from the HF tree: LFS oid/size, otherwise download+SHA-256 (SPEC §8 step 1).
   */
  async buildFiles(repo: string, revision: string): Promise<ManifestFile[]> {
    const entries = await this.tree(repo, revision);
    const files: ManifestFile[] = [];
    for (const entry of entries) {
      assertManifestPath(entry.path);
      let size: number;
      let sha256: string;
      if (entry.lfs) {
        sha256 = entry.lfs.oid.toLowerCase();
        size = entry.lfs.size;
      } else {
        const bytes = await this.download(repo, revision, entry.path);
        sha256 = sha256Hex(bytes);
        size = bytes.byteLength;
      }
      if (!/^[0-9a-f]{64}$/.test(sha256)) {
        throw new EnspackError("VERIFY", `invalid sha256 for ${entry.path}`);
      }
      files.push({ path: entry.path, size, sha256, role: fileRole(entry.path) });
    }
    return sortByPath(files);
  }

  /**
   * Refuse a missing or non-allowlisted license unless `override` is set
   * (BOOTSTRAP.md §2 rule 2; SPEC §11 `--i-have-redistribution-rights`).
   */
  licenseGate(license: string | null | undefined, opts?: LicenseGateOptions): void {
    licenseGate(license, opts ?? {});
  }

  async #request(url: string): Promise<Response> {
    try {
      return await this.fetchFn(url, { headers: bearerHeaders(this.#token) });
    } catch (cause) {
      throw new EnspackError("FETCH", `request failed for ${url}`, { cause });
    }
  }
}
