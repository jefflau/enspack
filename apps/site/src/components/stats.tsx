import { formatBytes } from "../lib/format.js";

export function Stats({
  models,
  publishers,
  bytes,
}: {
  models: number;
  publishers: number;
  bytes: number;
}) {
  return (
    <section className="home-stats" aria-label="Catalog stats">
      <div className="stat">
        <div className="stat-value">{models}</div>
        <div className="stat-label">models</div>
      </div>
      <div className="stat">
        <div className="stat-value">{publishers}</div>
        <div className="stat-label">publishers</div>
      </div>
      <div className="stat">
        <div className="stat-value">{formatBytes(bytes)}</div>
        <div className="stat-label">verified bytes</div>
      </div>
    </section>
  );
}
