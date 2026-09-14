import { EnspackError } from "@enspack/core";
import type { SeedNode } from "./deps.js";

/**
 * MVP.md §4.2: seed-node HTTP client (`POST /v1/seed`, `GET /v1/status/:infohash`).
 */
export function createSeedClient(baseUrl: string, fetchImpl: typeof fetch = fetch): SeedNode {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async seed(name: string) {
      let res: Response;
      try {
        res = await fetchImpl(`${base}/v1/seed`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ name }),
        });
      } catch (cause) {
        throw new EnspackError("FETCH", "seed node POST /v1/seed failed", cause);
      }
      if (res.status !== 202 && res.status !== 200) {
        throw new EnspackError("FETCH", `seed node POST /v1/seed HTTP ${res.status}`);
      }
      const body = (await res.json()) as { infohash?: string; state?: string };
      return { infohash: body.infohash ?? "", state: body.state ?? "" };
    },
    async status(infohash: string) {
      let res: Response;
      try {
        res = await fetchImpl(`${base}/v1/status/${encodeURIComponent(infohash)}`, {
          headers: { accept: "application/json" },
        });
      } catch (cause) {
        throw new EnspackError("FETCH", "seed node GET /v1/status failed", cause);
      }
      if (!res.ok) {
        throw new EnspackError("FETCH", `seed node GET /v1/status HTTP ${res.status}`);
      }
      const body = (await res.json()) as { progress?: number; state?: string };
      const status: { progress: number; state?: string } = { progress: body.progress ?? 0 };
      if (body.state !== undefined) status.state = body.state;
      return status;
    },
  };
}
