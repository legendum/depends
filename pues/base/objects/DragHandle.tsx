/**
 * Grab affordance for a dnd-kit sortable row. Spread the `listeners` from
 * `useSortable` onto it; the dotted glyph is the drag target.
 *
 * The `pues-drag-handle` class is also a gesture-arbitration marker: a
 * consumer's swipe / long-press hook does `closest('.pues-drag-handle')`
 * to bow out and let dnd-kit own the press. Styling (incl. `--disabled` and
 * `.pues-drag-overlay`) lives in `style/defaults.css`.
 */

import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";

export type DragHandleProps = {
  listeners?: SyntheticListenerMap;
  /** Render the inert placeholder shown when reorder is disabled: adds
   * `--disabled`, marks it `aria-hidden`, and ignores `listeners`. */
  disabled?: boolean;
};

export function DragHandle({ listeners, disabled }: DragHandleProps) {
  return (
    <div
      className={
        disabled
          ? "pues-drag-handle pues-drag-handle--disabled"
          : "pues-drag-handle"
      }
      aria-hidden={disabled || undefined}
      {...(disabled ? undefined : listeners)}
    >
      <svg viewBox="0 0 16 16" fill="currentColor">
        <circle cx="5" cy="3" r="1.5" />
        <circle cx="11" cy="3" r="1.5" />
        <circle cx="5" cy="8" r="1.5" />
        <circle cx="11" cy="8" r="1.5" />
        <circle cx="5" cy="13" r="1.5" />
        <circle cx="11" cy="13" r="1.5" />
      </svg>
    </div>
  );
}
