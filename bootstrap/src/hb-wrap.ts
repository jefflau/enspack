import { EnspackError, MAGNET_RE } from "@enspack/core";
import { HuggingBayClient, type HbFallbackInput } from "@enspack/hf";
import type { BootstrapHb } from "./deps.js";

/**
 * SPEC §8 step 6: wrap HuggingBayClient and add `sourceUrl`/`filePath` the live API requires.
 */
export function wrapHuggingBay(client: HuggingBayClient): BootstrapHb {
  return {
    resolve: (repo) => client.resolve(repo),
    lock: (id) => client.lock(id),
    async submitFallback(artifactId, input) {
      if (!MAGNET_RE.test(input.magnet)) {
        throw new EnspackError("PUBLISH", "magnet does not match MAGNET_RE");
      }
      const url = `${client.baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}/decentralized-fallbacks`;
      const body: HbFallbackInput & { sourceUrl?: string; filePath?: string; magnetUri: string; infoHash: string } =
        {
          magnet: input.magnet,
          displayName: input.displayName,
          infohash: input.infohash,
          magnetUri: input.magnet,
          infoHash: input.infohash,
        };
      if (input.sourceUrl !== undefined) body.sourceUrl = input.sourceUrl;
      if (input.filePath !== undefined) body.filePath = input.filePath;
      let res: Response;
      try {
        res = await client.fetchFn(url, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        throw new EnspackError("FETCH", `Hugging Bay fallback POST failed for ${artifactId}`, cause);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new EnspackError("PUBLISH", `Hugging Bay fallback ${artifactId} HTTP ${res.status}`);
      }
      try {
        return await res.json();
      } catch {
        return {};
      }
    },
  };
}
