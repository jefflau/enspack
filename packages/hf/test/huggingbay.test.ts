import { EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { HuggingBayClient } from "../src/index.js";
import { REPO, createReplayFetch } from "./replay-fetch.js";

describe("HuggingBayClient", () => {
  it("resolves Qwen/Qwen2.5-7B-Instruct via the repo fallback after resolve/hb 400", async () => {
    const client = new HuggingBayClient({ fetch: createReplayFetch() });
    const artifact = await client.resolve(REPO);
    expect(artifact).not.toBeNull();
    expect(artifact?.id).toBe("hf-model-qwen-qwen2-5-7b-instruct");
    expect(artifact?.repo).toBe(REPO);
  });

  it("resolves a full hb:// URI with digest", async () => {
    const client = new HuggingBayClient({ fetch: createReplayFetch() });
    const artifact = await client.resolve(
      "hb://Qwen/Qwen2.5-7B-Instruct@sha256:d82247b7101aea36fd25bc61273bc1d2627d2cc0cb0fd29cb9586044f4e999fd",
    );
    expect(artifact?.id).toBe("hf-model-qwen-qwen2-5-7b-instruct");
  });

  it("returns null on 404 resolve", async () => {
    const client = new HuggingBayClient({
      fetch: createReplayFetch((url) => {
        if (url.includes("/api/resolve")) {
          return new Response("{}", {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        return undefined;
      }),
    });
    expect(await client.resolve("missing/repo")).toBeNull();
  });

  it("parses lock files from artifacts[].files sizeBytes", async () => {
    const client = new HuggingBayClient({ fetch: createReplayFetch() });
    const lock = await client.lock("hf-model-qwen-qwen2-5-7b-instruct");
    expect(lock.files.length).toBeGreaterThan(0);
    expect(lock.files.some((f) => f.path === "config.json" && f.size === 663)).toBe(true);
    expect(lock.raw).toBeTruthy();
  });

  it("rejects magnets that fail MAGNET_RE", async () => {
    const client = new HuggingBayClient({ fetch: createReplayFetch() });
    try {
      await client.submitFallback("hf-model-qwen-qwen2-5-7b-instruct", {
        magnet: "magnet:?xt=urn:btih:not-a-hash",
        displayName: "enspack: test",
        infohash: "0000000000000000000000000000000000000000",
      });
      expect.unreachable("expected PUBLISH");
    } catch (err) {
      expect(err).toBeInstanceOf(EnspackError);
      expect((err as EnspackError).code).toBe("PUBLISH");
    }
  });

  it("throws PUBLISH on non-2xx fallback POST", async () => {
    const client = new HuggingBayClient({ fetch: createReplayFetch() });
    try {
      await client.submitFallback("hf-model-qwen-qwen2-5-7b-instruct", {
        magnet: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
        displayName: "enspack: test",
        infohash: "0000000000000000000000000000000000000000",
      });
      expect.unreachable("expected PUBLISH");
    } catch (err) {
      expect(err).toBeInstanceOf(EnspackError);
      expect((err as EnspackError).code).toBe("PUBLISH");
    }
  });
});
