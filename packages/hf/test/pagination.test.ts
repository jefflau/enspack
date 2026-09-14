import { describe, expect, it } from "vitest";
import { HfClient, parseLinkNext } from "../src/index.js";
import { REPO, REVISION, createReplayFetch, readFixtureJson } from "./replay-fetch.js";

describe("tree pagination", () => {
  it("parses Link rel=next", () => {
    expect(
      parseLinkNext(
        `<https://huggingface.co/api/models/org/repo/tree/main?cursor=2>; rel="next", <https://huggingface.co/api/models/org/repo/tree/main?cursor=1>; rel="prev"`,
      ),
    ).toBe("https://huggingface.co/api/models/org/repo/tree/main?cursor=2");
  });

  it("merges a tree split across two Link-header pages", async () => {
    const tree =
      readFixtureJson<{ type: string; path: string; size: number; oid: string; lfs?: unknown }[]>(
        "hf/tree.json",
      );
    const mid = Math.ceil(tree.length / 2);
    const page1 = tree.slice(0, mid);
    const page2 = tree.slice(mid);
    const page2Url = `https://huggingface.co/api/models/${REPO}/tree/${REVISION}?recursive=true&cursor=page2`;

    const fetchImpl = createReplayFetch((url) => {
      if (!url.includes("/tree/")) return undefined;
      if (url.includes("cursor=page2")) {
        return new Response(JSON.stringify(page2), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(page1), {
        status: 200,
        headers: {
          "content-type": "application/json",
          Link: `<${page2Url}>; rel="next"`,
        },
      });
    });

    const client = new HfClient({ fetch: fetchImpl });
    const files = await client.tree(REPO, REVISION);
    expect(files.map((f) => f.path)).toEqual(tree.map((e) => e.path));
    expect(files).toHaveLength(tree.length);
  });
});
