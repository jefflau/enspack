import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = "Qwen/Qwen2.5-7B-Instruct";
export const REVISION = "a09a35458c702b33eeacc393d103063234e8bc28";

export const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
export const exampleManifestPath = fileURLToPath(
  new URL("../../../examples/qwen--qwen2-5-7b-instruct.enspack.json", import.meta.url),
);

export function readFixture(rel: string): Buffer {
  return readFileSync(join(fixturesDir, rel));
}

export function readFixtureJson<T>(rel: string): T {
  return JSON.parse(readFixture(rel).toString("utf8")) as T;
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function bytesResponse(buf: Buffer, status = 200): Response {
  return new Response(buf, { status, headers: { "content-type": "application/octet-stream" } });
}

function stripStatus(payload: Record<string, unknown>): { status: number; body: unknown } {
  const { _status, ...rest } = payload;
  const status = typeof _status === "number" ? _status : 200;
  return { status, body: rest };
}

export function createReplayFetch(
  override?: (url: string, init?: RequestInit) => Response | undefined,
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const hit = override?.(url, init);
    if (hit) return hit;

    const parsed = new URL(url, "https://huggingface.co");
    const path = parsed.pathname;
    const isQwen =
      path.includes("/Qwen/Qwen2.5-7B-Instruct") || path.includes("/Qwen/Qwen2.5-7B-Instruct/");

    if (path.includes("/api/models/") && path.includes("/tree/")) {
      if (!isQwen) return new Response("not found", { status: 404 });
      return jsonResponse(readFixtureJson("hf/tree.json"));
    }
    if (path.includes("/api/models/") && path.includes("/revision/")) {
      if (!isQwen) return new Response("not found", { status: 404 });
      return jsonResponse(readFixtureJson("hf/revision.json"));
    }
    if (/\/api\/models\/[^/]+\/[^/]+$/.test(path)) {
      if (!isQwen) return new Response("not found", { status: 404 });
      return jsonResponse(readFixtureJson("hf/info.json"));
    }

    const resolveMatch = path.match(/^\/(.+)\/resolve\/([^/]+)\/(.+)$/);
    if (resolveMatch) {
      const filePath = decodeURIComponent(resolveMatch[3] ?? "");
      return bytesResponse(readFixture(`hf/files/${filePath}`));
    }

    if (path === "/api/resolve/hb") {
      const uri = parsed.searchParams.get("uri") ?? "";
      const rel = uri.includes("@sha256:") ? "hb/resolve-hb.json" : "hb/resolve-hb-no-digest.json";
      const { status, body } = stripStatus(readFixtureJson(rel));
      return jsonResponse(body, status);
    }
    if (path === "/api/resolve") {
      const { status, body } = stripStatus(readFixtureJson("hb/resolve-repo.json"));
      return jsonResponse(body, status);
    }
    if (path.endsWith("/lock")) {
      const { status, body } = stripStatus(readFixtureJson("hb/lock.json"));
      return jsonResponse(body, status);
    }
    if (path.endsWith("/decentralized-fallbacks")) {
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        const { status, body } = stripStatus(
          readFixtureJson("hb/decentralized-fallbacks-post.json"),
        );
        return jsonResponse(body, status);
      }
      const { status, body } = stripStatus(readFixtureJson("hb/decentralized-fallbacks-get.json"));
      return jsonResponse(body, status);
    }

    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  };
}
