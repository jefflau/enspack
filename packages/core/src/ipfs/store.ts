import { manifestCid, parseCid } from "../cid.js";
import { DEFAULT_GATEWAYS, MANIFEST_MAX_BYTES } from "../constants.js";
import { EnspackError, isEnspackError } from "../error.js";
import { readCappedBytes } from "./capped.js";
import type { FetchLike } from "./pinners.js";
import type {
  GetVerifiedOpts,
  IpfsManifestStore,
  ManifestStoreOpts,
  PinContentType,
} from "./types.js";
import { extractFileBytes } from "./verify.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const ACCEPT_RAW = "application/vnd.ipld.raw";

function gatewayUrl(template: string, cid: string): string {
  const filled = template.replaceAll("{cid}", cid);
  const url = new URL(filled);
  url.searchParams.set("format", "raw");
  return url.href;
}

function formatFailures(failures: readonly { gateway: string; reason: string }[]): string {
  return `all gateways failed: ${failures.map((f) => `${f.gateway}: ${f.reason}`).join("; ")}`;
}

function causeCodes(err: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === "string") {
        codes.push(code);
      }
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return codes;
}

function fetchFailureReason(err: unknown, timeoutMs: number, timedOut: boolean): string {
  if (timedOut) {
    return `timeout after ${timeoutMs}ms`;
  }
  const codes = causeCodes(err);
  if (codes.includes("ECONNREFUSED")) {
    return "connection refused";
  }
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return `timeout after ${timeoutMs}ms`;
    }
    return err.message;
  }
  return "unknown error";
}

function pinMismatchMessage(pinnerName: string, localCid: string, remoteCid: string): string {
  return (
    `pinner ${pinnerName} returned CID ${remoteCid} !== local ${localCid}; ` +
    `pin succeeded under a different CID and getVerified(${remoteCid}) returns identical bytes`
  );
}

/**
 * SPEC §4 step 3 / MVP.md WP-03: verified IPFS fetch with gateway rotation (multiformats + dag-pb + UnixFS, not Helia) so `fetch` is injectable and nothing talks to the network at import.
 */
export function createManifestStore(opts: ManifestStoreOpts = {}): IpfsManifestStore {
  const fetchImpl: FetchLike = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxBytes = opts.maxBytes ?? MANIFEST_MAX_BYTES;
  const gateways = opts.gateways !== undefined ? [...opts.gateways] : [...DEFAULT_GATEWAYS];
  const pinner = opts.pinner;

  return {
    async getVerified(cidStr: string, getOpts: GetVerifiedOpts = {}): Promise<Uint8Array> {
      const cid = parseCid(cidStr);
      const cap = getOpts.maxBytes ?? defaultMaxBytes;
      const failures: { gateway: string; reason: string }[] = [];

      for (const template of gateways) {
        let url: string;
        try {
          url = gatewayUrl(template, cidStr);
        } catch (cause) {
          failures.push({
            gateway: template,
            reason: cause instanceof Error ? cause.message : "invalid gateway URL",
          });
          continue;
        }

        const ac = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          ac.abort();
        }, timeoutMs);

        try {
          const res = await fetchImpl(url, {
            headers: { Accept: ACCEPT_RAW },
            signal: ac.signal,
          });
          if (!res.ok) {
            await res.body?.cancel().catch(() => undefined);
            failures.push({ gateway: url, reason: `HTTP ${res.status}` });
            continue;
          }
          const bytes = await readCappedBytes(res, cap);
          const extracted = await extractFileBytes(cid, bytes);
          if (!extracted.ok) {
            failures.push({ gateway: url, reason: extracted.reason });
            if (extracted.fatal) {
              throw new EnspackError("FETCH", extracted.reason);
            }
            continue;
          }
          return extracted.data;
        } catch (cause) {
          if (
            isEnspackError(cause) &&
            cause.code === "FETCH" &&
            !cause.message.includes("exceeds cap")
          ) {
            throw cause;
          }
          if (isEnspackError(cause) && cause.message.includes("exceeds cap")) {
            failures.push({ gateway: url, reason: cause.message });
            continue;
          }
          failures.push({ gateway: url, reason: fetchFailureReason(cause, timeoutMs, timedOut) });
        } finally {
          clearTimeout(timer);
        }
      }

      throw new EnspackError("FETCH", formatFailures(failures));
    },

    async put(
      bytes: Uint8Array,
      contentType: PinContentType = "application/json",
    ): Promise<string> {
      const cid = await manifestCid(bytes);
      if (pinner === undefined) {
        throw new EnspackError("PUBLISH", "no pinner configured");
      }
      const remote = await pinner.pin(bytes, cid, contentType);
      if (remote !== cid) {
        throw new EnspackError("PUBLISH", pinMismatchMessage(pinner.name, cid, remote));
      }
      return cid;
    },
  };
}
