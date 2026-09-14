import { readFileSync } from "node:fs";
import { validateManifest } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { httpFallbackSources } from "../src/index.js";
import { manifestPath } from "./helpers/paths.js";

describe("httpFallbackSources", () => {
  it("returns webseed + path for every webseed", () => {
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    expect(httpFallbackSources(manifest, "config.json")).toEqual([
      "https://example.invalid/tiny-model/config.json",
    ]);
  });
});
