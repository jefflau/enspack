import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface WalkedFile {
  /** POSIX path relative to the walked directory. */
  path: string;
  size: number;
  abs: string;
}

/** Byte-order sort so torrent file order (and therefore infohash) is reproducible. */
export function comparePath(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Recursively list files sorted by relative path in byte order. Dotfiles are
 * included: HF repos ship `.gitattributes` and SPEC §3 requires the torrent
 * tree to equal `files[]` exactly. Only `.enspack-quarantine` is skipped.
 */
export async function walkFiles(dir: string): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];

  async function walk(rel: string): Promise<void> {
    const abs = rel === "" ? dir : join(dir, rel);
    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".enspack-quarantine") continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(childRel);
      } else if (entry.isFile()) {
        const st = await stat(join(dir, childRel));
        out.push({ path: childRel, size: st.size, abs: join(dir, childRel) });
      }
    }
  }

  await walk("");
  out.sort((a, b) => comparePath(a.path, b.path));
  return out;
}

export function posixPath(p: string): string {
  return p.replaceAll("\\", "/");
}

/** Strip the torrent's top-level directory; SPEC §3 says that name is irrelevant. */
export function stripTorrentTopDir(fullPath: string, torrentName: string): string {
  const p = posixPath(fullPath);
  const prefix = `${torrentName}/`;
  if (p.startsWith(prefix)) return p.slice(prefix.length);
  return p;
}
