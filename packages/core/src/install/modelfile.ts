import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EnspackError } from "../error.js";
import type { Manifest } from "../types.js";
import { matchesSelect } from "./select.js";

function isGguf(path: string): boolean {
  return path.toLowerCase().endsWith(".gguf");
}

/**
 * SPEC §5 `--emit-modelfile`: selected `files[]` entries whose path ends in `.gguf`.
 */
export function selectedGgufs(m: Manifest, select?: string[]): string[] {
  return m.files.map((f) => f.path).filter((p) => isGguf(p) && matchesSelect(p, select));
}

/**
 * SPEC §5 `--emit-modelfile`: write `FROM ./<gguf>` next to the files when exactly
 * one `.gguf` matches `--select`. Zero or more than one match is POLICY.
 */
export async function emitModelfile(m: Manifest, dir: string, select?: string[]): Promise<string> {
  const ggufs = selectedGgufs(m, select);
  if (ggufs.length !== 1) {
    const listed = ggufs.join(", ");
    const how = "pass --select <file.gguf> to choose exactly one GGUF (SPEC §5 --emit-modelfile)";
    if (ggufs.length === 0) {
      throw new EnspackError("POLICY", `no .gguf file matches --select; ${how}`);
    }
    throw new EnspackError("POLICY", `multiple .gguf files match --select (${listed}); ${how}`);
  }
  const gguf = ggufs[0];
  if (gguf === undefined) {
    throw new EnspackError("POLICY", "no .gguf file matches --select");
  }
  const dest = join(dir, "Modelfile");
  await writeFile(dest, `FROM ./${gguf}\n`, "utf8");
  return dest;
}
