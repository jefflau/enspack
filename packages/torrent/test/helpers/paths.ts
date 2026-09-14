import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const fixtureDir = join(repoRoot, "test/fixtures/tiny-model");

export const fixtureFiles = ["config.json", "model.safetensors", "tokenizer.json"] as const;

export const manifestPath = join(repoRoot, "test/fixtures/tiny-model.enspack.json");

export const torrentPath = join(repoRoot, "test/fixtures/tiny-model.torrent");
