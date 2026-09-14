import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger";

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  title?: string;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

const ROLE_TONE: Record<string, BadgeTone> = {
  weight: "accent",
  config: "neutral",
  tokenizer: "neutral",
  index: "neutral",
  doc: "neutral",
  license: "warn",
  code: "neutral",
  other: "neutral",
};

export function RoleBadge({ role }: { role: string | undefined }) {
  const r = role ?? "other";
  return <Badge tone={ROLE_TONE[r] ?? "neutral"}>{r}</Badge>;
}

export function LicenseBadge({ license, href }: { license: string; href?: string }) {
  const badge = <Badge tone="ok">{license}</Badge>;
  return href ? (
    <a href={href} rel="noreferrer" target="_blank" className="badge-link">
      {badge}
    </a>
  ) : (
    badge
  );
}
