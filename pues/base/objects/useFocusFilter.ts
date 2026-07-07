/**
 * `useFocusFilter(inputRef, { active })` — Ctrl+F focuses and selects a filter
 * input from anywhere on the page, overriding the browser's native find. The
 * focus-half companion of `useFilter` / `<FilterBar>`; pairs with
 * `useListKeyboardNav` (which handles Escape-to-blur once focused).
 *
 * Mount it high (e.g. the app root) so Ctrl+F works across every screen that
 * shares the one filter input. `active` (default true) gates it for when another
 * surface should keep the browser's native find instead.
 */

import { type RefObject, useEffect } from "react";

export function useFocusFilter(
  inputRef: RefObject<HTMLInputElement | null> | undefined,
  opts?: { active?: boolean },
): void {
  const active = opts?.active ?? true;
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "f" && e.key !== "F") return;
      const input = inputRef?.current;
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputRef, active]);
}
