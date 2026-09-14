import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderLockfileTypes, renderManifestTypes } from "../scripts/generate.js";

const generatedDir = join(dirname(fileURLToPath(import.meta.url)), "../src/generated");

describe("generated types", () => {
  it("are up to date with the schema", async () => {
    expect(readFileSync(join(generatedDir, "manifest.ts"), "utf8")).toBe(await renderManifestTypes());
    expect(readFileSync(join(generatedDir, "lockfile.ts"), "utf8")).toBe(await renderLockfileTypes());
  });
});
