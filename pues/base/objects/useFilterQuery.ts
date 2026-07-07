/**
 * Shared filter-query state for a list ↔ detail pair, with an automatic
 * reset when `selectionKey` transitions.
 *
 * The home list and detail view typically share a single filter input
 * (rendered in the topbar) but the meaning differs — e.g. filtering lists
 * by name on home, filtering items by body on detail. Clearing on every
 * transition (none → x, x → none, x → y) keeps one screen's filter from
 * bleeding into the other.
 *
 * Pass the consumer's "what is currently selected" value as `selectionKey`
 * (the row id when on detail, `null` when on home). Identity-compared with
 * `!==`, so a stable id is enough.
 */

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

export function useFilterQuery(
  selectionKey: string | number | null,
): [string, Dispatch<SetStateAction<string>>] {
  const [query, setQuery] = useState("");
  const lastKey = useRef(selectionKey);
  useEffect(() => {
    if (lastKey.current !== selectionKey) {
      lastKey.current = selectionKey;
      setQuery("");
    }
  }, [selectionKey]);
  return [query, setQuery];
}
