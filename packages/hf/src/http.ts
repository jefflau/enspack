import { EnspackError } from "@enspack/core";

/** Default download cap for non-LFS hashing (SPEC §8 step 1). */
export const DOWNLOAD_CAP_BYTES = 64 * 1024 * 1024;

/** Injectable `fetch` used so tests replay fixtures with zero network. */
export type FetchLike = typeof fetch;

/** Parse RFC 5988 `Link: <url>; rel="next"` from the HF tree API. */
export function parseLinkNext(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(part);
    const href = match?.[1];
    if (href) return href;
  }
  return null;
}

export function encodePathSegments(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function resolveUrl(href: string, base: string): string {
  return new URL(href, base).href;
}

export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch (cause) {
    throw new EnspackError("FETCH", `invalid JSON from ${res.url}`, cause);
  }
}

export async function readCappedBytes(
  res: Response,
  cap = DOWNLOAD_CAP_BYTES,
): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    throw new EnspackError(
      "FETCH",
      `response larger than ${cap} bytes (${declared}) from ${res.url}`,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > cap) {
    throw new EnspackError(
      "FETCH",
      `response larger than ${cap} bytes (${buf.byteLength}) from ${res.url}`,
    );
  }
  return buf;
}

export function bearerHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
