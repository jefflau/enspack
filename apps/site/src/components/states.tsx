import type { ReactNode } from "react";
import { ApiError } from "../lib/api.js";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <output className="state state-loading" aria-live="polite">
      {label}…
    </output>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorState({ error, what = "data" }: { error: Error; what?: string }) {
  const detail =
    error instanceof ApiError
      ? error.status === 0
        ? "The indexer could not be reached."
        : `The indexer answered ${error.status} (${error.code}).`
      : error.message;
  return (
    <div className="state state-error" role="alert">
      <p className="state-title">Could not load {what}</p>
      <p className="muted">{detail}</p>
    </div>
  );
}
