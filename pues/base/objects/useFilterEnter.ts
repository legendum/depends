/**
 * "Enter opens the first match" — the keyboard half of pues' filter feature.
 * Pair with `useFilter` (for `active`) and `<FilterBar>` (whose input ref you
 * forward here as `inputRef`).
 *
 * While the filter is active, pressing Enter inside the filter input fires
 * `onEnter`. Deliberately opinion-free about what "first match" means: the
 * consumer decides the target (open the top visible row, a synthetic header
 * row, nothing if the list is empty) — mirroring how `useFilter` stays
 * opinion-free about row shape. No-op while the filter is inactive.
 */

import { type RefObject, useEffect } from "react";

export type UseFilterEnterOptions = {
  inputRef: RefObject<HTMLInputElement | null> | undefined;
  active: boolean;
  onEnter: () => void;
};

export function useFilterEnter({
  inputRef,
  active,
  onEnter,
}: UseFilterEnterOptions): void {
  useEffect(() => {
    const input = inputRef?.current;
    if (!input || !active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      onEnter();
    };
    input.addEventListener("keydown", onKeyDown);
    return () => input.removeEventListener("keydown", onKeyDown);
  }, [inputRef, active, onEnter]);
}
