import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { InstallTarget, Installer } from "../interfaces.js";
import type { Manifest } from "../types.js";
import { emitModelfile as writeModelfile } from "./modelfile.js";
import { hfCacheRepoRoot, resolveSafeInstallPath, snapshotRevision } from "./paths.js";
import { matchesSelect } from "./select.js";

/** SPEC §5: `InstallTarget` plus optional `--select` and `move` (not in MVP.md §2). */
export type InstallRequest = InstallTarget & {
  select?: string[];
  move?: boolean;
};

/**
 * SPEC §5 / MVP.md §2: Installer plus `--emit-modelfile` and ready-to-run lines.
 */
export interface CoreInstaller extends Installer {
  /** SPEC §5: HF cache or `--dir` copy of verified `files[]` present in `srcDir`. */
  install(m: Manifest, srcDir: string, target: InstallRequest): Promise<{ path: string }>;
  /** SPEC §5 `--emit-modelfile`: write `FROM ./<gguf>` when exactly one `.gguf` matches. */
  emitModelfile(m: Manifest, dir: string, select?: string[]): Promise<string>;
  /** SPEC §5: ready-to-run lines for transformers / llama.cpp / ollama where applicable. */
  readyToRunLines(m: Manifest, installedPath: string, target: InstallTarget): string[];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureRegularFileDest(dest: string): Promise<void> {
  try {
    const st = await lstat(dest);
    if (st.isSymbolicLink() || st.isFile()) {
      await unlink(dest);
    }
  } catch {
    // dest does not exist yet
  }
}

async function placeFile(src: string, dest: string, move: boolean): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  await ensureRegularFileDest(dest);
  if (move) {
    try {
      await rename(src, dest);
      return;
    } catch (cause) {
      const code =
        cause !== null && typeof cause === "object" && "code" in cause
          ? String((cause as { code: unknown }).code)
          : "";
      if (code !== "EXDEV") {
        throw cause;
      }
      await copyFile(src, dest);
      await unlink(src);
      return;
    }
  }
  await copyFile(src, dest);
}

async function copySelected(
  m: Manifest,
  srcDir: string,
  destRoot: string,
  select: string[] | undefined,
  move: boolean,
): Promise<void> {
  for (const file of m.files) {
    if (!matchesSelect(file.path, select)) {
      continue;
    }
    const dest = resolveSafeInstallPath(destRoot, file.path);
    const src = join(srcDir, file.path);
    if (!(await pathExists(src))) {
      continue;
    }
    await placeFile(src, dest, move);
  }
}

async function installHfCache(
  m: Manifest,
  srcDir: string,
  hfHome: string | undefined,
  select: string[] | undefined,
  move: boolean,
): Promise<{ path: string }> {
  const repoRoot = hfCacheRepoRoot(m, hfHome);
  const revision = snapshotRevision(m);
  const snapshotDir = join(repoRoot, "snapshots", revision);
  await mkdir(join(repoRoot, "refs"), { recursive: true });
  await mkdir(snapshotDir, { recursive: true });
  // huggingface_hub reads refs/main with no trailing newline
  await writeFile(join(repoRoot, "refs", "main"), revision, "utf8");
  await copySelected(m, srcDir, snapshotDir, select, move);
  return { path: snapshotDir };
}

async function installDir(
  m: Manifest,
  srcDir: string,
  dest: string,
  select: string[] | undefined,
  move: boolean,
): Promise<{ path: string }> {
  await mkdir(dest, { recursive: true });
  await copySelected(m, srcDir, dest, select, move);
  return { path: dest };
}

function modelLabel(m: Manifest): string {
  return m.model.split(".")[0] ?? m.model;
}

class FsInstaller implements CoreInstaller {
  /**
   * SPEC §5: copy verified `files[]` into the HF hub cache (`refs/main` +
   * `snapshots/<revision>/` as real files) or a flat `--dir` tree. Only files
   * present in `srcDir` are installed (respects `--select` downloads). Re-running
   * is idempotent.
   */
  async install(m: Manifest, srcDir: string, target: InstallRequest): Promise<{ path: string }> {
    const select = target.select;
    const move = target.move === true;
    if (target.kind === "hf-cache") {
      return installHfCache(m, srcDir, target.hfHome, select, move);
    }
    return installDir(m, srcDir, target.path, select, move);
  }

  /**
   * SPEC §5 `--emit-modelfile`: write an Ollama Modelfile next to the files.
   */
  emitModelfile(m: Manifest, dir: string, select?: string[]): Promise<string> {
    return writeModelfile(m, dir, select);
  }

  /**
   * SPEC §5: ready-to-run lines for transformers (hf-cache + `upstream.repo`),
   * llama.cpp when a `.gguf` is present, and `ollama create` when a Modelfile
   * was written. Does not claim more than that.
   */
  readyToRunLines(m: Manifest, installedPath: string, target: InstallTarget): string[] {
    const lines: string[] = [];
    if (target.kind === "hf-cache") {
      const repo = m.upstream?.repo;
      if (repo !== undefined && repo !== "") {
        lines.push(
          `HF_HUB_OFFLINE=1 python -c "from transformers import AutoModel; AutoModel.from_pretrained('${repo}')"`,
        );
      }
    }
    for (const file of m.files) {
      if (!file.path.toLowerCase().endsWith(".gguf")) {
        continue;
      }
      const ggufPath = join(installedPath, file.path);
      if (existsSync(ggufPath)) {
        lines.push(`llama-cli -m ${ggufPath}`);
      }
    }
    const modelfile = join(installedPath, "Modelfile");
    if (existsSync(modelfile)) {
      lines.push(`ollama create ${modelLabel(m)} -f ${modelfile}`);
    }
    return lines;
  }
}

/**
 * SPEC §5 / MVP.md WP-07: filesystem installer (HF cache or `--dir`).
 */
export function createInstaller(): CoreInstaller {
  return new FsInstaller();
}
