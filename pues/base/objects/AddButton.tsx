/**
 * Floating `+` button that POSTs `{ label }` to `/api/<name>`. Pairs with
 * `<ObjectList>` — the matching `<name>.created` SSE echo is dropped via
 * the resource's op_id, so the optimistic insert here never flickers.
 */

import { useCallback, useState } from "react";

import { usePuesFetch } from "../core/Pues";
import { type Row, useResource } from "./useResource";

export type AddButtonProps = {
  resource: string;
  /** Visible CTA label on the inline input. Defaults to "Add". */
  label?: string;
  /** Floating button glyph. Defaults to "+". */
  glyph?: string;
  placeholder?: string;
  basePath?: string;
  /** Receive the optimistically-inserted row (e.g. to navigate to it). */
  onCreated?: (row: Row) => void;
  /** Override the `fetch` implementation. Falls back to the value
   * supplied via `<Pues fetch={...}>`, then to the global `fetch`. */
  fetch?: typeof fetch;
};

export function AddButton({
  resource,
  label = "Add",
  glyph = "+",
  placeholder = "New item",
  basePath = "/api",
  onCreated,
  fetch: fetchOverride,
}: AddButtonProps) {
  const fetchImpl = usePuesFetch(fetchOverride);
  const r = useResource(resource, { basePath, fetch: fetchOverride });
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const opId = r.newOpId();
    // Optimistic insert at end of list. Server will return the canonical row;
    // we replace by id once the response arrives.
    const optimisticId = `__pending_${opId}`;
    const tail =
      r.rows.length > 0 ? r.rows[r.rows.length - 1]!.position + 1000 : 1000;
    const optimistic: Row = { id: optimisticId, label: text, position: tail };
    r.mutate((prev) => [...prev, optimistic]);

    try {
      const res = await fetchImpl(`${basePath}/${resource}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Op-Id": opId,
        },
        body: JSON.stringify({ label: text }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string; message?: string };
          // Prefer the human-readable `message` (e.g. "A fifo with URL X
          // already exists"); fall back to the `error` code if a
          // consumer only sends one. Same wire shape across the fleet.
          if (j?.message) msg = j.message;
          else if (j?.error) msg = j.error;
        } catch {
          /* keep msg */
        }
        r.mutate((prev) => prev.filter((row) => row.id !== optimisticId));
        setError(msg);
        return;
      }
      const created = (await res.json()) as Row;
      r.mutate((prev) =>
        prev.map((row) => (row.id === optimisticId ? created : row)),
      );
      onCreated?.(created);
      setValue("");
      setOpen(false);
    } catch (e) {
      r.mutate((prev) => prev.filter((row) => row.id !== optimisticId));
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [value, busy, r, basePath, resource, onCreated, fetchImpl]);

  // On open, lift the freshly-mounted form above the fixed bottom docks
  // (`.pues-theme-dock`, `.pues-logout`). A mobile keyboard auto-scrolls its
  // focused input into view; desktop has no keyboard and won't, so the in-flow
  // form would otherwise sit *under* the dock. This callback ref fires exactly
  // when the form mounts; `.pues-add-form`'s `scroll-margin-bottom` /
  // `margin-bottom` (defaults.css) reserve the dock's clearance + scroll runway.
  const liftIntoView = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, []);

  if (open) {
    return (
      <div className="pues-add-form" ref={liftIntoView}>
        <input
          className="pues-add-form__input"
          placeholder={placeholder}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            else if (e.key === "Escape") {
              setOpen(false);
              setValue("");
              setError(null);
            }
          }}
        />
        {error && <p className="pues-add-form__error">{error}</p>}
        <div className="pues-add-form__actions">
          <button
            type="button"
            className="pues-add-form__submit"
            onClick={() => void submit()}
            disabled={!value.trim() || busy}
          >
            {label}
          </button>
          <button
            type="button"
            className="pues-add-form__cancel"
            onClick={() => {
              setOpen(false);
              setValue("");
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="pues-add-button pues-shadow"
      aria-label={label}
      onClick={() => setOpen(true)}
    >
      {glyph}
    </button>
  );
}
