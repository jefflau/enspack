import { useMemo, useState } from "react";
import type { ManifestFile } from "../lib/api.js";
import { formatBytes } from "../lib/format.js";
import { RoleBadge } from "./badge.js";
import { Hash } from "./hash.js";

type SortKey = "path" | "size";
type SortDir = "asc" | "desc";

function ariaSort(
  active: SortKey | null,
  key: SortKey,
  dir: SortDir,
): "ascending" | "descending" | "none" {
  if (active !== key) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

function compareFiles(a: ManifestFile, b: ManifestFile, key: SortKey, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  if (key === "size") return (a.size - b.size) * mul;
  return a.path.localeCompare(b.path) * mul;
}

export function FilesTable({
  files,
  totalSize,
}: {
  files: readonly ManifestFile[];
  totalSize: number;
}) {
  const [key, setKey] = useState<SortKey | null>(null);
  const [dir, setDir] = useState<SortDir>("asc");

  const rows = useMemo(() => {
    if (key === null) return [...files];
    return [...files].sort((a, b) => compareFiles(a, b, key, dir));
  }, [files, key, dir]);

  function onSort(next: SortKey) {
    if (key === next) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setKey(next);
    setDir("asc");
  }

  return (
    <section className="files-section" aria-labelledby="files-heading">
      <h2 id="files-heading">Files</h2>
      <div className="files-table-wrap">
        <table className="files-table" aria-label="Files">
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort(key, "path", dir)}>
                <button type="button" className="files-sort" onClick={() => onSort("path")}>
                  path
                </button>
              </th>
              <th scope="col">role</th>
              <th scope="col" aria-sort={ariaSort(key, "size", dir)}>
                <button type="button" className="files-sort" onClick={() => onSort("size")}>
                  size
                </button>
              </th>
              <th scope="col">sha256</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((file) => (
              <tr key={file.path}>
                <td>
                  <code className="files-path">{file.path}</code>
                </td>
                <td>
                  <RoleBadge role={file.role} />
                </td>
                <td className="files-size">{formatBytes(file.size)}</td>
                <td className="files-sha">
                  <Hash value={file.sha256} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">
                {files.length} {files.length === 1 ? "file" : "files"}
              </th>
              <td />
              <td className="files-size">{formatBytes(totalSize)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
