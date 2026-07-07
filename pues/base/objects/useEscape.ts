/**
 * `useEscape(active, onEscape)` — window-scoped Escape-key handler with
 * capture-phase listener + preventDefault / stopPropagation.
 *
 * Use for modal-dismiss handlers in dialogs, sheets, and any other
 * full-screen overlay. The capture phase ensures we run before
 * descendant handlers (e.g. an open `<input>`'s own Escape behavior),
 * which is the right default for modal-close UX.
 *
 * `active` gates the listener — set to `false` (or omit by passing
 * `false`) to detach without unmounting the component. Components that
 * are themselves mounted-only-when-open can just pass `true`.
 *
 * Canonical version — see SPEC §3 / iter 9.
 */

import { useEffect } from "react";

export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, onEscape]);
}
