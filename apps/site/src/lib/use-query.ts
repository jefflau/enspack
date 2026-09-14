import { useEffect, useState } from "react";

export interface QueryState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Minimal async hook. `key` must change when the inputs change; the effect re-runs on it and
 * ignores results from superseded runs.
 */
export function useQuery<T>(key: string, run: () => Promise<T>): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: null, error: null, loading: true });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `run` is keyed by `key` on purpose
  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: null, loading: true });
    run().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            error: err instanceof Error ? err : new Error(String(err)),
            loading: false,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}
