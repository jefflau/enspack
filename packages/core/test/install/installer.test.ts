import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EnspackError,
  createInstaller,
  hfCacheRepoDir,
  snapshotRevision,
  validateManifest,
} from "../../src/index.js";
import type { Manifest } from "../../src/index.js";
import { fixtureDir, fixtureFiles, loadTinyManifest } from "./helpers.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function probeHuggingfaceHub(): { ok: boolean; detail: string } {
  const first = spawnSync("python3", ["-c", "import huggingface_hub"], { encoding: "utf8" });
  if (first.status === 0) {
    return { ok: true, detail: "huggingface_hub already importable" };
  }
  const pip = spawnSync(
    "python3",
    ["-m", "pip", "install", "--user", "--quiet", "huggingface_hub"],
    { encoding: "utf8" },
  );
  const second = spawnSync("python3", ["-c", "import huggingface_hub"], { encoding: "utf8" });
  if (second.status === 0) {
    return { ok: true, detail: "huggingface_hub installed via pip --user" };
  }
  return {
    ok: false,
    detail: `import failed status=${first.status}; pip status=${pip.status} stderr=${pip.stderr} ${second.stderr}`,
  };
}

const hfHub = probeHuggingfaceHub();

describe("createInstaller hf-cache", () => {
  it("HF cache layout: refs/main + snapshots/<revision> as regular files with identical bytes", async () => {
    const m = loadTinyManifest();
    const hfHome = await tempDir("enspack-hf-");
    const revision = snapshotRevision(m);
    expect(hfCacheRepoDir(m)).toBe("models--enspack--tiny-model");
    expect(revision).toBe(`enspack-${m.distribution.infohash}`);

    const { path } = await createInstaller().install(m, fixtureDir, {
      kind: "hf-cache",
      hfHome,
    });

    const repo = join(hfHome, "hub", "models--enspack--tiny-model");
    const ref = join(repo, "refs", "main");
    const snapshot = join(repo, "snapshots", revision);
    expect(path).toBe(snapshot);
    expect(await readFile(ref, "utf8")).toBe(revision);
    expect((await readFile(ref)).includes(0x0a)).toBe(false);

    const names = (await readdir(snapshot)).sort();
    expect(names).toEqual([...fixtureFiles].sort());
    for (const name of fixtureFiles) {
      const dest = join(snapshot, name);
      const st = await lstat(dest);
      expect(st.isSymbolicLink()).toBe(false);
      expect(st.isFile()).toBe(true);
      expect(await readFile(dest)).toEqual(readFileSync(join(fixtureDir, name)));
    }
  });

  it("upstream.repo Qwen/Qwen2.5-7B-Instruct maps to models--Qwen--Qwen2.5-7B-Instruct/snapshots/<revision>", async () => {
    const tiny = loadTinyManifest();
    const revision = "a09a35458c702b33eeacc393d103063234e8bc28";
    const m = validateManifest({
      ...tiny,
      upstream: {
        provider: "huggingface",
        repo: "Qwen/Qwen2.5-7B-Instruct",
        url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct",
        revision,
      },
    });
    expect(hfCacheRepoDir(m)).toBe("models--Qwen--Qwen2.5-7B-Instruct");
    expect(snapshotRevision(m)).toBe(revision);

    const hfHome = await tempDir("enspack-hf-qwen-");
    const { path } = await createInstaller().install(m, fixtureDir, {
      kind: "hf-cache",
      hfHome,
    });
    expect(path).toBe(
      join(hfHome, "hub", "models--Qwen--Qwen2.5-7B-Instruct", "snapshots", revision),
    );
    expect(
      await readFile(
        join(hfHome, "hub", "models--Qwen--Qwen2.5-7B-Instruct", "refs", "main"),
        "utf8",
      ),
    ).toBe(revision);
  });

  it.skipIf(!hfHub.ok)(
    `huggingface_hub.snapshot_download local_files_only returns snapshot (${hfHub.detail})`,
    async () => {
      const m = loadTinyManifest();
      const hfHome = await tempDir("enspack-hf-py-");
      const installed = await createInstaller().install(m, fixtureDir, {
        kind: "hf-cache",
        hfHome,
      });
      const py = spawnSync(
        "python3",
        [
          "-c",
          "from huggingface_hub import snapshot_download; import os; print(snapshot_download(repo_id='enspack/tiny-model', local_files_only=True, cache_dir=os.path.join(os.environ['HF_HOME'], 'hub')))",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HF_HOME: hfHome,
            HF_HUB_CACHE: join(hfHome, "hub"),
            HF_HUB_OFFLINE: "1",
          },
        },
      );
      expect(py.status, py.stderr).toBe(0);
      expect(py.stdout.trim()).toBe(installed.path);
    },
  );

  it("refuses files[].path that escape the snapshot dir", async () => {
    const tiny = loadTinyManifest();
    const escaped: Manifest = {
      ...tiny,
      files: [{ path: "../evil.txt", size: 1, sha256: tiny.files[0]?.sha256 ?? "0".repeat(64) }],
    };
    const hfHome = await tempDir("enspack-hf-esc-");
    const src = await tempDir("enspack-src-esc-");
    await writeFile(join(src, "evil.txt"), "x");
    await expect(
      createInstaller().install(escaped, src, { kind: "hf-cache", hfHome }),
    ).rejects.toMatchObject({ code: "VERIFY" });
    try {
      await createInstaller().install(escaped, src, { kind: "hf-cache", hfHome });
    } catch (e) {
      expect(e).toBeInstanceOf(EnspackError);
      expect(String(e)).toMatch(/escapes/);
    }
  });
});

