import { EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { DOWNLOAD_CAP_BYTES, HfClient, hfWebseed } from "../src/index.js";
import { REPO, REVISION, createReplayFetch } from "./replay-fetch.js";

describe("failure paths", () => {
  it("throws FETCH on a 404 repo", async () => {
    const client = new HfClient({ fetch: createReplayFetch() });
    try {
      await client.info("missing/does-not-exist");
      expect.unreachable("expected FETCH");
    } catch (err) {
      expect(err).toBeInstanceOf(EnspackError);
      expect((err as EnspackError).code).toBe("FETCH");
    }
  });

  it("throws FETCH when a non-LFS file exceeds the 64 MiB cap", async () => {
    const fetchImpl = createReplayFetch((url) => {
      if (url.includes("/resolve/")) {
        return new Response(null, {
          status: 200,
          headers: { "content-length": String(DOWNLOAD_CAP_BYTES + 1) },
        });
      }
      return undefined;
    });
    const client = new HfClient({ fetch: fetchImpl });
    try {
      await client.download(REPO, REVISION, "config.json");
      expect.unreachable("expected FETCH");
    } catch (err) {
      expect(err).toBeInstanceOf(EnspackError);
      expect((err as EnspackError).code).toBe("FETCH");
    }
  });

  it("throws VERIFY when hfWebseed is given main", () => {
    expect(() => hfWebseed(REPO, "main")).toThrow(EnspackError);
    try {
      hfWebseed(REPO, "main");
    } catch (err) {
      expect((err as EnspackError).code).toBe("VERIFY");
    }
  });

  it("returns a slash-terminated URL for a 40-hex revision", () => {
    expect(hfWebseed(REPO, REVISION)).toBe(`https://huggingface.co/${REPO}/resolve/${REVISION}/`);
  });
});
