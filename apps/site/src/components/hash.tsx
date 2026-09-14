import { shortHex } from "../lib/format.js";
import { CopyButton } from "./copy-button.js";

/**
 * A hash, CID, name or magnet in monospace with a copy control. Full value by default; `short`
 * shows an abbreviation but keeps the full value in `title` and on the clipboard.
 */
export function Hash({
  value,
  short = false,
  href,
  className,
}: {
  value: string;
  short?: boolean;
  href?: string;
  className?: string;
}) {
  const text = short ? shortHex(value, 10, 6) : value;
  const inner = href ? (
    <a className="hash-value" href={href} title={value} rel="noreferrer" target="_blank">
      {text}
    </a>
  ) : (
    <code className="hash-value" title={short ? value : undefined}>
      {text}
    </code>
  );
  return (
    <span className={["hash", className].filter(Boolean).join(" ")}>
      {inner}
      <CopyButton value={value} />
    </span>
  );
}
