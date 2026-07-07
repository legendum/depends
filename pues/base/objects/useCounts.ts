/**
 * Client-side counts hook over `GET /api/<resource>/counts?by=<col>`
 * (SPEC §5.10).
 *
 * - Initial fetch populates `rows`.
 * - SSE events for the resource trigger a debounced refetch (creates,
 *   updates, deletes all change the aggregate). Reorders never do, so
 *   `${resource}.reordered` is not in the default trigger list.
 *
 * Wire shape: array of `{ value, n }` for top-level resources or
 * `{ parent_id, value, n }` for parent-scoped ones. Pues stays
 * opinion-free about index layout — consumers reshape into whatever
 * map (`countsByParent[parent][value]`) their UI wants.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePuesFetch } from "../core/Pues";
import { type SseEventHandler, useSSE } from "../sse/useSSE";

export type CountsRow = {
  /** Present only for parent-scoped resources. */
  parent_id?: string | number;
  value: string;
  n: number;
};

export type UseCountsOptions = {
  resource: string;
  by: string;
  basePath?: string;
  ssePath?: string;
  /** SSE event names that should trigger a debounced refetch. Defaults
   *  to [`${resource}.created`, `${resource}.updated`,
   *  `${resource}.deleted`]. Pass `[]` to disable SSE refresh. */
  triggerEvents?: string[];
  /** Debounce window in ms for SSE-triggered refetches. Defaults to 250.
   *  A burst of N events (e.g. bulk push) collapses to one refetch. */
  debounceMs?: number;
  /** If false, the hook neither fetches nor subscribes to SSE. When it
   *  flips back to true, the fetch fires. Defaults to true. */
  enabled?: boolean;
  /** Override the `fetch` implementation. Falls back to the value
   * supplied via `<Pues fetch={...}>`, then to the global `fetch`. */
  fetch?: typeof fetch;
};

export type UseCountsResult = {
  rows: CountsRow[];
  loading: boolean;
  error: Error | null;
  reload: () => void;
};

export function useCounts(opts: UseCountsOptions): UseCountsResult {
  const basePath = opts.basePath ?? "/api";
  const ssePath = opts.ssePath ?? "/api/events";
  const enabled = opts.enabled ?? true;
  const debounceMs = opts.debounceMs ?? 250;
  const fetchImpl = usePuesFetch(opts.fetch);

  const [rows, setRows] = useState<CountsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const tickRef = useRef(0);
  const [reloadTick, setReloadTick] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = `${basePath}/${opts.resource}/counts?by=${encodeURIComponent(opts.by)}`;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const myTick = ++tickRef.current;
    setLoading(true);
    setError(null);
    fetchImpl(url, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: CountsRow[]) => {
        if (myTick !== tickRef.current) return;
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (myTick !== tickRef.current) return;
        setError(e);
        setLoading(false);
      });
  }, [url, enabled, reloadTick, fetchImpl]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      reload();
    }, debounceMs);
  }, [debounceMs, reload]);

  // Memoize the trigger-event list so the handlers map stays stable
  // across renders when the caller passes a fresh array each time
  // (the default case).
  const triggerEventsProp = opts.triggerEvents;
  const triggerEventsKey = triggerEventsProp ? triggerEventsProp.join("|") : "";
  const triggerEvents = useMemo<string[]>(
    () =>
      triggerEventsProp ?? [
        `${opts.resource}.created`,
        `${opts.resource}.updated`,
        `${opts.resource}.deleted`,
      ],
    // triggerEventsKey collapses array identity to its contents so
    // a new-array-same-contents render doesn't churn handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [triggerEventsKey, opts.resource],
  );

  const handlers = useMemo(() => {
    const out: Record<string, SseEventHandler> = {};
    for (const name of triggerEvents) {
      out[name] = () => scheduleRefetch();
    }
    return out;
  }, [triggerEvents, scheduleRefetch]);

  useSSE(handlers, {
    path: ssePath,
    enabled: enabled && triggerEvents.length > 0,
  });

  // Clear any pending debounce on unmount so the last setTimeout
  // doesn't fire after the component is gone.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

  return { rows, loading, error, reload };
}
