import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const examplesDir = join(repoRoot, "examples");

describe("examples", () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".enspack.json"));

  it("finds at least one example manifest", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("examples/*.enspack.json validate with validateManifest", () => {
    for (const file of files) {
      const raw: unknown = JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
      const manifest = validateManifest(raw);
      expect(manifest.spec).toBe("enspack/0.1");
    }
  });
});
