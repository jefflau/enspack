import { readFileSync } from "node:fs";
import { EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { HfClient } from "../src/index.js";
import { REPO, REVISION, createReplayFetch, exampleManifestPath } from "./replay-fetch.js";

describe("buildFiles", () => {
  it("reproduces examples/qwen--qwen2-5-7b-instruct.enspack.json files[] exactly", async () => {
    const client = new HfClient({ fetch: createReplayFetch() });
    const files = await client.buildFiles(REPO, REVISION);
    const example = JSON.parse(readFileSync(exampleManifestPath, "utf8")) as {
      files: unknown;
    };
    expect(files).toEqual(example.files);
  });

  it("rejects tree paths that fail schema path rules", async () => {
    const fetchImpl = createReplayFetch((url) => {
      if (url.includes("/tree/")) {
        return new Response(
          JSON.stringify([{ type: "file", path: "../secret", size: 1, oid: "abc" }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return undefined;
    });
    const client = new HfClient({ fetch: fetchImpl });
    await expect(client.buildFiles(REPO, REVISION)).rejects.toMatchObject({
      code: "VERIFY",
    });
    await expect(client.buildFiles(REPO, REVISION)).rejects.toBeInstanceOf(EnspackError);
  });
});
