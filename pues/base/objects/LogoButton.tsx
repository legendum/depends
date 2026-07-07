import type { CSSProperties, ReactNode } from "react";
import { useLogoButton } from "./useLogoButton";

export type LogoButtonProps = {
  /** Image source for the default `<img>` logo. Omit when supplying
   * `children` (a custom SVG/text logo). One of the two is required. */
  logoSrc?: string;
  /** Custom logo content. When set, replaces the default `<img>`; the
   * wiggle animation is applied to a wrapper carrying `logoClassName`. */
  children?: ReactNode;
  title?: string;
  ariaLabel?: string;
  logoAlt?: string;
  buttonClassName?: string;
  logoClassName?: string;
  /** Inline style for the `<button>`. Use for per-instance CSS-var
   * overrides like `--pues-logo-size` / `--pues-logo-radius`, which the
   * button (radius) and image (size + radius) read. */
  buttonStyle?: CSSProperties;
  /** Inline style for the logo element itself. */
  logoStyle?: CSSProperties;
  wiggleIntervalMs?: number;
  seenCookieName?: string;
  seenCookieDays?: number;
  /** Optional hook for consumers that open install/help dialogs. */
  onClick?: () => void;
};

/**
 * Top-left logo button with shared behavior:
 * - auto-wiggle every `wiggleIntervalMs` until first click
 * - set a persistent cookie on first click, disabling future auto-wiggle
 * - always wiggle on hover (even after seen)
 *
 * This component is the surface consumers should use; `useLogoButton`
 * is the same behavior as a hook for the rare case that needs bespoke
 * markup. The hook hands back a ref *callback* (`logoRef`), so neither
 * path couples a consumer to a particular React major.
 */
export function LogoButton({
  logoSrc,
  children,
  title,
  ariaLabel,
  logoAlt = "",
  buttonClassName,
  logoClassName,
  buttonStyle,
  logoStyle,
  wiggleIntervalMs,
  seenCookieName,
  seenCookieDays,
  onClick,
}: LogoButtonProps) {
  const resolvedAriaLabel = ariaLabel ?? title ?? "Logo";
  const buttonClasses = buttonClassName
    ? `pues-logo-button ${buttonClassName}`
    : "pues-logo-button";
  const logoClasses = logoClassName
    ? `pues-logo-image ${logoClassName}`
    : "pues-logo-image";
  const { logoRef, triggerWiggle, handleClick } = useLogoButton({
    wiggleIntervalMs,
    seenCookieName,
    seenCookieDays,
    onClick,
  });

  return (
    <button
      type="button"
      className={buttonClasses}
      title={title}
      aria-label={resolvedAriaLabel}
      style={buttonStyle}
      onClick={handleClick}
      onMouseEnter={triggerWiggle}
    >
      {children !== undefined ? (
        <span ref={logoRef} className={logoClasses} style={logoStyle}>
          {children}
        </span>
      ) : (
        <img
          ref={logoRef}
          src={logoSrc}
          alt={logoAlt}
          className={logoClasses}
          style={logoStyle}
        />
      )}
    </button>
  );
}