describe("createInstaller dir / select / idempotent", () => {
  it("dir target is a flat copy of the selected folder", async () => {
    const m = loadTinyManifest();
    const dest = join(await tempDir("enspack-dir-"), "out");
    const { path } = await createInstaller().install(m, fixtureDir, { kind: "dir", path: dest });
    expect(path).toBe(dest);
    const names = (await readdir(dest)).sort();
    expect(names).toEqual([...fixtureFiles].sort());
    for (const name of fixtureFiles) {
      const st = await lstat(join(dest, name));
      expect(st.isSymbolicLink()).toBe(false);
      expect(await readFile(join(dest, name))).toEqual(readFileSync(join(fixtureDir, name)));
    }
  });

  it("select subset installs only those files", async () => {
    const m = loadTinyManifest();
    const dest = join(await tempDir("enspack-sel-"), "out");
    await createInstaller().install(m, fixtureDir, {
      kind: "dir",
      path: dest,
      select: ["config.json"],
    });
    expect((await readdir(dest)).sort()).toEqual(["config.json"]);
    expect(await readFile(join(dest, "config.json"))).toEqual(
      readFileSync(join(fixtureDir, "config.json")),
    );
  });

  it("re-running install is idempotent", async () => {
    const m = loadTinyManifest();
    const hfHome = await tempDir("enspack-hf-id-");
    const installer = createInstaller();
    const first = await installer.install(m, fixtureDir, { kind: "hf-cache", hfHome });
    const second = await installer.install(m, fixtureDir, { kind: "hf-cache", hfHome });
    expect(second.path).toBe(first.path);
    for (const name of fixtureFiles) {
      expect(await readFile(join(first.path, name))).toEqual(readFileSync(join(fixtureDir, name)));
    }
  });

  it("creates subdirectories for nested files[].path", async () => {
    const tiny = loadTinyManifest();
    const src = await tempDir("enspack-nested-src-");
    await mkdir(join(src, "nested"), { recursive: true });
    await writeFile(join(src, "nested", "a.json"), "{}\n");
    const m: Manifest = {
      ...tiny,
      files: [{ path: "nested/a.json", size: 3, sha256: "0".repeat(64) }],
      totalSize: 3,
    };
    const dest = join(await tempDir("enspack-nested-out-"), "out");
    await createInstaller().install(m, src, { kind: "dir", path: dest });
    expect(await readFile(join(dest, "nested", "a.json"), "utf8")).toBe("{}\n");
  });
});
