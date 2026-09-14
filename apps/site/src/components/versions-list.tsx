import { Link } from "react-router";
import type { NameVersion } from "../lib/api.js";
import { formatDate } from "../lib/format.js";
import { Badge } from "./badge.js";
import { CopyButton } from "./copy-button.js";
import { Hash } from "./hash.js";

/** Hash + in-app link without nesting a copy button inside the `<a>`. */
function VersionName({ name }: { name: string }) {
  return (
    <span className="hash">
      <Link
        to={`/name/${encodeURIComponent(name)}`}
        className="hash-value versions-name-link"
        title={name}
      >
        {name}
      </Link>
      <CopyButton value={name} />
    </span>
  );
}

export function VersionsList({
  versions,
  latestName,
}: {
  versions: readonly NameVersion[];
  latestName: string;
}) {
  return (
    <section className="versions-section" aria-labelledby="versions-heading">
      <h2 id="versions-heading">Versions</h2>
      <div className="versions-table-wrap">
        <table className="versions-table" aria-label="Versions">
          <thead>
            <tr>
              <th scope="col">version</th>
              <th scope="col">name</th>
              <th scope="col">cid</th>
              <th scope="col">createdAt</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => {
              const latest = v.name === latestName;
              return (
                <tr key={v.name} data-latest={latest ? "true" : undefined}>
                  <td>
                    <code>{v.version}</code>
                    {latest ? <Badge tone="ok">latest</Badge> : null}
                  </td>
                  <td>
                    <VersionName name={v.name} />
                  </td>
                  <td>
                    <Hash value={v.cid} short />
                  </td>
                  <td>{formatDate(v.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="versions-note muted">
        Version names are immutable by convention; a changed contenthash on one appears under{" "}
        <Link to="/violations">Violations</Link>.
      </p>
    </section>
  );
}
