import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const fixtureDir = join(repoRoot, "test/fixtures/tiny-model");

export const fixtureFiles = ["config.json", "model.safetensors", "tokenizer.json"] as const;

export const enspackBin = join(repoRoot, "packages/cli/bin/enspack.js");

export const cliDist = join(repoRoot, "packages/cli/dist/index.js");
