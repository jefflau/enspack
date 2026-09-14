import type { EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { HfClient } from "../src/index.js";
import { REPO, REVISION, createReplayFetch } from "./replay-fetch.js";

describe("HfClient info and revision", () => {
  it("reads gated/private/license/sha from the recorded model info", async () => {
    const client = new HfClient({ fetch: createReplayFetch() });
    const info = await client.info(REPO);
    expect(info.gated).toBe(false);
    expect(info.private).toBe(false);
    expect(info.license).toBe("apache-2.0");
    expect(info.sha).toBe(REVISION);
    expect(await client.license(REPO)).toBe("apache-2.0");
  });

  it("resolves main to the recorded 40-hex sha", async () => {
    const client = new HfClient({ fetch: createReplayFetch() });
    expect(await client.resolveRevision(REPO, "main")).toBe(REVISION);
  });

  it("sends Authorization Bearer when a token is provided and never includes it in errors", async () => {
    const seen: string[] = [];
    const fetchImpl = createReplayFetch((_url, init) => {
      const headers = new Headers(init?.headers);
      seen.push(headers.get("Authorization") ?? "");
      return undefined;
    });
    const client = new HfClient({ fetch: fetchImpl, token: "hf_secret_token" });
    await client.info(REPO);
    expect(seen[0]).toBe("Bearer hf_secret_token");
    try {
      await client.info("missing/repo");
    } catch (err) {
      expect((err as EnspackError).message).not.toContain("hf_secret_token");
    }
  });
});
