/**
 * Fetch JSON from `url` into a loading/error/ready state, refetching whenever
 * `url` or any of `deps` changes — the stale-while-revalidate read primitive for
 * bespoke endpoints that aren't pues `objects` resources. Returns
 * `[state, setState]` so a caller can optimistically patch the loaded data (e.g.
 * append a just-posted item) without waiting for a refetch.
 *
 * SWR: a refetch of the SAME url (a `deps`/nonce bump) keeps the last data on
 * screen instead of blanking to loading, and a failed *revalidation* keeps the
 * good data rather than erroring — only a genuinely new url resets to loading.
 *
 * `useLiveFetch` is just this hook + `useInvalidation`. Reach for `useFetch`
 * directly when the refetch trigger is a nonce you already hold — e.g. one shared
 * `useInvalidation` at the top of a multi-panel page feeding `deps: [nonce]` into
 * many views over a SINGLE SSE stream, rather than each view opening its own.
 *
 * (A generic fetch hook with no SSE of its own; it lives in `base/sse` as
 * `useLiveFetch`'s base so the live-data family stays in one part with no new
 * cross-part dependency.)
 */

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

export type FetchState<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

export type UseFetchOptions = {
  /** Extra refetch triggers — the fetch re-runs when any of these (or `url`)
   *  changes. Typically an invalidation nonce. */
  deps?: readonly unknown[];
  /** When false, skips fetching and leaves the current state untouched. */
  enabled?: boolean;
};

/** Pure state reducer for a completed fetch (exported for tests): success →
 *  ready; a failed *revalidation* keeps already-loaded data, an error with
 *  nothing on screen surfaces. The "blank to loading on a new url" rule lives in
 *  the effect (it needs the previous url), not here. */
export function reduceFetchState<T>(
  prev: FetchState<T>,
  outcome: { ok: true; data: T } | { ok: false; message: string },
): FetchState<T> {
  if (outcome.ok) return { kind: "ready", data: outcome.data };
  return prev.kind === "ready"
    ? prev
    : { kind: "error", message: outcome.message };
}

export function useFetch<T>(
  url: string,
  options: UseFetchOptions = {},
): [FetchState<T>, Dispatch<SetStateAction<FetchState<T>>>] {
  const { deps = [], enabled = true } = options;
  const [state, setState] = useState<FetchState<T>>({ kind: "loading" });
  const loadedUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // Only a genuinely new resource has no known state to show; a same-url
    // refetch (a dep/nonce bump) revalidates in place.
    if (loadedUrl.current !== url) setState({ kind: "loading" });
    fetch(url, { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as T;
      })
      .then((data) => {
        if (cancelled) return;
        loadedUrl.current = url;
        setState((prev) => reduceFetchState(prev, { ok: true, data }));
      })
      .catch((e) => {
        if (cancelled) return;
        setState((prev) =>
          reduceFetchState(prev, {
            ok: false,
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [url, enabled, ...deps]);

  return [state, setState];
}
