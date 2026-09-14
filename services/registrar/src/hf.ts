import { EnspackError } from "@enspack/core";
import { type FetchLike, HfClient } from "@enspack/hf";
import { HttpError } from "./http-error.js";

export type RepoKind = "model" | "dataset" | "space";

export type HfRepoInfo = {
  kind: RepoKind;
  id: string;
  author: string;
  sha: string;
  private: boolean;
  gated: boolean | string;
};

const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

function encodePath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function authorOf(id: string, author: string | undefined): string {
  if (author !== undefined && author !== "") {
    return author;
  }
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

function isPrivateGated(info: Pick<HfRepoInfo, "private" | "gated">): boolean {
  if (info.private) {
    return true;
  }
  return false;
}

/**
 * Parse `<hfNamespace>/<name>` and require the author label to match the claim.
 * Author mismatch is 403 `AUTHOR_MISMATCH` (authorization, not a bad signature).
 */
export function parseRepo(repo: unknown, hfNamespace: string): { repo: string; name: string } {
  if (typeof repo !== "string" || !REPO_RE.test(repo) || repo.includes("..")) {
    throw new HttpError(400, "INVALID_REPO", "repo must be <hfNamespace>/<name>");
  }
  const slash = repo.indexOf("/");
  const author = repo.slice(0, slash);
  const name = repo.slice(slash + 1);
  if (author !== hfNamespace) {
    throw new HttpError(403, "AUTHOR_MISMATCH", "repo author must equal hfNamespace");
  }
  if (name === "") {
    throw new HttpError(400, "INVALID_REPO", "repo must be <hfNamespace>/<name>");
  }
  return { repo, name };
}

function parseApiBody(kind: RepoKind, repo: string, body: unknown): HfRepoInfo {
  const rec = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const id = asString(rec.id) ?? asString(rec.modelId) ?? repo;
  const sha = asString(rec.sha)?.toLowerCase() ?? "";
  const gated = rec.gated;
  return {
    kind,
    id,
    author: authorOf(id, asString(rec.author)),
    sha,
    private: rec.private === true,
    gated: typeof gated === "boolean" || typeof gated === "string" ? gated : false,
  };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new HttpError(502, "HF_ERROR", "invalid JSON from Hugging Face");
  }
}

/**
 * SPEC §7 step 4: look up a public HF model (via `@enspack/hf` `HfClient.info`),
 * dataset, or space with injectable `fetch`.
 */
export async function lookupHfRepo(
  fetchFn: FetchLike,
  repo: string,
  opts: { baseUrl?: string; token?: string } = {},
): Promise<HfRepoInfo> {
  const baseUrl = (opts.baseUrl ?? "https://huggingface.co").replace(/\/+$/, "");
  const models = new HfClient({
    fetch: fetchFn,
    baseUrl,
    ...(opts.token !== undefined ? { token: opts.token } : {}),
  });
  try {
    const info = await models.info(repo);
    return {
      kind: "model",
      id: repo,
      author: authorOf(repo, undefined),
      sha: info.sha,
      private: info.private,
      gated: info.gated,
    };
  } catch (err) {
    if (!(err instanceof EnspackError) || err.code !== "FETCH") {
      throw err;
    }
  }

  for (const [kind, path] of [
    ["dataset", "datasets"],
    ["space", "spaces"],
  ] as const) {
    const url = `${baseUrl}/api/${path}/${encodePath(repo)}`;
    const res = await fetchFn(url);
    if (res.status === 404) {
      continue;
    }
    if (!res.ok) {
      throw new HttpError(502, "HF_ERROR", `Hugging Face ${kind} info HTTP ${res.status}`);
    }
    return parseApiBody(kind, repo, await readJson(res));
  }

  throw new HttpError(404, "REPO_NOT_FOUND", "Hugging Face repo not found");
}

function resolveUrls(baseUrl: string, kind: RepoKind, repo: string, revision: string): string[] {
  const encoded = encodePath(repo);
  const rev = encodeURIComponent(revision);
  const file = "enspack-verify.txt";
  if (kind === "model") {
    return [
      `${baseUrl}/${encoded}/resolve/${rev}/${file}`,
      `${baseUrl}/${encoded}/raw/${rev}/${file}`,
    ];
  }
  const prefix = kind === "dataset" ? "datasets" : "spaces";
  return [
    `${baseUrl}/${prefix}/${encoded}/resolve/${rev}/${file}`,
    `${baseUrl}/${prefix}/${encoded}/raw/${rev}/${file}`,
  ];
}

/**
 * SPEC §7 step 4: read `enspack-verify.txt` at the repo's `main` revision.
 */
export async function readVerifyFile(
  fetchFn: FetchLike,
  info: HfRepoInfo,
  opts: { baseUrl?: string } = {},
): Promise<{ body: string; commit: string }> {
  const baseUrl = (opts.baseUrl ?? "https://huggingface.co").replace(/\/+$/, "");
  const revision = info.sha !== "" ? info.sha : "main";
  const urls = resolveUrls(baseUrl, info.kind, info.id, revision);
  let lastStatus = 404;
  for (const url of urls) {
    const res = await fetchFn(url);
    lastStatus = res.status;
    if (res.status === 404) {
      continue;
    }
    if (!res.ok) {
      throw new HttpError(502, "HF_ERROR", `Hugging Face file HTTP ${res.status}`);
    }
    const body = await res.text();
    const commitHeader = res.headers.get("x-repo-commit") ?? res.headers.get("x-revision-commit");
    const commit = (commitHeader ?? revision).toLowerCase();
    return { body, commit };
  }
  if (lastStatus === 404) {
    throw new HttpError(404, "FILE_NOT_FOUND", "enspack-verify.txt not found on main");
  }
  throw new HttpError(502, "HF_ERROR", "Hugging Face file fetch failed");
}

export function assertPublicRepo(info: HfRepoInfo): void {
  if (isPrivateGated(info)) {
    throw new HttpError(403, "PRIVATE", "repo must be public (not private or gated-private)");
  }
}

export function assertAuthor(info: HfRepoInfo, hfNamespace: string): void {
  if (info.author !== hfNamespace && !info.id.startsWith(`${hfNamespace}/`)) {
    throw new HttpError(403, "AUTHOR_MISMATCH", "repo author must equal hfNamespace");
  }
}
