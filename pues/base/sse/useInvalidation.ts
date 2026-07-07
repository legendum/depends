/**
 * Subscribe to `<surface>.changed` invalidation signals and expose a per-surface
 * nonce that bumps whenever a matching event arrives — the surface-level
 * companion to `useResource`. `useResource` patches rows from
 * `.created/.updated/.deleted`; `useInvalidation` just says "this surface is
 * stale" for views that aren't flat rows, so you feed its nonce into a refetch
 * (a list's deps, or `useLiveFetch`).
 *
 * Three quirks it bakes in, so callers don't re-learn them the hard way:
 *  - No op_id minting → the actor's own broadcast is applied, not dropped (the
 *    whole point: everyone, including the writer, refetches).
 *  - `resync` (the server couldn't replay after a reconnect gap) bumps EVERY
 *    surface — there's no row to replay, so refetch all.
 *  - Optional `scope` filter: when many entities are multiplexed on one per-user
 *    stream, only bump when the event's `scope` matches, so an event for entity
 *    A doesn't refetch entity B's open view.
 *
 * `surfaces` must be a STABLE list (like a resource name) — pass a module-level
 * const or a memoized array; the SSE subscription is established once.
 */

import { useMemo, useState } from "react";
import { type SseEventHandler, useSSE } from "./useSSE";

export type ScopeValue = string | number | null;

export type UseInvalidationOptions = {
  /** Only bump when the event payload's `scope` equals this. Omit to bump on any. */
  scope?: ScopeValue;
  /** SSE path; defaults to useSSE's default (`/api/events`). */
  path?: string;
  enabled?: boolean;
};

/** Pure scope predicate (exported for tests): an undefined option scope matches
 *  anything; otherwise the event payload's `scope` field must equal it. */
export function invalidationScopeMatches(
  data: unknown,
  scope: ScopeValue | undefined,
): boolean {
  if (scope === undefined) return true;
  const got =
    data && typeof data === "object" && "scope" in (data as object)
      ? (data as { scope?: unknown }).scope
      : undefined;
  return got === scope;
}

export function useInvalidation(
  surfaces: readonly string[],
  options: UseInvalidationOptions = {},
): Record<string, number> {
  const { scope, path } = options;
  const [nonces, setNonces] = useState<Record<string, number>>(() =>
    Object.fromEntries(surfaces.map((s) => [s, 0])),
  );

  const handlers = useMemo(() => {
    const bumpAll = () =>
      setNonces((n) => {
        const next: Record<string, number> = {};
        for (const s of surfaces) next[s] = (n[s] ?? 0) + 1;
        return next;
      });
    const map: Record<string, SseEventHandler> = {};
    for (const surface of surfaces) {
      map[`${surface}.changed`] = (data) => {
        if (!invalidationScopeMatches(data, scope)) return;
        setNonces((n) => ({ ...n, [surface]: (n[surface] ?? 0) + 1 }));
      };
    }
    // The server couldn't replay missed events on reconnect → refetch everything.
    map.resync = bumpAll;
    return map;
  }, [surfaces, scope]);

  // No stream when there's nothing to watch — and never mint an op_id, so the
  // actor's own echo is applied, not suppressed.
  const enabled = (options.enabled ?? true) && surfaces.length > 0;
  useSSE(handlers, { path, enabled });
  return nonces;
}
