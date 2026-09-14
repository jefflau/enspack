/**
 * SPEC §5 `--select`: `undefined` or a glob list containing `*` means every path.
 */
export function isSelectAll(select: string[] | undefined): boolean {
  return select === undefined || select.some((g) => g === "*");
}

/**
 * SPEC §5 `--select <glob>`: match a manifest-relative POSIX path against globs.
 * Globs without `/` also match the basename (`matchBase`), so `*.gguf` matches
 * both `model.gguf` and `weights/model.gguf`.
 */
export function matchesSelect(path: string, select: string[] | undefined): boolean {
  if (isSelectAll(select)) {
    return true;
  }
  const base = path.split("/").pop() ?? path;
  return select.some((glob) => globMatch(glob, path) || globMatch(glob, base));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c !== undefined) {
      out += escapeRegExp(c);
    }
  }
  out += "$";
  return new RegExp(out);
}

function globMatch(glob: string, value: string): boolean {
  return globToRegExp(glob).test(value);
}
