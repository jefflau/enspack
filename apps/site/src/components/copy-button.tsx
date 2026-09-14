import { useEffect, useState } from "react";

/** The async clipboard API is denied in some embedded/permissioned contexts; fall back to execCommand. */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function onClick() {
    if (await copyText(value)) setCopied(true);
  }

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={onClick}
      aria-live="polite"
      aria-label={copied ? "Copied" : `${label} to clipboard`}
      data-copied={copied ? "true" : undefined}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
