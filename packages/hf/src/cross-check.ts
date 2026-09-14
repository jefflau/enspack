import { EnspackError, type ManifestFile } from "@enspack/core";
import type { HbLock } from "./huggingbay-client.js";

/** Successful HF/HB hash agreement (SPEC §8 step 1). */
export type CrossCheckOk = { ok: true; compared: number };

/**
 * Cross-check HF `files[]` against a Hugging Bay lock. HF is the source of the
 * file list: paths only on HF are reported as missing but do not abort; paths
 * only on HB abort. Size or sha256 disagreement on a shared path aborts
 * (SPEC §8 step 1 "Any disagreement aborts").
 */
export function crossCheck(files: ManifestFile[], hbLock: HbLock): CrossCheckOk {
  const hfByPath = new Map(files.map((f) => [f.path, f]));
  const hbByPath = new Map(hbLock.files.map((f) => [f.path, f]));
  const problems: string[] = [];
  let compared = 0;

  for (const [path, hf] of hfByPath) {
    const hb = hbByPath.get(path);
    if (!hb) {
      problems.push(`${path}: missing`);
      continue;
    }
    compared += 1;
    if (hf.size !== hb.size) problems.push(`${path}: size`);
    if (hf.sha256.toLowerCase() !== hb.sha256.toLowerCase()) problems.push(`${path}: sha256`);
  }

  for (const path of hbByPath.keys()) {
    if (!hfByPath.has(path)) problems.push(`${path}: missing`);
  }

  const fatal = problems.filter((line) => {
    const path = line.slice(0, line.lastIndexOf(":"));
    const reason = line.slice(line.lastIndexOf(":") + 2);
    if (reason === "missing") return hbByPath.has(path) && !hfByPath.has(path);
    return true;
  });

  if (fatal.length > 0) {
    throw new EnspackError("VERIFY", `Hugging Bay lock disagrees: ${fatal.join("; ")}`);
  }
  return { ok: true, compared };
}
