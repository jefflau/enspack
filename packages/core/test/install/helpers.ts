import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../../src/index.js";
import type { Manifest } from "../../src/index.js";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const fixtureDir = join(repoRoot, "test/fixtures/tiny-model");

export const fixtureFiles = ["config.json", "model.safetensors", "tokenizer.json"] as const;

export function loadTinyManifest(): Manifest {
  return validateManifest(
    JSON.parse(readFileSync(join(repoRoot, "test/fixtures/tiny-model.enspack.json"), "utf8")),
  );
}
