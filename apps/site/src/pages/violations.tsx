import { Link } from "react-router";
import { CopyButton } from "../components/copy-button.js";
import { ExternalLink } from "../components/external-link.js";
import { Hash } from "../components/hash.js";
import { EmptyState, ErrorState, Loading } from "../components/states.js";
import { useClient } from "../lib/client-context.js";
import { config } from "../lib/config.js";
import { explorerBlock } from "../lib/format.js";
import { useQuery } from "../lib/use-query.js";
import "../styles/pages/violations.css";

/** Hash + in-app link without nesting a button inside the `<a>`. */
function ViolationNameLink({ name }: { name: string }) {
  return (
    <span className="hash">
      <Link
        to={`/name/${encodeURIComponent(name)}`}
        className="hash-value violations-name-link"
        title={name}
      >
        {name}
      </Link>
      <CopyButton value={name} />
    </span>
  );
}

export function ViolationsPage() {
  const client = useClient();
  const { data, error, loading } = useQuery("violations", () => client.listViolations());

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} what="violations" />;
  if (data === null || data.items.length === 0) {
    return (
      <EmptyState title="No violations. No version name has changed its contenthash after it was first set." />
    );
  }

  return (
    <article className="violations-page">
      <h1>Violations</h1>
      <p className="violations-intro">
        Version names are immutable by convention: publishers must not change a version&apos;s
        contenthash after it is first set. The indexer flags any later contenthash change on a
        version name as a policy violation (SPEC §6.2).
      </p>
      <div className="violations-table-wrap">
        <table className="violations-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Node</th>
              <th scope="col">CID</th>
              <th scope="col">Block</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((v) => (
              <tr key={v.node}>
                <td>
                  <ViolationNameLink name={v.name} />
                </td>
                <td>
                  <Hash value={v.node} short />
                </td>
                <td>
                  <div className="violations-cids">
                    <Hash value={v.previousCid} short />
                    <span className="violations-arrow" aria-hidden="true">
                      →
                    </span>
                    <Hash value={v.newCid} short />
                  </div>
                </td>
                <td>
                  <ExternalLink href={explorerBlock(config.chain, v.block)}>{v.block}</ExternalLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
