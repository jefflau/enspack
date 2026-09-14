import { EnspackError, MAGNET_RE } from "@enspack/core";
import { type FetchLike, readJson } from "./http.js";

/** Options for `HuggingBayClient` (SPEC §10). */
export interface HuggingBayClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

/**
 * Hugging Bay artifact identity. Observed 2026-09-14:
 * `GET /api/resolve/hb?uri=hb://{org}/{repo}` → 400 `invalid_hb_uri`
 * (requires `@sha256:{64-hex}`); `GET /api/resolve?repo={org}/{repo}` → 200.
 */
export interface HbArtifact {
  id: string;
  repo: string;
  uri?: string;
  digest?: string;
  raw: unknown;
}

/** One file in a Hugging Bay lock (SPEC §8 step 1). */
export interface HbLockFile {
  path: string;
  size: number;
  sha256: string;
}

/** Normalized lock plus the untouched payload (SPEC §8 step 1). */
export interface HbLock {
  files: HbLockFile[];
  raw: unknown;
}

/** Magnet submission for `POST /api/artifacts/{id}/decentralized-fallbacks` (SPEC §8 step 6). */
export interface HbFallbackInput {
  magnet: string;
  displayName: string;
  infohash: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function stripShaPrefix(value: string): string {
  return value.replace(/^sha256:/i, "").toLowerCase();
}

function parseLockFile(entry: unknown): HbLockFile | null {
  if (!entry || typeof entry !== "object") return null;
  const rec = entry as Record<string, unknown>;
  const path = asString(rec.path);
  const shaRaw = asString(rec.sha256);
  const size = asNumber(rec.size) ?? asNumber(rec.sizeBytes);
  if (!path || !shaRaw || size === undefined) return null;
  return { path, size, sha256: stripShaPrefix(shaRaw) };
}

function collectLockFiles(payload: unknown): HbLockFile[] {
  if (!payload || typeof payload !== "object") return [];
  const rec = payload as Record<string, unknown>;
  const direct = rec.files;
  if (Array.isArray(direct)) {
    return direct.map(parseLockFile).filter((f): f is HbLockFile => f !== null);
  }
  const artifacts = rec.artifacts;
  if (Array.isArray(artifacts)) {
    const files: HbLockFile[] = [];
    for (const artifact of artifacts) {
      if (!artifact || typeof artifact !== "object") continue;
      const inner = (artifact as Record<string, unknown>).files;
      if (!Array.isArray(inner)) continue;
      for (const entry of inner) {
        const parsed = parseLockFile(entry);
        if (parsed) files.push(parsed);
      }
    }
    return files;
  }
  return [];
}

function artifactFromPayload(payload: unknown): HbArtifact | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const nested =
    rec.artifact && typeof rec.artifact === "object"
      ? (rec.artifact as Record<string, unknown>)
      : undefined;
  const id = asString(rec.artifactId) ?? asString(rec.id) ?? asString(nested?.id);
  const repo = asString(rec.repo) ?? asString(nested?.repo);
  if (!id || !repo) return null;
  const uri = asString(rec.currentUri) ?? asString(rec.requestedUri);
  const digestRaw = asString(rec.currentDigest);
  const artifact: HbArtifact = { id, repo, raw: payload };
  if (uri !== undefined) artifact.uri = uri;
  if (digestRaw !== undefined) artifact.digest = stripShaPrefix(digestRaw);
  return artifact;
}

/**
 * Hugging Bay client. Responses are inputs to verification, not truth (SPEC §6, §10).
 */
export class HuggingBayClient {
  readonly baseUrl: string;
  readonly fetchFn: FetchLike;

  constructor(opts: HuggingBayClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://huggingbay.xyz").replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Resolve an HF repo to a Hugging Bay artifact. SPEC §10 `GET /api/resolve/hb?uri=`;
   * live API requires `@sha256:` so a repo-only URI falls back to `GET /api/resolve?repo=`.
   */
  async resolve(repo: string): Promise<HbArtifact | null> {
    const uri = repo.startsWith("hb://") ? repo : `hb://${repo}`;
    const hbUrl = `${this.baseUrl}/api/resolve/hb?uri=${encodeURIComponent(uri)}`;
    const hbRes = await this.#get(hbUrl);
    if (hbRes.status === 404) return null;
    if (hbRes.ok) {
      const payload = await readJson(hbRes);
      const artifact = artifactFromPayload(payload);
      if (artifact) return artifact;
      throw new EnspackError("FETCH", `Hugging Bay resolve/hb returned no artifact for ${repo}`);
    }
    // Observed 2026-09-14: 400 invalid_hb_uri without @sha256:{64-hex}. Fall back.
    if (hbRes.status === 400 && !uri.includes("@sha256:")) {
      const fallbackUrl = `${this.baseUrl}/api/resolve?repo=${encodeURIComponent(repo)}`;
      const fallbackRes = await this.#get(fallbackUrl);
      if (fallbackRes.status === 404) return null;
      if (!fallbackRes.ok) {
        throw new EnspackError("FETCH", `Hugging Bay resolve ${repo} HTTP ${fallbackRes.status}`);
      }
      const payload = await readJson(fallbackRes);
      const rec =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      if (rec.status === "not_found" || rec.status === "missing") return null;
      const artifact = artifactFromPayload(payload);
      if (!artifact) return null;
      return artifact;
    }
    throw new EnspackError("FETCH", `Hugging Bay resolve/hb ${repo} HTTP ${hbRes.status}`);
  }

  /**
   * Fetch a Hugging Bay lock. Observed 2026-09-14: `GET /api/artifacts/{id}/lock`
   * returns `{ artifacts: [{ files: [{ path, sha256, sizeBytes }] }] }` (SPEC §8 step 1).
   */
  async lock(artifactId: string): Promise<HbLock> {
    const url = `${this.baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}/lock`;
    const res = await this.#get(url);
    if (!res.ok) {
      throw new EnspackError("FETCH", `Hugging Bay lock ${artifactId} HTTP ${res.status}`);
    }
    const raw = await readJson(res);
    return { files: collectLockFiles(raw), raw };
  }

  /**
   * Submit a magnet as a decentralized fallback (SPEC §8 step 6). Observed 2026-09-14:
   * POST body `{magnet,displayName,infohash}` → 422 `peer_fallback_source_url_required`
   * (`sourceUrl` + `filePath` required; aliases `magnetUri` / `infoHash`).
   */
  async submitFallback(artifactId: string, input: HbFallbackInput): Promise<unknown> {
    if (!MAGNET_RE.test(input.magnet)) {
      throw new EnspackError("PUBLISH", "magnet does not match MAGNET_RE");
    }
    const url = `${this.baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}/decentralized-fallbacks`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          magnet: input.magnet,
          displayName: input.displayName,
          infohash: input.infohash,
          magnetUri: input.magnet,
          infoHash: input.infohash,
        }),
      });
    } catch (cause) {
      throw new EnspackError("FETCH", `Hugging Bay fallback POST failed for ${artifactId}`, cause);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new EnspackError("PUBLISH", `Hugging Bay fallback ${artifactId} HTTP ${res.status}`);
    }
    return readJson(res);
  }

  async #get(url: string): Promise<Response> {
    try {
      return await this.fetchFn(url, { headers: { accept: "application/json" } });
    } catch (cause) {
      throw new EnspackError("FETCH", `request failed for ${url}`, cause);
    }
  }
}
