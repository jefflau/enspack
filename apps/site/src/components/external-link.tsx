import type { ReactNode } from "react";

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} rel="noreferrer" target="_blank" className={className}>
      {children}
    </a>
  );
}
