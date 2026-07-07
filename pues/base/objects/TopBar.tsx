/**
 * Fixed application top bar shared across fleet apps. Composes the pues
 * LogoButton + FilterBar on the left and an arbitrary `right` slot
 * (typically the auth <Legendum> widget — omitted in self-hosted builds,
 * which is why the widget is a slot rather than baked in: this keeps the
 * objects layer free of any auth dependency).
 *
 * Bakes the shared behavior the apps previously hand-rolled:
 * - pins the bar to the VISUAL viewport on iOS so opening the mobile
 *   keyboard (and any resulting page scroll) can't hide the header/filter;
 * - wires the logo button to open an app-supplied install/help dialog.
 *
 * Styling lives on `.pues-topbar*` in style/defaults.css.
 */

import type { ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { FilterBar } from "./FilterBar";
import { LogoButton } from "./LogoButton";

export type TopBarProps = {
  /** Logo image source (passed to LogoButton). Omit when supplying `logo`. */
  logoSrc?: string;
  /** Custom logo content (SVG/text), overriding `logoSrc`. */
  logo?: ReactNode;
  /** Logo button title, e.g. "About Todos"; also the default aria-label. */
  logoTitle?: string;
  /** Logo aria-label; falls back to `logoTitle`. */
  logoAriaLabel?: string;

  /** Controlled filter query (kept by the caller so it can also drive a
   * detail page). */
  filterQuery: string;
  setFilterQuery: (q: string) => void;
  filterInputRef?: RefObject<HTMLInputElement | null>;
  filterPlaceholder?: string;
  filterAriaLabel?: string;
  /** DOM id for the filter input. */
  filterId?: string;
  /** Tooltip on the filter label (e.g. a keyboard-shortcut hint). */
  filterTitle?: string;

  /** Right-side slot, e.g. `<Legendum/>`. Omit (self-hosted) to render
   * nothing on the right — the wrapper is skipped entirely. */
  right?: ReactNode;

  /** App-specific install/help dialog. The logo button opens it; the
   * supplied fn receives a `close` callback. Omit if the logo should not
   * open a dialog (see `onLogoClick`). */
  renderInstallDialog?: (close: () => void) => ReactNode;
  /** Overrides the default logo-click behavior (open the install dialog). */
  onLogoClick?: () => void;
};

export function TopBar({
  logoSrc,
  logo,
  logoTitle,
  logoAriaLabel,
  filterQuery,
  setFilterQuery,
  filterInputRef,
  filterPlaceholder,
  filterAriaLabel,
  filterId,
  filterTitle,
  right,
  renderInstallDialog,
  onLogoClick,
}: TopBarProps) {
  const headerRef = useRef<HTMLElement | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  // Keep the fixed top bar pinned to the top of the VISUAL viewport on iOS
  // so opening the mobile keyboard (and any resulting page scroll) can't
  // hide the header/filter row.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const el = headerRef.current;
      if (el) el.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  const handleLogoClick = () => {
    if (onLogoClick) onLogoClick();
    else if (renderInstallDialog) setShowInstall(true);
  };

  return (
    <header className="pues-topbar" ref={headerRef}>
      <div className="pues-topbar-left">
        <LogoButton
          logoSrc={logoSrc}
          title={logoTitle}
          ariaLabel={logoAriaLabel}
          onClick={handleLogoClick}
        >
          {logo}
        </LogoButton>
        <FilterBar
          query={filterQuery}
          setQuery={setFilterQuery}
          inputRef={filterInputRef}
          placeholder={filterPlaceholder}
          ariaLabel={filterAriaLabel}
          id={filterId}
          title={filterTitle}
          className="pues-topbar-search-filter"
        />
      </div>
      {right != null ? <div className="pues-topbar-right">{right}</div> : null}
      {showInstall && renderInstallDialog
        ? renderInstallDialog(() => setShowInstall(false))
        : null}
    </header>
  );
}
