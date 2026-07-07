/**
 * Shared slug-routed selection for list ↔ detail apps.
 *
 * Many list ↔ detail apps run on the same pattern: a home list at `/`,
 * a detail page at `/:slug`. This hook owns the URL ↔ selection
 * round-trip — extracting the slug from the path, resolving it to a
 * row, surviving renames, and syncing `pushState` / `replaceState` /
 * `popstate`.
 *
 * Composes with {@link useFilterQuery} so a single filter input in the
 * topbar clears automatically on every home ↔ detail transition.
 *
 * Load-bearing rules — see {@link resolveSlugSelection}:
 *  1. When a selection already exists, prefer matching the new rows by id.
 *     A rename (slug changed, id stable) keeps tracking the same row, and
 *     the URL is `replaceState`d to the new slug.
 *  2. Do not clear the selection on a transient empty-rows window. On
 *     reload, `useResource` reports `loading=false, rows=[]` for one tick
 *     before the fetch resolves; a naive "clear if not found" would
 *     bounce the detail page to home. Holding the last selection until a
 *     real match arrives is the fix.
 *  3. An empty/missing URL slug always means home — clear selection.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useFilterQuery } from "./useFilterQuery";
import type { Row, UseResourceResult } from "./useResource";

type SluggableExtra = { slug?: string };

export type UseSlugRoutingOptions<TExtra extends SluggableExtra> = {
  /** Hoisted resource — used both as the lookup table for slug → row and
   * (via SSE-driven `rows` updates) as the signal that a rename happened. */
  resource: UseResourceResult<TExtra>;
  /** Gate URL resolution on auth (or whatever else needs to settle first).
   * Until true, the hook neither resolves the URL slug nor reacts to row
   * updates. Matches the `enabled` flag passed to `useResource`. */
  enabled: boolean;
  /** Path prefixes that should NOT be treated as slugs — e.g. `api/`,
   * `pues/`, `dist/`, app-specific reserved namespaces. Compared against
   * the path after the leading `/` is stripped. */
  excludePathPrefixes?: string[];
  /** Optional async fallback when the slug isn't in `resource.rows`. Use
   * for apps that can hydrate the detail row from an offline cache or
   * a dedicated `resolveSlug`-style endpoint. Called only when there is
   * no existing selection to hold; result becomes the selection if
   * non-null. */
  resolveExternal?: (slug: string) => Promise<Row<TExtra> | null>;
  /** Fired when a rename causes the selected row's slug to change. Pass
   * any app-specific side effect — e.g. re-keying an offline cache from
   * old slug to new. The hook itself handles `window.history.replaceState`. */
  onSlugChanged?: (oldSlug: string, newSlug: string) => void;
};

export type UseSlugRoutingResult<TExtra extends SluggableExtra> = {
  selected: Row<TExtra> | null;
  /** Push a new history entry and select the row. Use when the user
   * navigates into a detail page. */
  select: (row: Row<TExtra>) => void;
  /** Push `/` and clear the selection. Use for the back button. */
  goBack: () => void;
  /** Filter-query state shared by the home list and the detail page.
   * Automatically clears on every home ↔ detail transition via
   * {@link useFilterQuery}. */
  filterQuery: string;
  setFilterQuery: (next: string | ((prev: string) => string)) => void;
};

/** Read the slug segment from `window.location.pathname`, returning null
 * for the root path or any path that starts with a reserved prefix. */
export function getSlugFromPath(
  excludePathPrefixes: string[] = [],
): string | null {
  const path = window.location.pathname;
  if (path === "/" || path === "") return null;
  const slug = path.slice(1);
  for (const prefix of excludePathPrefixes) {
    if (slug.startsWith(prefix)) return null;
  }
  return slug || null;
}

/**
 * Pure selection-resolution kernel. Given the current rows, the URL
 * slug, and the currently-selected id (if any), decide what the next
 * selection should be. Encodes the three load-bearing rules above.
 *
 * Returns an `action`:
 *  - `"clear"`: no slug in URL — caller sets selection to null.
 *  - `"hold"`: slug present but no match yet — caller keeps last selection.
 *  - `"select"`: a row matched. If `replaceUrl` is non-null, the URL
 *    should be replaceState'd to that slug (rename case).
 */
