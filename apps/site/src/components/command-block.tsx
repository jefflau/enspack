import { CopyButton } from "./copy-button.js";

/** Copyable CLI snippet; chrome comes from global `.cmd`. */
export function CommandBlock({ command }: { command: string }) {
  return (
    <div className="cmd">
      <pre>
        <code>{command}</code>
      </pre>
      <CopyButton value={command} />
    </div>
  );
}
