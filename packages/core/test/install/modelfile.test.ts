import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnspackError, createInstaller } from "../../src/index.js";
import type { Manifest } from "../../src/index.js";
import { loadTinyManifest } from "./helpers.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function ggufManifest(paths: string[]): Manifest {
  const tiny = loadTinyManifest();
  const files = paths.map((path) => ({
    path,
    size: 4,
    sha256: "0".repeat(64),
    role: "weight" as const,
  }));
  const first = files[0];
  if (first === undefined) {
    return { ...tiny, files: tiny.files, totalSize: tiny.totalSize };
  }
  return {
    ...tiny,
    files: [first, ...files.slice(1)],
    totalSize: files.reduce((s, f) => s + f.size, 0),
  };
}

describe("emitModelfile", () => {
  it("exactly one .gguf writes FROM ./x.gguf", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-mf-one-"));
    dirs.push(dir);
    await writeFile(join(dir, "x.gguf"), "gguf");
    const dest = await createInstaller().emitModelfile(ggufManifest(["x.gguf"]), dir);
    expect(dest).toBe(join(dir, "Modelfile"));
    expect(await readFile(dest, "utf8")).toBe("FROM ./x.gguf\n");
  });

  it("two .gguf matches → POLICY", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-mf-two-"));
    dirs.push(dir);
    const m = ggufManifest(["a.gguf", "b.gguf"]);
    await expect(createInstaller().emitModelfile(m, dir)).rejects.toMatchObject({
      code: "POLICY",
    });
    try {
      await createInstaller().emitModelfile(m, dir);
    } catch (e) {
      expect(e).toBeInstanceOf(EnspackError);
      expect(String(e)).toMatch(/--select/);
    }
  });

  it("zero .gguf matches → POLICY", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-mf-zero-"));
    dirs.push(dir);
    await expect(createInstaller().emitModelfile(loadTinyManifest(), dir)).rejects.toMatchObject({
      code: "POLICY",
    });
  });
});

describe("readyToRunLines", () => {
  it("hf-cache with upstream.repo emits transformers; gguf + Modelfile emit llama/ollama", async () => {
    const tiny = loadTinyManifest();
    const dir = await mkdtemp(join(tmpdir(), "enspack-r2r-"));
    dirs.push(dir);
    await writeFile(join(dir, "x.gguf"), "gguf");
    const m: Manifest = {
      ...tiny,
      model: "tiny-model.mirrors.enspack.eth",
      upstream: {
        provider: "huggingface",
        repo: "Qwen/Qwen2.5-7B-Instruct",
        url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct",
        revision: "a09a35458c702b33eeacc393d103063234e8bc28",
      },
      files: [{ path: "x.gguf", size: 4, sha256: "0".repeat(64), role: "weight" }],
      totalSize: 4,
    };
    await createInstaller().emitModelfile(m, dir, ["x.gguf"]);
    const lines = createInstaller().readyToRunLines(m, dir, { kind: "hf-cache" });
    expect(lines).toContain(
      `HF_HUB_OFFLINE=1 python -c "from transformers import AutoModel; AutoModel.from_pretrained('Qwen/Qwen2.5-7B-Instruct')"`,
    );
    expect(lines).toContain(`llama-cli -m ${join(dir, "x.gguf")}`);
    expect(lines).toContain(`ollama create tiny-model -f ${join(dir, "Modelfile")}`);
  });

  it("dir target without upstream.repo does not claim transformers", () => {
    const lines = createInstaller().readyToRunLines(loadTinyManifest(), "/tmp/out", {
      kind: "dir",
      path: "/tmp/out",
    });
    expect(lines.join("\n")).not.toMatch(/transformers/);
  });
});
