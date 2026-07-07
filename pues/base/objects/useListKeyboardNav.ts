/**
 * Keyboard navigation for a row list — the keyboard-driving companion of
 * `useFilter` / `useFilterEnter`. Opinion-free about row shape (you pass the
 * rows array and an `onActivate(row)` callback) and about rendering (apply the
 * `pues-row-nav` class + `data-pues-nav-index={i}` attribute to your rows; the
 * hook scrolls the highlighted one into view by that attribute).
 *
 * - Ctrl+] / Ctrl+[ : move the highlight to the next / previous row, wrapping
 *                     at the ends.
 * - Enter           : activate the highlight — from anywhere, including the
 *                     focused filter input; other fields (a dialog's input, a
 *                     textarea) keep Enter for themselves.
 * - Escape          : blur the filter input if it's focused, else clear the
 *                     highlight ("select none"). Only acts when something is
 *                     highlighted, so it leaves modal Escape (`useEscape`)
 *                     untouched.
 *
 * `active` gates the whole thing — pass `false` while another surface owns these
 * keys (e.g. a detail page layered over the list). The highlight resets to none
 * when `resetKey` changes (pass your filter query so a new search starts fresh)
 * and clamps if the list shrinks under the cursor.
 *
 * The scroll lookup is document-wide by `data-pues-nav-index`, so render at most
 * one keyboard-navigable list at a time on a page.
 */

import { type RefObject, useEffect, useRef, useState } from "react";

export type UseListKeyboardNavOptions<T> = {
  /** The rows in display order — index `i` pairs with `data-pues-nav-index={i}`. */
  rows: T[];
  /** Gate: when false the listeners detach (another surface owns the keys). */
  active: boolean;
  /** Called with the highlighted row on Enter. */
  onActivate: (row: T) => void;
  /** The filter input, if any: Enter from it activates the highlight, and
   *  Escape from it blurs it. */
  filterInputRef?: RefObject<HTMLInputElement | null>;
  /** Clears the highlight when it changes — pass the filter query so a new
   *  search starts with no stale highlight. */
  resetKey?: unknown;
};

export type UseListKeyboardNavResult = {
  /** Index of the highlighted row, or -1 for none. */
  highlight: number;
};

export function useListKeyboardNav<T>({
  rows,
  active,
  onActivate,
  filterInputRef,
  resetKey,
}: UseListKeyboardNavOptions<T>): UseListKeyboardNavResult {
  const [highlight, setHighlight] = useState(-1);

  // Keep the latest rows/highlight in refs so the window listener stays mounted
  // once (no re-subscribe per render / per keystroke).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;

  // A new search (or whatever resetKey tracks) starts fresh.
  useEffect(() => setHighlight(-1), [resetKey]);

  // Clamp if the list shrank under the cursor (e.g. a row was deleted/filtered).
  useEffect(() => {
    setHighlight((h) => (h >= rows.length ? rows.length - 1 : h));
  }, [rows.length]);

  // Scroll the highlighted row into view as it moves.
  useEffect(() => {
    if (highlight < 0) return;
    document
      .querySelector(`[data-pues-nav-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.metaKey || e.shiftKey) return;
      if (e.ctrlKey && (e.key === "]" || e.key === "[")) {
        const n = rowsRef.current.length;
        if (n === 0) return;
        e.preventDefault();
        setHighlight((h) => {
          const cur = h < 0 ? (e.key === "]" ? -1 : 0) : h;
          return e.key === "]" ? (cur + 1) % n : (cur - 1 + n) % n;
        });
        return;
      }
      if (e.key === "Enter" && !e.ctrlKey) {
        // Enter activates the highlight from anywhere — including the focused
        // filter input — but not from other fields (a dialog's input owns it).
        const el = e.target as HTMLElement | null;
        const isField =
          !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
        if (isField && el !== filterInputRef?.current) return;
        const row = rowsRef.current[highlightRef.current];
        if (row) {
          e.preventDefault();
          onActivate(row);
        }
        return;
      }
      if (e.key === "Escape") {
        // Escape in the filter input drops focus back to the page.
        const input = filterInputRef?.current;
        if (input && e.target === input) {
          e.preventDefault();
          input.blur();
          return;
        }
        // Otherwise clear the highlight, but only when something is highlighted,
        // so it doesn't swallow Escape from dialogs.
        if (highlightRef.current >= 0) {
          e.preventDefault();
          setHighlight(-1);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onActivate, filterInputRef]);

  return { highlight };
}
