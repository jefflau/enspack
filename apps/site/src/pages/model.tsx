import { Link, useParams } from "react-router";
import { LicenseBadge } from "../components/badge.js";
import { ExternalLink } from "../components/external-link.js";
import { FilesTable } from "../components/files-table.js";
import { GetPanel } from "../components/get-panel.js";
import { Hash } from "../components/hash.js";
import { EmptyState, ErrorState, Loading } from "../components/states.js";
import { TrustChain } from "../components/trust-chain.js";
import { VersionsList } from "../components/versions-list.js";
import { ApiError, type NameDetail, type NameVersion } from "../lib/api.js";
import { useClient } from "../lib/client-context.js";
import { config } from "../lib/config.js";
import { ensAppUrl, formatBytes, shortHex } from "../lib/format.js";
import { useDocumentTitle } from "../lib/use-document-title.js";
import { useQuery } from "../lib/use-query.js";
import "../styles/pages/model.css";

function decodeNameParam(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Latest CID: the version whose name matches the manifest, else the last listed. */
function latestVersion(detail: NameDetail): NameVersion {
  const match = detail.versions.find((v) => v.name === detail.manifest.name);
  if (match !== undefined) return match;
  const last = detail.versions[detail.versions.length - 1];
  if (last !== undefined) return last;
  return detail.manifest.versions[0];
}

function ModelHeader({ detail }: { detail: NameDetail }) {
  const { manifest } = detail;
  const title = manifest.displayName ?? manifest.model;
  const upstream = manifest.upstream;
  const canonical = manifest.canonical;

  return (
    <header className="model-header">
      <h1 className="model-title">{title}</h1>
      <Hash value={manifest.model} className="model-name-hash" />
      <p className="model-meta">
        <Link
          className="model-publisher"
          to={`/publisher/${encodeURIComponent(manifest.publisher)}`}
        >
          {manifest.publisher}
        </Link>
        <LicenseBadge
          license={manifest.license}
          {...(manifest.licenseUrl !== undefined ? { href: manifest.licenseUrl } : {})}
        />
        <span>{formatBytes(manifest.totalSize)}</span>
        {upstream !== undefined && (
          <ExternalLink href={`${upstream.url}/tree/${upstream.revision}`}>
            {upstream.url} @{shortHex(upstream.revision)}
          </ExternalLink>
        )}
      </p>
      {canonical !== undefined && (
        <p className="model-canonical">
          Publisher-verified name:{" "}
          <Hash value={canonical} href={ensAppUrl(config.chain, canonical)} />
        </p>
      )}
    </header>
  );
}

export function ModelPage() {
  const { name: raw } = useParams();
  const name = decodeNameParam(raw);
  const client = useClient();
  const { data, error, loading } = useQuery(`name:${name ?? ""}`, () => {
    if (name === null) {
      return Promise.reject(new ApiError(404, "NOT_FOUND", "unknown name"));
    }
    return client.getName(name);
  });

  useDocumentTitle(data?.manifest.displayName ?? null);

  if (loading) return <Loading />;
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState title="Unknown name">
        <Link to="/">Home</Link>
      </EmptyState>
    );
  }
  if (error) return <ErrorState error={error} what="name" />;
  if (data === null) return <Loading />;

  const latest = latestVersion(data);

  return (
    <article className="model-page">
      <p className="model-status">
        Indexed from {config.chain}. Verification shown here is the indexer&apos;s; the CLI
        re-verifies every file locally.
      </p>
      <ModelHeader detail={data} />
      <div className="model-layout">
        <div className="model-main">
          <TrustChain manifest={data.manifest} cid={latest.cid} chain={config.chain} />
          <FilesTable files={data.manifest.files} totalSize={data.manifest.totalSize} />
          <VersionsList versions={data.versions} latestName={latest.name} />
        </div>
        <GetPanel manifest={data.manifest} cid={latest.cid} />
      </div>
    </article>
  );
}
