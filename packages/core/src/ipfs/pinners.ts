import { EnspackError } from "../error.js";
import type { PinContentType, Pinner } from "./types.js";

const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

export type FetchLike = typeof fetch;

function joinUrl(base: string, pathAndQuery: string): string {
  return `${base.replace(/\/+$/, "")}${pathAndQuery}`;
}

function filenameFor(contentType: PinContentType): string {
  return contentType === "application/x-bittorrent" ? "file.torrent" : "enspack.json";
}

async function readJsonObject(res: Response, source: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (cause) {
    throw new EnspackError("PUBLISH", `invalid JSON from ${source}`, cause);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EnspackError("PUBLISH", `invalid JSON from ${source}`);
  }
  return parsed as Record<string, unknown>;
}

function stringField(obj: Record<string, unknown>, key: string, source: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value === "") {
    throw new EnspackError("PUBLISH", `${source} response missing ${key}`);
  }
  return value;
}

function fileForm(bytes: Uint8Array, contentType: PinContentType): FormData {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), filenameFor(contentType));
  return form;
}

/**
 * SPEC §8 steps 3–4: pin a raw sha2-256 block via Kubo `block/put` (`--pin kubo` is a raw-CID path).
 */
export function kuboPinner(opts: { apiUrl: string; fetch?: FetchLike }): Pinner {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  return {
    name: "kubo",
    async pin(bytes, _cid, contentType) {
      const url = joinUrl(opts.apiUrl, "/api/v0/block/put?cid-codec=raw&mhtype=sha2-256&pin=true");
      let res: Response;
      try {
        res = await fetchImpl(url, { method: "POST", body: fileForm(bytes, contentType) });
      } catch (cause) {
        throw new EnspackError("PUBLISH", "kubo pin request failed", cause);
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new EnspackError("PUBLISH", `kubo pin HTTP ${res.status}`);
      }
      const json = await readJsonObject(res, "kubo");
      return stringField(json, "Key", "kubo");
    },
  };
}

/**
 * SPEC §8 steps 3–4: pin via Pinata (best-effort redundancy; UnixFS dag-pb CID will not equal the raw CID — prefer `--pin kubo|seed`).
 *
 * The JWT is passed in by the caller (CLI reads `PINATA_JWT`); this adapter never reads env or logs the token.
 * Pinata wraps files as UnixFS dag-pb (`bafybei…`), so `put` will normally throw PUBLISH after a successful pin.
 */
export function pinataPinner(opts: { jwt: string; fetch?: FetchLike }): Pinner {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  return {
    name: "pinata",
    async pin(bytes, _cid, contentType) {
      const form = fileForm(bytes, contentType);
      form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
      let res: Response;
      try {
        res = await fetchImpl(PINATA_PIN_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.jwt}` },
          body: form,
        });
      } catch (cause) {
        throw new EnspackError("PUBLISH", "pinata pin request failed", cause);
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new EnspackError("PUBLISH", `pinata pin HTTP ${res.status}`);
      }
      const json = await readJsonObject(res, "pinata");
      return stringField(json, "IpfsHash", "pinata");
    },
  };
}

/**
 * MVP.md §4.2 / SPEC §8 steps 3–4: pin via seed node `POST /v1/pin` (`--pin seed` is a raw-CID path).
 */
export function seedNodePinner(opts: { baseUrl: string; fetch?: FetchLike }): Pinner {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  return {
    name: "seed",
    async pin(bytes, _cid, contentType) {
      const url = joinUrl(opts.baseUrl, "/v1/pin");
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": contentType },
          body: bytes,
        });
      } catch (cause) {
        throw new EnspackError("PUBLISH", "seed node pin request failed", cause);
      }
      if (res.status === 413 || res.status === 422) {
        const json = await readJsonObject(res, "seed node");
        throw new EnspackError(
          "PUBLISH",
          `seed node ${res.status}: ${String(json.error)} (${String(json.code)})`,
        );
      }
      if (res.status !== 201) {
        await res.body?.cancel().catch(() => undefined);
        throw new EnspackError("PUBLISH", `seed node pin HTTP ${res.status}`);
      }
      const json = await readJsonObject(res, "seed node");
      return stringField(json, "cid", "seed node");
    },
  };
}
