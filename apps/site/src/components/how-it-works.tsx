const STEPS = [
  {
    title: "Name",
    artifact: "v1-0-0.qwen--….mirrors.enspack.eth",
    trust: "The owner key of this name is the only party that can point it at a manifest.",
  },
  {
    title: "Manifest",
    artifact: "contenthash → bafy…",
    trust: "The CID is the hash of the JSON; a gateway cannot change it.",
  },
  {
    title: "Bytes",
    artifact: "magnet:?xt=urn:btih:… + webseeds",
    trust: "Peers and HF webseeds serve files; none is a source of truth.",
  },
  {
    title: "Verify",
    artifact: "sha256 per file → .enspack-quarantine/",
    trust: "Every file is checked by size then SHA-256; a mismatch is quarantined.",
  },
] as const;

export function HowItWorks() {
  return (
    <section className="how-it-works" aria-labelledby="how-it-works-heading">
      <h2 id="how-it-works-heading" className="home-section-title">
        How it works
      </h2>
      <ol className="how-cards">
        {STEPS.map((step) => (
          <li key={step.title} className="card how-card">
            <h3 className="how-card-title">{step.title}</h3>
            <code className="how-artifact">{step.artifact}</code>
            <p className="how-trust">{step.trust}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
