import {
  ApiError,
  type Attestation,
  type ListNamesParams,
  type NameDetail,
  type NamesPage,
  type PublishersPage,
  type ViolationsPage,
} from "./api.js";

export interface IndexClient {
  listNames(params?: ListNamesParams): Promise<NamesPage>;
  getName(name: string): Promise<NameDetail>;
  listPublishers(): Promise<PublishersPage>;
  listViolations(): Promise<ViolationsPage>;
  /** Resolves to null on 404 (name not issued by the registrar). */
  getAttestation(label: string): Promise<Attestation | null>;
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new ApiError(0, "NETWORK", err instanceof Error ? err.message : "network error");
  }
  if (!res.ok) {
    let code = "HTTP";
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (typeof body.code === "string") code = body.code;
      if (typeof body.error === "string") message = body.error;
    } catch {
      // non-JSON error body: keep the status text
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export class HttpIndexClient implements IndexClient {
  private readonly indexUrl: string;
  private readonly registrarUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(indexUrl: string, registrarUrl: string, fetchImpl: typeof fetch = fetch) {
    this.indexUrl = indexUrl;
    this.registrarUrl = registrarUrl;
    this.fetchImpl = fetchImpl;
  }

  listNames(params: ListNamesParams = {}): Promise<NamesPage> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.publisher) qs.set("publisher", params.publisher);
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
    return getJson<NamesPage>(`${this.indexUrl}/v1/names${suffix}`, this.fetchImpl);
  }

  getName(name: string): Promise<NameDetail> {
    return getJson<NameDetail>(
      `${this.indexUrl}/v1/names/${encodeURIComponent(name)}`,
      this.fetchImpl,
    );
  }

  listPublishers(): Promise<PublishersPage> {
    return getJson<PublishersPage>(`${this.indexUrl}/v1/publishers`, this.fetchImpl);
  }

  listViolations(): Promise<ViolationsPage> {
    return getJson<ViolationsPage>(`${this.indexUrl}/v1/violations`, this.fetchImpl);
  }

  async getAttestation(label: string): Promise<Attestation | null> {
    try {
      return await getJson<Attestation>(
        `${this.registrarUrl}/v1/publishers/${encodeURIComponent(label)}`,
        this.fetchImpl,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }
}

export interface FixtureData {
  names: NamesPage;
  details: Record<string, NameDetail>;
  publishers: PublishersPage;
  violations: ViolationsPage;
  attestations: Record<string, Attestation>;
}

/** Serves recorded fixtures. Used by tests and by `VITE_DATA_SOURCE=demo`. */
export class FixtureIndexClient implements IndexClient {
  private readonly data: FixtureData;

  constructor(data: FixtureData) {
    this.data = data;
  }

  async listNames(params: ListNamesParams = {}): Promise<NamesPage> {
    let items = this.data.names.items;
    if (params.publisher) items = items.filter((i) => i.publisher === params.publisher);
    if (params.q) {
      const needle = params.q.toLowerCase();
      items = items.filter((i) => {
        const display = this.data.details[i.model]?.manifest.displayName ?? "";
        return (
          i.model.toLowerCase().includes(needle) ||
          i.upstream.toLowerCase().includes(needle) ||
          display.toLowerCase().includes(needle)
        );
      });
    }
    if (params.cursor) items = items.filter((i) => i.model > (params.cursor as string));
    const limit = params.limit ?? 50;
    const page = items.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      page.length === limit && items.length > page.length && last ? last.model : null;
    return { items: page, nextCursor };
  }

  async getName(name: string): Promise<NameDetail> {
    const direct = this.data.details[name];
    if (direct) return direct;
    for (const d of Object.values(this.data.details)) {
      if (d.versions.some((v) => v.name === name)) return d;
    }
    throw new ApiError(404, "NOT_FOUND", "unknown name");
  }

  async listPublishers(): Promise<PublishersPage> {
    return this.data.publishers;
  }

  async listViolations(): Promise<ViolationsPage> {
    return this.data.violations;
  }

  async getAttestation(label: string): Promise<Attestation | null> {
    return this.data.attestations[label] ?? null;
  }
}
