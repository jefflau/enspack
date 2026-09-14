import type { Manifest } from "./types.js";

/**
 * SPEC §5: HF hub cache folder `models--{org}--{repo}`; falls back to `enspack--{model-label}`.
 */
export function hfCacheRepoDir(m: Manifest): string {
  const repo = m.upstream?.repo;
  if (repo !== undefined) {
    const slash = repo.indexOf("/");
    if (slash > 0 && slash < repo.length - 1) {
      const org = repo.slice(0, slash);
      const name = repo.slice(slash + 1);
      return `models--${org}--${name}`;
    }
  }
  const modelLabel = m.model.split(".")[0] ?? m.model;
  return `models--enspack--${modelLabel}`;
}
