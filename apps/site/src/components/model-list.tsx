import { Link } from "react-router";
import type { NameListItem } from "../lib/api.js";
import type { Chain } from "../lib/config.js";
import { firstLabel, formatBytes } from "../lib/format.js";
import { LicenseBadge } from "./badge.js";
import { Hash } from "./hash.js";
import { EmptyState, ErrorState, Loading } from "./states.js";

function displayFromModel(model: string): string {
  return firstLabel(model).replaceAll("--", "/");
}

export function ModelList({
  items,
  nextCursor,
  loading,
  loadingMore,
  error,
  qInput,
  onQChange,
  publishers,
  selectedPublisher,
  onPublisherChange,
  onLoadMore,
  chain,
}: {
  items: NameListItem[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  qInput: string;
  onQChange: (value: string) => void;
  publishers: { name: string }[];
  selectedPublisher: string | null;
  onPublisherChange: (name: string | null) => void;
  onLoadMore: () => void;
  chain: Chain;
}) {
  const filtered = qInput !== "" || selectedPublisher !== null;

  return (
    <section className="model-list" aria-labelledby="model-list-heading">
      <h2 id="model-list-heading" className="home-section-title">
        Models
      </h2>
      <div className="model-list-controls">
        <label className="model-search">
          Search
          <input
            type="search"
            value={qInput}
            onChange={(e) => onQChange(e.target.value)}
            placeholder="Name, org, or upstream"
            autoComplete="off"
          />
        </label>
        <fieldset className="publisher-chips">
          <legend>Filter by publisher</legend>
          <button
            type="button"
            className="chip"
            aria-pressed={selectedPublisher === null}
            onClick={() => onPublisherChange(null)}
          >
            All
          </button>
          {publishers.map((p) => (
            <button
              key={p.name}
              type="button"
              className="chip"
              aria-pressed={selectedPublisher === p.name}
              onClick={() => onPublisherChange(selectedPublisher === p.name ? null : p.name)}
            >
              {p.name}
            </button>
          ))}
        </fieldset>
      </div>
      {loading ? (
        <Loading label="Loading models" />
      ) : error ? (
        <ErrorState error={error} what="models" />
      ) : items.length === 0 ? (
        <EmptyState
          title={filtered ? "No names match this filter." : `No names indexed yet on ${chain}.`}
        >
          {filtered ? null : (
            <p>
              Publish one: <code>enspack publish --from-hf &lt;org/repo&gt;</code>.
            </p>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="model-table-wrap">
            <table className="model-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Publisher</th>
                  <th scope="col">License</th>
                  <th scope="col">Size</th>
                  <th scope="col">Latest</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.model}>
                    <td>
                      <Link
                        className="model-display"
                        to={`/name/${encodeURIComponent(item.model)}`}
                      >
                        {displayFromModel(item.model)}
                      </Link>
                      <Hash value={item.model} />
                    </td>
                    <td>
                      <Link
                        className="chip chip-link"
                        to={`/publisher/${encodeURIComponent(item.publisher)}`}
                      >
                        {item.publisher}
                      </Link>
                    </td>
                    <td>
                      <LicenseBadge license={item.license} />
                    </td>
                    <td className="num">{formatBytes(item.totalSize)}</td>
                    <td className="mono">{item.latest.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor !== null && (
            <button type="button" className="load-more" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
