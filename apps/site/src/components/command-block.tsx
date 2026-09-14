import { CopyButton } from "./copy-button.js";

/** Copyable `<pre>` for CLI snippets. Styled by the importing page (get-started.css). */
export function CommandBlock({ command }: { command: string }) {
  return (
    <div className="command-block">
      <pre>
        <code>{command}</code>
      </pre>
      <CopyButton value={command} />
    </div>
  );
}
