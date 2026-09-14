import { CopyButton } from "./copy-button.js";

const QWEN_EXAMPLE = "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth";

export function Hero({ firstModel }: { firstModel?: string }) {
  const name = firstModel ?? QWEN_EXAMPLE;
  const command = `enspack get ${name}`;
  return (
    <header className="home-hero">
      <h1 className="home-hero-title">Model weights with a name you can verify.</h1>
      <p className="home-hero-sub">
        An ENS name points at a content-addressed manifest; every file is SHA-256 checked; bytes
        come from BitTorrent + HF webseeds, never trusted.
      </p>
      <div className="command-block">
        <pre>
          <code>{command}</code>
        </pre>
        <CopyButton value={command} />
      </div>
    </header>
  );
}
