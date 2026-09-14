import type { Manifest } from "../lib/api.js";
import { CopyButton } from "./copy-button.js";

function lockEntryJson(manifest: Manifest, cid: string): string {
  const entry: {
    resolved: string;
    cid: string;
    infohash: string;
    totalSize: number;
    select: string[];
    upstream?: { repo: string; revision: string };
  } = {
    resolved: manifest.name,
    cid,
    infohash: manifest.distribution.infohash,
    totalSize: manifest.totalSize,
    select: ["*"],
  };
  if (manifest.upstream !== undefined) {
    entry.upstream = {
      repo: manifest.upstream.repo,
      revision: manifest.upstream.revision,
    };
  }
  return JSON.stringify(
    {
      lockfileVersion: 1,
      models: {
        [manifest.model]: entry,
      },
    },
    null,
    2,
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="get-block">
      <div className="get-block-head">
        <span className="get-block-label">{label}</span>
        <CopyButton value={text} />
      </div>
      <pre>{text}</pre>
    </div>
  );
}

export function GetPanel({ manifest, cid }: { manifest: Manifest; cid: string }) {
  const getCmd = `enspack get ${manifest.model}`;
  const addCmd = `enspack add ${manifest.model}\nenspack install`;
  const lockJson = lockEntryJson(manifest, cid);

  return (
    <aside className="get-panel" aria-labelledby="get-heading">
      <h2 id="get-heading">Get it</h2>
      <CopyBlock label="get" text={getCmd} />
      <CopyBlock label="add + install" text={addCmd} />
      <details className="get-lock">
        <summary>enspack.lock entry</summary>
        <CopyBlock label="enspack.lock" text={lockJson} />
      </details>
      <p className="get-footnote muted">
        Requires <code>aria2c</code>. Installs into <code>$HF_HOME/hub</code>.
      </p>
    </aside>
  );
}
