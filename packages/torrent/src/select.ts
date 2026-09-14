import picomatch from "picomatch";

/** `undefined` or a glob list containing `*` means every path (SPEC §5 `--select`). */
export function isSelectAll(select: string[] | undefined): boolean {
  return select === undefined || select.some((g) => g === "*");
}

/** Match a manifest-relative path against `--select` globs. */
export function matchesSelect(path: string, select: string[] | undefined): boolean {
  if (select === undefined || isSelectAll(select)) return true;
  return select.some((glob) => picomatch(glob, { bash: true, matchBase: true })(path));
}

export function selectedManifestPaths<T extends { path: string }>(
  files: readonly T[],
  select: string[] | undefined,
): T[] {
  return files.filter((f) => matchesSelect(f.path, select));
}
