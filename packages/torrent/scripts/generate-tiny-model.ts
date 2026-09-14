import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "@enspack/core";
import { createTorrent, magnetFor } from "../dist/index.js";

const MODEL_BYTES = 2 * 1024 * 1024;
const SEED = 0x656e7370;

function mulberry32(a: number): () => number {
  let seed = a;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesRoot = join(repoRoot, "test/fixtures");
const fixtureDir = join(fixturesRoot, "tiny-model");

const config = `${JSON.stringify(
  {
    model_type: "tiny",
    architectures: ["TinyForCausalLM"],
    hidden_size: 8,
    num_hidden_layers: 1,
  },
  null,
  2,
)}\n`;

const tokenizer = `${JSON.stringify(
  {
    version: "1.0",
    model: { type: "WordLevel", vocab: { "<unk>": 0 } },
  },
  null,
  2,
)}\n`;

const prng = mulberry32(SEED);
const model = Buffer.alloc(MODEL_BYTES);
for (let i = 0; i < model.length; i++) {
  model[i] = Math.floor(prng() * 256);
}

await mkdir(fixtureDir, { recursive: true });
const staging = await mkdtemp(join(fixturesRoot, ".staging-"));
await writeFile(join(fixtureDir, "config.json"), config);
await writeFile(join(fixtureDir, "tokenizer.json"), tokenizer);
await writeFile(join(fixtureDir, "model.safetensors"), model);
await writeFile(join(staging, "config.json"), config);
await writeFile(join(staging, "tokenizer.json"), tokenizer);
await writeFile(join(staging, "model.safetensors"), model);

const webseeds = ["https://example.invalid/tiny-model/"];
const created = await createTorrent(staging, {
  name: "tiny-model",
  webseeds,
  comment: "enspack tiny-model fixture",
});
await writeFile(join(fixturesRoot, "tiny-model.torrent"), created.metainfo);

const files = [
  {
    path: "config.json",
    size: Buffer.byteLength(config),
    sha256: sha256(Buffer.from(config)),
    role: "config" as const,
  },
  {
    path: "model.safetensors",
    size: model.length,
    sha256: sha256(model),
    role: "weight" as const,
  },
  {
    path: "tokenizer.json",
    size: Buffer.byteLength(tokenizer),
    sha256: sha256(Buffer.from(tokenizer)),
    role: "tokenizer" as const,
  },
];
files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const totalSize = files.reduce((s, f) => s + f.size, 0);
const name = "v1-0-0.tiny-model.mirrors.enspack.eth";
const createdAt = "2026-09-14T00:00:00Z";
const cid = `bafkrei${"a".repeat(52)}`;

const manifest = {
  spec: "enspack/0.1" as const,
  name,
  model: "tiny-model.mirrors.enspack.eth",
  publisher: "mirrors.enspack.eth",
  version: "1.0.0",
  createdAt,
  displayName: "tiny-model",
  license: "apache-2.0",
  distribution: {
    infohash: created.infohash,
    magnet: magnetFor(created.infohash, "tiny-model"),
    torrent: { cid },
    webseeds,
  },
  files,
  totalSize,
  versions: [{ version: "1.0.0", name, cid, createdAt }],
};

validateManifest(manifest);
await writeFile(
  join(fixturesRoot, "tiny-model.enspack.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await rm(staging, { recursive: true, force: true });
process.stderr.write(`tiny-model fixture infohash=${created.infohash} totalSize=${totalSize}\n`);
