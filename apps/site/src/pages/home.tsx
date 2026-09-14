import { useEffect, useState } from "react";
import { Hero } from "../components/hero.js";
import { HowItWorks } from "../components/how-it-works.js";
import { ModelList } from "../components/model-list.js";
import { Stats } from "../components/stats.js";
import type { ListNamesParams, NameListItem } from "../lib/api.js";
import { useClient } from "../lib/client-context.js";
import { config } from "../lib/config.js";
import { useQuery } from "../lib/use-query.js";
import "../styles/pages/home.css";

const SEARCH_DEBOUNCE_MS = 250;

function namesParams(q: string, publisher: string | null, cursor?: string): ListNamesParams {
  const params: ListNamesParams = {};
  if (q) params.q = q;
  if (publisher) params.publisher = publisher;
  if (cursor) params.cursor = cursor;
  return params;
}

export function HomePage() {
  const client = useClient();
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [publisher, setPublisher] = useState<string | null>(null);
  const [items, setItems] = useState<NameListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [namesError, setNamesError] = useState<Error | null>(null);

  const publishers = useQuery("publishers", () => client.listPublishers());

  useEffect(() => {
    if (qInput === q) return;
    const t = setTimeout(() => setQ(qInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qInput, q]);

  // useQuery resets on key change, which would drop already-loaded pages.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNamesError(null);
    client.listNames(namesParams(q, publisher)).then(
      (page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setNextCursor(null);
        setNamesError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, q, publisher]);

  function loadMore() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    client.listNames(namesParams(q, publisher, nextCursor)).then(
      (page) => {
        setItems((prev) => [...prev, ...page.items]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      },
      (err: unknown) => {
        setNamesError(err instanceof Error ? err : new Error(String(err)));
        setLoadingMore(false);
      },
    );
  }

  const first = items[0];
  const bytes = items.reduce((sum, item) => sum + item.totalSize, 0);
  const publisherCount = publishers.data?.items.length ?? 0;

  return (
    <article className="home">
      {first ? <Hero firstModel={first.model} /> : <Hero />}
      {!loading && namesError === null && (
        <Stats models={items.length} publishers={publisherCount} bytes={bytes} />
      )}
      <HowItWorks />
      <ModelList
        items={items}
        nextCursor={nextCursor}
        loading={loading}
        loadingMore={loadingMore}
        error={namesError}
        qInput={qInput}
        onQChange={setQInput}
        publishers={publishers.data?.items ?? []}
        selectedPublisher={publisher}
        onPublisherChange={setPublisher}
        onLoadMore={loadMore}
        chain={config.chain}
      />
    </article>
  );
}
