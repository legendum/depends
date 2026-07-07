/**
 * `<Dialog title onClose>{children}</Dialog>` — shared modal-dialog
 * chrome. Click-outside-to-close, Escape-to-close (via `useEscape`),
 * portal-rendered so it sits above any positioning ancestor.
 *
 * Renders the `.pues-dialog-*` classes — the SPEC §8 prefix contract.
 * Default styling ships with the `style` part (`base/style/defaults.css`):
 *
 *   .pues-dialog-overlay  — full-viewport overlay; click closes
 *   .pues-dialog          — the dialog panel; stopPropagation
 *   .pues-dialog-header   — header bar with title + × (pinned)
 *   .pues-dialog-close    — the × button
 *   .pues-dialog-body     — scrollable content slot (provided by Dialog)
 *   .pues-dialog-footer   — optional pinned action bar (only when `footer` set)
 *
 * Consumers vendoring the `style` part inherit a working dialog for
 * free; consumers without `style` can supply their own `.pues-dialog-*`
 * rules. The `className` prop adds an extra class to the dialog panel
 * for size / variant overrides (e.g. `pues-dialog--wide`).
 *
 * The body slot is `children` — render whatever inside. If you want a
 * scrollable body with consistent padding, the `.pues-dialog-body`
 * wrapper provides it.
 */

import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscape } from "./useEscape";

export type DialogProps = {
  /** Heading content in the header bar — a string, or rich nodes (e.g. a
   *  status pill beside text). Rendered inside the header `<h2>`. */
  title: ReactNode;
  /** Called on overlay click, × button, or Escape key. */
  onClose: () => void;
  /** Body content (anything React renderable). Goes inside the
   * `.pues-dialog-body` wrapper. */
  children: ReactNode;
  /** Optional pinned footer (e.g. an action bar) — mirrors the header: stays put
   *  with a top border while the body scrolls. Omit for a footerless dialog
   *  (most are). Rendered inside `.pues-dialog-footer`. */
  footer?: ReactNode;
  /** Extra class added to the dialog panel for size / variant
   * overrides (e.g. `pues-dialog--wide`). */
  className?: string;
};

export function Dialog({
  title,
  onClose,
  children,
  footer,
  className,
}: DialogProps): ReactElement | null {
  useEscape(true, onClose);

  if (typeof document === "undefined") return null;

  const panelClass = className ? `pues-dialog ${className}` : "pues-dialog";

  return createPortal(
    <div className="pues-dialog-overlay" onClick={onClose}>
      <div className={panelClass} onClick={(e) => e.stopPropagation()}>
        <div className="pues-dialog-header">
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button type="button" className="pues-dialog-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="pues-dialog-body">{children}</div>
        {footer ? <div className="pues-dialog-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
