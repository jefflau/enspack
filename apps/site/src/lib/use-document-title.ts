import { useEffect } from "react";

const SUFFIX = "enspack";

/** Sets `document.title` for the current page; pass `null` while data is still loading. */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    const previous = document.title;
    document.title = title === "" ? SUFFIX : `${title} · ${SUFFIX}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
