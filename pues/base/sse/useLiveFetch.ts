/**
 * `useFetch` + `useInvalidation`: fetch `url` and refetch in place whenever the
 * `invalidatedBy` surface broadcasts a `<surface>.changed` for the matching
 * `scope`. The detail-view companion to `useResource` — it closes the gap where
 * an open dialog's nested fetch (a comment thread, a computed diff) silently
 * goes stale, because the invalidation is DECLARED here rather than threaded as a
 * nonce prop you can forget to pass down.
 *
 * This hook opens its OWN SSE stream (one `useInvalidation`). For a page where
 * several views should share a single stream, prefer one top-level
 * `useInvalidation` feeding `useFetch(url, { deps: [nonce] })` per view — same
 * declarative refetch, one connection.
 *
 * Returns `[state, setState]` (see `useFetch`) so a caller can optimistically
 * patch before the echo; the next invalidation refetch reconciles to server
 * truth. With no `invalidatedBy` it degrades to a plain one-shot fetch.
 */

import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import { type FetchState, useFetch } from "./useFetch";
import { type ScopeValue, useInvalidation } from "./useInvalidation";

export type UseLiveFetchOptions = {
  /** Surface(s) whose `<surface>.changed` refetches this url. */
  invalidatedBy?: string | readonly string[];
  /** Scope filter (e.g. a parent entity id), passed to `useInvalidation`. */
  scope?: ScopeValue;
  path?: string;
  enabled?: boolean;
};

export function useLiveFetch<T>(
  url: string,
  options: UseLiveFetchOptions = {},
): [FetchState<T>, Dispatch<SetStateAction<FetchState<T>>>] {
  const { invalidatedBy, scope, path, enabled } = options;
  const surfaces = useMemo(
    () =>
      invalidatedBy == null
        ? []
        : typeof invalidatedBy === "string"
          ? [invalidatedBy]
          : invalidatedBy,
    [invalidatedBy],
  );
  const nonces = useInvalidation(surfaces, { scope, path, enabled });
  // Any bump on any watched surface changes this sum → useFetch refetches.
  let nonceSum = 0;
  for (const k in nonces) nonceSum += nonces[k] ?? 0;
  return useFetch<T>(url, { deps: [nonceSum], enabled });
}
