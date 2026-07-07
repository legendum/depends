/**
 * Underlined tab strip — the shared, ARIA-correct `role="tablist"` the apps
 * previously hand-rolled (dojos' DojoDetail tab strip + ReviewDialog tabs).
 * Controlled: the parent owns the active id and renders the matching panel;
 * this is just the strip + its keyboard model.
 *
 * Keyboard (WAI-ARIA Tabs pattern, scoped to focus-within so it never collides
 * with page-level shortcuts):
 * - the strip is a single tab stop (roving `tabIndex` — only the active tab is
 *   focusable), so Tab lands on the active tab and Shift+Tab leaves the strip;
 * - Left / Right move between tabs, wrapping at the ends;
 * - Home / End jump to the first / last tab;
 * - activation is **automatic** — moving focus selects (fires `onChange`), and
 *   focus stays on the newly selected tab button (not the panel).
 *
 * Styling lives on `.pues-tabstrip*` in style/defaults.css. `size="dialog"` is
 * the tighter in-dialog variant; `scrollable` lets a narrow strip scroll
 * sideways instead of wrapping (mobile / many tabs).
 */

import type { ReactNode } from "react";
import { useRef } from "react";

export type TabItem<T extends string> = {
  /** Stable id — what `active`/`onChange` speak in. */
  id: T;
  /** Visible label. */
  label: ReactNode;
  /** Show a small attention dot on the tab (e.g. "has open issues"). */
  dot?: boolean;
};

export type TabStripProps<T extends string> = {
  tabs: ReadonlyArray<TabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  /** Scroll the strip sideways when the tabs don't fit (narrow / mobile)
   *  rather than wrapping them. Default false. */
  scrollable?: boolean;
  /** Visual size: `"page"` (default, larger page-level strip) or `"dialog"`
   *  (tighter, for in-dialog tabs). */
  size?: "page" | "dialog";
  /** Extra class names appended to the root tablist. */
  className?: string;
  /** Accessible name for the tablist (HTML `aria-label`). */
  ariaLabel?: string;
};

export function TabStrip<T extends string>({
  tabs,
  active,
  onChange,
  scrollable = false,
  size = "page",
  className,
  ariaLabel,
}: TabStripProps<T>) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Move selection to `id` and keep focus on its button (automatic activation).
  const select = (id: T) => {
    onChange(id);
    stripRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)
      ?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const n = tabs.length;
    if (n === 0) return;
    const i = tabs.findIndex((t) => t.id === active);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % n;
    else if (e.key === "ArrowLeft") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (target) select(target.id);
  };

  const rootClass = [
    "pues-tabstrip",
    size === "dialog" ? "pues-tabstrip--dialog" : null,
    scrollable ? "pues-tabstrip--scrollable" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={stripRef}
      className={rootClass}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`pues-btn-reset pues-tabstrip-tab${isActive ? " pues-tabstrip-tab--active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.dot ? (
              <span className="pues-tabstrip-dot" role="img" aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
