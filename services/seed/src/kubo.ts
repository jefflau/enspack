export type FetchLike = typeof fetch;

function joinUrl(base: string, pathAndQuery: string): string {
  return `${base.replace(/\/+$/, "")}${pathAndQuery}`;
}

export interface KuboClient {
  health(): Promise<boolean>;
}

export interface KuboClientOptions {
  apiUrl: string;
  fetch?: FetchLike;
}

/**
 * MVP.md WP-09: thin Kubo HTTP API client used for `/v1/health` (pins go through core `kuboPinner`).
 */
export function createKuboClient(opts: KuboClientOptions): KuboClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const apiUrl = opts.apiUrl;

  return {
    async health() {
      try {
        const res = await fetchImpl(joinUrl(apiUrl, "/api/v0/id"), { method: "POST" });
        await res.body?.cancel().catch(() => undefined);
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
