import { Link, useParams } from "react-router";
import { Badge, LicenseBadge } from "../components/badge.js";
import { CopyButton } from "../components/copy-button.js";
import { ExternalLink } from "../components/external-link.js";
import { Hash } from "../components/hash.js";
import { EmptyState, ErrorState, Loading } from "../components/states.js";
import type { Attestation, NameListItem } from "../lib/api.js";
import { useClient } from "../lib/client-context.js";
import type { IndexClient } from "../lib/client.js";
import { config } from "../lib/config.js";
import { explorerTx, firstLabel, formatBytes, hfUrl, isTxHash } from "../lib/format.js";
import { useDocumentTitle } from "../lib/use-document-title.js";
import { useQuery } from "../lib/use-query.js";
import "../styles/pages/publisher.css";

function decodePublisherParam(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

async function loadPublisherPage(client: IndexClient, name: string) {
  const [pubs, namesPage, attestation] = await Promise.all([
    client.listPublishers(),
    client.listNames({ publisher: name }),
    // Spec §4.3: missing or unreachable attestation is absence, not a page error.
    client
      .getAttestation(firstLabel(name))
      .catch(() => null),
  ]);
  return {
    publisher: pubs.items.find((p) => p.name === name) ?? null,
    models: namesPage.items,
    attestation,
  };
}

function attestationItemKey(item: unknown, i: number): string {
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
    return String(item);
  }
  return String(i);
}

/** Addresses, commits, signatures: full hex plus a copy control. Tx hashes stay explorer links. */
function isCopyableHex(value: unknown): value is string {
  return typeof value === "string" && /^(?:0x)?[0-9a-fA-F]{40,}$/.test(value);
}

function AttestationValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="muted">—</span>;
  }
  if (isTxHash(value)) {
    return (
      <ExternalLink href={explorerTx(config.chain, value)} className="mono">
        {value}
      </ExternalLink>
    );
  }
  if (isCopyableHex(value)) {
    return <Hash value={value} />;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">[]</span>;
    return (
      <div className="attestation-list">
        {value.map((item, i) => (
          <div key={attestationItemKey(item, i)}>
            <AttestationValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    return <pre className="attestation-pre">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <span>{String(value)}</span>;
}

function AttestationTable({ data }: { data: Attestation }) {
  return (
    <div className="publisher-table-wrap">
      <table className="publisher-table">
        <tbody>
          {Object.entries(data).map(([key, value]) => (
            <tr key={key}>
              <th scope="row">{key}</th>
              <td>
                <AttestationValue value={value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Hash + in-app link without nesting a button inside the `<a>`. */
function ModelNameLink({ name }: { name: string }) {
  return (
    <span className="hash">
      <Link
        to={`/name/${encodeURIComponent(name)}`}
        className="hash-value publisher-name-link"
        title={name}
      >
        {name}
      </Link>
      <CopyButton value={name} />
    </span>
  );
}

function PublisherModelTable({ items }: { items: NameListItem[] }) {
  if (items.length === 0) {
    return <p className="publisher-empty-models">No models indexed for this publisher.</p>;
  }
  return (
    <div className="publisher-table-wrap">
      <table className="publisher-table">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">License</th>
            <th scope="col">Size</th>
            <th scope="col">Latest</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.model}>
              <td>
                <ModelNameLink name={item.model} />
              </td>
              <td>
                <LicenseBadge license={item.license} />
              </td>
              <td>{formatBytes(item.totalSize)}</td>
              <td className="mono">{item.latest.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PublisherPage() {
  const { label: rawLabel } = useParams();
  const name = decodePublisherParam(rawLabel);
  const client = useClient();
  const { data, error, loading } = useQuery(`publisher:${name ?? ""}`, () =>
    name === null
      ? Promise.resolve({ publisher: null, models: [] as NameListItem[], attestation: null })
      : loadPublisherPage(client, name),
  );

  useDocumentTitle(name);

  if (name === null) {
    return <EmptyState title="Unknown publisher" />;
  }
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} what="publisher" />;
  if (data === null || data.publisher === null) {
    return <EmptyState title="Unknown publisher" />;
  }

  const { publisher, models, attestation } = data;
  const modelLabel = publisher.models === 1 ? "model" : "models";

  return (
    <article className="publisher-page">
      <header className="publisher-header">
        <h1>
          <Hash value={publisher.name} />
        </h1>
        <p className="publisher-meta">
          {publisher.hf !== null && (
            <span className="publisher-hf">
              <ExternalLink href={hfUrl(publisher.hf)}>{publisher.hf}</ExternalLink>
              <Badge tone="ok">HF verified</Badge>
            </span>
          )}
          <span>
            {publisher.models} {modelLabel}
          </span>
        </p>
      </header>

      <section className="publisher-section" aria-labelledby="publisher-attestation">
        <h2 id="publisher-attestation">Attestation</h2>
        {attestation === null ? (
          <p className="publisher-attestation-note">
            No registrar attestation. This name is not issued through the enspack.eth registrar
            (e.g. <code>mirrors.enspack.eth</code>, or a self-owned <code>.eth</code>).
          </p>
        ) : (
          <AttestationTable data={attestation} />
        )}
      </section>

      <section className="publisher-section" aria-labelledby="publisher-models">
        <h2 id="publisher-models">Models</h2>
        <PublisherModelTable items={models} />
      </section>
    </article>
  );
}
