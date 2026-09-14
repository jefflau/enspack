import { useEffect, useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // clipboard unavailable (insecure context); leave the value selectable instead
    }
  }

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={onClick}
      aria-label={copied ? "Copied" : `${label} to clipboard`}
      data-copied={copied ? "true" : undefined}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
