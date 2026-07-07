/**
 * `useRename` — the optimistic-mutate + PATCH + rollback dance that's
 * otherwise duplicated across consumers (inline list rename, dialog
 * rename, detail-page rename via `<ObjectDetail>`).
 *
 * Sends `PATCH ${basePath}/${resourceName}/${rowId}` with
 * `X-Op-Id: <opId>` and body `{ label }`. The originating tab drops its
 * own echo (SPEC §7.2), so this hook also replaces the optimistic row
 * with the server-blessed response — that's what carries the new
 * `slug` (and any other server-derived passthroughs) back into
 * `resource.rows`. Without this final replacement, slug-derived URLs
 * would remain stale in the originating tab until an external event
 * re-broadcast the row.
 */

import { useCallback } from "react";

import { usePuesFetch } from "../core/Pues";
import type { Row, UseResourceResult } from "./useResource";

export type UseRenameOptions<TExtra = Record<string, unknown>> = {
  resource: UseResourceResult<TExtra>;
  /** Route segment, e.g. "lists" — used to build the PATCH URL. */
  resourceName: string;
  /** Defaults to "/api". Must match the `useResource` basePath. */
  basePath?: string;
  /** Override the `fetch` implementation. Falls back to the value
   * supplied via `<Pues fetch={...}>`, then to the global `fetch`. */
  fetch?: typeof fetch;
};

export type RenameOutcome<TExtra = Record<string, unknown>> =
  | { ok: true; row: Row<TExtra> | null }
  | { ok: false };

export type UseRenameResult<TExtra = Record<string, unknown>> = {
  /**
   * Rename a row. Trims whitespace; rejects empty strings.
   * On success: rows updated optimistically, then replaced with the
   * server response (so the new slug propagates). On failure: rolls
   * back to the pre-call snapshot.
   *
   * `extra` is merged into the PATCH body alongside `label` and applied
   * to the optimistic row update. Use for consumer-specific fields that
   * the dialog edits alongside the label (e.g. a `max_retries` field).
   * Server-side, the resource's `beforeUpdate` hook is responsible for
   * validating and persisting them. Do not put `label` in `extra` — it
   * is set from the `newLabel` argument; collisions are not defined.
   */
  rename: (
    rowId: string | number,
    newLabel: string,
    extra?: Record<string, unknown>,
  ) => Promise<RenameOutcome<TExtra>>;
};

export function useRename<TExtra = Record<string, unknown>>({
  resource,
  resourceName,
  basePath = "/api",
  fetch: fetchOverride,
}: UseRenameOptions<TExtra>): UseRenameResult<TExtra> {
  const fetchImpl = usePuesFetch(fetchOverride);
  const rename = useCallback(
    async (
      rowId: string | number,
      newLabel: string,
      extra?: Record<string, unknown>,
    ): Promise<RenameOutcome<TExtra>> => {
      const trimmed = newLabel.trim();
      if (!trimmed) return { ok: false };

      const opId = resource.newOpId();
      const snapshot = resource.rows;

      // Optimistic: update the label (and any extras) immediately. The
      // slug (if any) is still old here — the server-blessed row
      // replaces this below.
      resource.mutate((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, ...(extra ?? {}), label: trimmed } : r,
        ),
      );

      const res = await fetchImpl(
        `${basePath}/${resourceName}/${encodeURIComponent(String(rowId))}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Op-Id": opId,
          },
          body: JSON.stringify({ ...(extra ?? {}), label: trimmed }),
        },
      );

      if (!res.ok) {
        resource.mutate(snapshot);
        return { ok: false };
      }

      let row: Row<TExtra> | null = null;
      try {
        const parsed = (await res.json()) as unknown;
        if (parsed && typeof parsed === "object" && "id" in parsed) {
          row = parsed as Row<TExtra>;
        }
      } catch {
        // Non-JSON response (or empty). Leave the optimistic state in
        // place — the label is right; only slug/timestamps may be stale.
      }

      if (row) {
        const serverRow = row;
        resource.mutate((prev) =>
          prev.map((r) => (r.id === rowId ? serverRow : r)),
        );
      }

      return { ok: true, row };
    },
    [resource, resourceName, basePath, fetchImpl],
  );

  return { rename };
}
