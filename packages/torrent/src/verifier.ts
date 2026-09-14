import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Manifest, Verifier, VerifyResult } from "@enspack/core";
import { selectedManifestPaths } from "./select.js";

const HASH_CHUNK = 1024 * 1024;

async function sha256File(abs: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(abs, { highWaterMark: HASH_CHUNK });
  await pipeline(stream, hash);
  return hash.digest("hex");
}

/**
 * SPEC §4 step 8: size first, then streaming SHA-256. Failures are returned,
 * not swallowed. `quarantine` moves the download to
 * `<dir>/.enspack-quarantine/<infohash>/`.
 */
export class Sha256Verifier implements Verifier {
  async verify(manifest: Manifest, dir: string, select?: string[]): Promise<VerifyResult> {
    const files = selectedManifestPaths(manifest.files, select);
    const failures: { path: string; reason: "missing" | "size" | "sha256" }[] = [];

    for (const file of files) {
      const abs = join(dir, file.path);
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(abs);
      } catch {
        failures.push({ path: file.path, reason: "missing" });
        continue;
      }
      if (!st.isFile() || st.size !== file.size) {
        failures.push({ path: file.path, reason: "size" });
        continue;
      }
      const digest = await sha256File(abs);
      if (digest !== file.sha256) {
        failures.push({ path: file.path, reason: "sha256" });
      }
    }

    if (failures.length > 0) {
      return { ok: false, failures };
    }
    return { ok: true };
  }

  /**
   * SPEC §4 step 8: move the whole download to
   * `<dir>/.enspack-quarantine/<infohash>/` and return that path.
   */
  async quarantine(
    dir: string,
    infohash: string,
    _failures: { path: string; reason: "missing" | "size" | "sha256" }[],
  ): Promise<string> {
    const dest = join(dir, ".enspack-quarantine", infohash);
    await mkdir(dest, { recursive: true });
    const entries = await readdir(dir);
    for (const name of entries) {
      if (name === ".enspack-quarantine") continue;
      await rename(join(dir, name), join(dest, name));
    }
    return dest;
  }
}
