/**
 * `useDelete` — companion to `useRename` (iter 4). The optimistic
 * `mutate` + `X-Op-Id` DELETE + snapshot/rollback pattern documented
 * in SPEC §7.3. Mechanism only: consumers wrap with whatever
 * confirmation UI they want (bare, modal, undo toast, etc.).
 *
 * Sends `DELETE ${basePath}/${resourceName}/${rowId}` with
 * `X-Op-Id: <opId>`. The originating tab's own echo is dropped on the
 * SSE side (SPEC §7.2), so the optimistic local removal here is the
 * single source of truth for the originating tab. On non-2xx, the row
 * is restored from the pre-call snapshot.
 */

import { useCallback } from "react";

import { usePuesFetch } from "../core/Pues";
import type { Row, UseResourceResult } from "./useResource";

export type UseDeleteOptions<TExtra = Record<string, unknown>> = {
  resource: UseResourceResult<TExtra>;
  /** Route segment, e.g. "lists" — used to build the DELETE URL. */
  resourceName: string;
  /** Defaults to "/api". Must match the `useResource` basePath. */
  basePath?: string;
  /** Override the `fetch` implementation. Falls back to the value
   * supplied via `<Pues fetch={...}>`, then to the global `fetch`. */
  fetch?: typeof fetch;
};

export type DeleteOutcome = { ok: true } | { ok: false };

export type UseDeleteResult = {
  /**
   * Delete a row. Removes it optimistically; rolls back to the
   * pre-call snapshot if the server returns non-2xx.
   */
  del: (rowId: Row["id"]) => Promise<DeleteOutcome>;
};

/**
 * The DELETE dance, factored out for testability. The hook is a thin
 * wrapper that binds it to `useCallback`.
 */
export async function performDelete<TExtra = Record<string, unknown>>(
  resource: UseResourceResult<TExtra>,
  rowId: Row["id"],
  resourceName: string,
  basePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeleteOutcome> {
  const opId = resource.newOpId();
  const snapshot = resource.rows;

  resource.mutate((prev) => prev.filter((r) => r.id !== rowId));

  const res = await fetchImpl(
    `${basePath}/${resourceName}/${encodeURIComponent(String(rowId))}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { "X-Op-Id": opId },
    },
  );

  if (!res.ok) {
    resource.mutate(snapshot);
    return { ok: false };
  }

  return { ok: true };
}

export function useDelete<TExtra = Record<string, unknown>>({
  resource,
  resourceName,
  basePath = "/api",
  fetch: fetchOverride,
}: UseDeleteOptions<TExtra>): UseDeleteResult {
  const fetchImpl = usePuesFetch(fetchOverride);
  const del = useCallback(
    (rowId: Row["id"]) =>
      performDelete(resource, rowId, resourceName, basePath, fetchImpl),
    [resource, resourceName, basePath, fetchImpl],
  );

  return { del };
}
