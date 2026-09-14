import { EnspackError } from "@enspack/core";

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

/**
 * BEP 19 webseed base URL pinning an immutable HF revision (SPEC §3).
 */
export function hfWebseed(repo: string, revision: string): string {
  if (revision === "main" || !COMMIT_SHA_RE.test(revision)) {
    throw new EnspackError(
      "VERIFY",
      `upstream webseeds MUST pin an immutable 40-hex revision, not ${JSON.stringify(revision)}`,
    );
  }
  return `https://huggingface.co/${repo}/resolve/${revision}/`;
}