export function resolveSlugSelection<
  R extends { id: string | number; slug?: string },
>(opts: {
  rows: R[];
  slug: string | null;
  currentSelectedId: string | number | null;
}):
  | { action: "clear" }
  | { action: "hold" }
  | { action: "select"; row: R; replaceUrl: string | null } {
  const { rows, slug, currentSelectedId } = opts;
  if (!slug) return { action: "clear" };

  const byId =
    currentSelectedId != null
      ? rows.find((r) => r.id === currentSelectedId)
      : undefined;
  const found = byId ?? rows.find((r) => r.slug === slug);
  if (!found) return { action: "hold" };

  const replaceUrl = found.slug && found.slug !== slug ? found.slug : null;
  return { action: "select", row: found, replaceUrl };
}

export function useSlugRouting<TExtra extends SluggableExtra>(
  opts: UseSlugRoutingOptions<TExtra>,
): UseSlugRoutingResult<TExtra> {
  const {
    resource,
    enabled,
    excludePathPrefixes,
    resolveExternal,
    onSlugChanged,
  } = opts;
  const [selected, setSelected] = useState<Row<TExtra> | null>(null);
  const [filterQuery, setFilterQuery] = useFilterQuery(selected?.id ?? null);

  // Listener-stable view of rows for the popstate handler — keeps the
  // listener bound once instead of rebinding on every SSE mutation.
  const rowsRef = useRef(resource.rows);
  rowsRef.current = resource.rows;

  // Stable refs for consumer callbacks so the popstate effect can stay
  // mounted once for the lifetime of the component.
  const resolveExternalRef = useRef(resolveExternal);
  resolveExternalRef.current = resolveExternal;
  const onSlugChangedRef = useRef(onSlugChanged);
  onSlugChangedRef.current = onSlugChanged;

  // Resolve the URL slug → selection. Re-runs on `enabled` + every rows
  // update (so renames flow through) + every selected.id change. The
  // pure kernel encodes the load-bearing rules; this effect just wires
  // up the side effects (setSelected, replaceState, onSlugChanged, and
  // the resolveExternal fallback).
  const excludeKey = excludePathPrefixes?.join("|");
  useEffect(() => {
    if (!enabled) return;
    const slug = getSlugFromPath(excludePathPrefixes);
    const result = resolveSlugSelection<Row<TExtra>>({
      rows: resource.rows,
      slug,
      currentSelectedId: selected?.id ?? null,
    });
    if (result.action === "clear") {
      setSelected(null);
      return;
    }
    if (result.action === "select") {
      setSelected(result.row);
      if (result.replaceUrl != null && slug != null) {
        window.history.replaceState(null, "", `/${result.replaceUrl}`);
        onSlugChangedRef.current?.(slug, result.replaceUrl);
      }
      return;
    }
    // "hold": no row found yet. If a resolveExternal is configured AND
    // there's no existing selection to hold, try it.
    if (selected || !slug || !resolveExternalRef.current) return;
    let cancelled = false;
    void resolveExternalRef.current(slug).then((row) => {
      if (!cancelled && row) setSelected(row);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, resource.rows, selected?.id, selected, excludeKey]);

  // Browser back/forward — re-resolve from the new URL against the
  // latest rows (or the external resolver).
  useEffect(() => {
    const onPopState = () => {
      const slug = getSlugFromPath(excludePathPrefixes);
      if (!slug) {
        setSelected(null);
        return;
      }
      const found = rowsRef.current.find((r) => r.slug === slug);
      if (found) {
        setSelected(found);
        return;
      }
      const ext = resolveExternalRef.current;
      if (!ext) {
        setSelected(null);
        return;
      }
      void ext(slug).then((row) => setSelected(row ?? null));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [excludeKey]);

  const select = useCallback((row: Row<TExtra>) => {
    setSelected(row);
    const slug = row.slug ?? String(row.id);
    window.history.pushState(null, "", `/${slug}`);
  }, []);

  const goBack = useCallback(() => {
    setSelected(null);
    window.history.pushState(null, "", "/");
  }, []);

  return { selected, select, goBack, filterQuery, setFilterQuery };
}
