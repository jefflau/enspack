import type { ReactNode } from "react";
import type { Manifest } from "../lib/api.js";
import type { Chain } from "../lib/config.js";
import { ensAppUrl, formatBytes, formatDate, ipfsUrl } from "../lib/format.js";
import { ExternalLink } from "./external-link.js";
import { Hash } from "./hash.js";

function BytesField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="trust-bytes-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function TrustChain({
  manifest,
  cid,
  chain,
}: {
  manifest: Manifest;
  cid: string;
  chain: Chain;
}) {
  const dist = manifest.distribution;
  const torrent = dist.torrent;
  const torrentCid = torrent?.cid;
  const torrentUrl = torrent?.url;
  const seeds = dist.seeds;
  const ipfs = dist.ipfs;
  const oci = dist.oci;
  const hb = dist.hb;

  return (
    <section className="trust-chain-section" aria-labelledby="trust-chain-heading">
      <h2 id="trust-chain-heading">Trust chain</h2>
      <ol className="trust-chain">
        <li className="trust-node">
          <span className="trust-dot" aria-hidden="true" />
          <div className="trust-body">
            <h3>ENS name</h3>
            <div className="trust-names">
              <div>
                <p className="trust-caption muted">Version (immutable)</p>
                <Hash value={manifest.name} href={ensAppUrl(chain, manifest.name)} />
              </div>
              <div>
                <p className="trust-caption muted">Model (mutable latest)</p>
                <Hash value={manifest.model} href={ensAppUrl(chain, manifest.model)} />
              </div>
            </div>
            <p className="trust-proves">Proves: the owner key of this name chose this manifest.</p>
          </div>
        </li>

        <li className="trust-node">
          <span className="trust-dot" aria-hidden="true" />
          <div className="trust-body">
            <h3>contenthash → CID</h3>
            <Hash value={cid} href={ipfsUrl(cid)} />
            <p className="trust-proves">
              Proves: the manifest bytes hash to this CID; a gateway cannot alter them.
            </p>
          </div>
        </li>

        <li className="trust-node">
          <span className="trust-dot" aria-hidden="true" />
          <div className="trust-body">
            <h3>Manifest</h3>
            <dl className="kv trust-manifest-kv">
              <dt>spec</dt>
              <dd>
                <code>{manifest.spec}</code>
              </dd>
              <dt>version</dt>
              <dd>
                <code>{manifest.version}</code>
              </dd>
              <dt>createdAt</dt>
              <dd>{formatDate(manifest.createdAt)}</dd>
              <dt>files</dt>
              <dd>{manifest.files.length}</dd>
              <dt>totalSize</dt>
              <dd>{formatBytes(manifest.totalSize)}</dd>
            </dl>
            <p className="trust-proves">
              Proves: the CID commits to this document; every file hash lives here.
            </p>
            <details className="trust-json">
              <summary>View JSON</summary>
              <pre>{JSON.stringify(manifest, null, 2)}</pre>
            </details>
          </div>
        </li>

        <li className="trust-node">
          <span className="trust-dot" aria-hidden="true" />
          <div className="trust-body">
            <h3>Bytes</h3>
            <dl className="trust-bytes">
              <BytesField label="infohash">
                <Hash value={dist.infohash} />
              </BytesField>
              <BytesField label="magnet">
                <Hash value={dist.magnet} href={dist.magnet} />
              </BytesField>
              {torrentCid !== undefined && (
                <BytesField label="torrent cid">
                  <Hash value={torrentCid} href={ipfsUrl(torrentCid)} />
                </BytesField>
              )}
              {torrentUrl !== undefined && (
                <BytesField label="torrent url">
                  <ExternalLink href={torrentUrl}>{torrentUrl}</ExternalLink>
                </BytesField>
              )}
              <BytesField label="webseeds">
                <ul className="trust-link-list">
                  {dist.webseeds.map((url) => (
                    <li key={url}>
                      <ExternalLink href={url}>{url}</ExternalLink>
                    </li>
                  ))}
                </ul>
              </BytesField>
              {seeds !== undefined && seeds.length > 0 && (
                <BytesField label="seeds">
                  <ul className="trust-link-list">
                    {seeds.map((seed) => (
                      <li key={seed}>
                        <code>{seed}</code>
                      </li>
                    ))}
                  </ul>
                </BytesField>
              )}
              {ipfs !== undefined && (
                <BytesField label="ipfs">
                  <Hash value={ipfs} href={ipfsUrl(ipfs)} />
                </BytesField>
              )}
              {oci !== undefined && (
                <BytesField label="oci">
                  <Hash value={oci} />
                </BytesField>
              )}
              {hb !== undefined && (
                <BytesField label="hb">
                  <Hash value={hb} />
                </BytesField>
              )}
            </dl>
            <p className="trust-proves">
              Proves: any peer or host can serve the bytes; none is trusted.
            </p>
          </div>
        </li>

        <li className="trust-node trust-node-verify">
          <span className="trust-dot" aria-hidden="true" />
          <div className="trust-body">
            <h3>Verify</h3>
            <p className="trust-verify">
              Every file below is checked by size then SHA-256 before install. A mismatch is
              quarantined to <code>.enspack-quarantine/{dist.infohash}/</code> and the command exits
              3.
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}
