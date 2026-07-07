/**
 * `<LoginScreen>` — shared "logged-out" UI for Legendum-hosted apps.
 *
 * Renders the app's logo, name, tagline, and a `<Legendum>` login CTA.
 * Consumers tend to ship near-identical "logged-out" blocks; this
 * component folds them so the visual stays consistent and a future
 * redesign happens in one place.
 *
 * Defaults from `pues.yaml`:
 *  - `appName` falls back to title-cased `puesAppMeta.name` (e.g.
 *    `"my-app"` → `"My App"`).
 *  - `logoSrc` falls back to `/${puesAppMeta.name}.png` — the
 *    canonical "main favicon" per the three-image convention (main +
 *    192 + 512). Consumers wanting a separate splash image can still
 *    pass `logoSrc` explicitly.
 *
 * `tagline` has no good default and stays required.
 *
 * For self-hosted-only error screens or other bespoke logged-out
 * states, render your own markup — this component is intentionally
 * narrow: app brand + Legendum login.
 */

import type { ReactNode } from "react";
import { puesAppMeta } from "../core/puesAppMeta.generated";
import { Legendum } from "./Legendum";

export type LoginScreenProps = {
  /** Tagline paragraph. String or richer markup; rendered inside a `<p>`. */
  tagline: ReactNode;
  /** App name — rendered in the `<h1>` and used as the logo's `alt`.
   *  Defaults to title-cased `puesAppMeta.name`. */
  appName?: string;
  /** Logo image src. Defaults to `/${puesAppMeta.name}.png`. */
  logoSrc?: string;
  /** Outer wrapper class. Defaults to `"pues-login-screen"`. */
  className?: string;
  /** Logo `<img>` class. Defaults to `"pues-login-logo"`. */
  logoClassName?: string;
  /** Class passed through to `<Legendum>`. Defaults to `"pues-login-btn"`. */
  legendumClassName?: string;
  /** Forwarded to `<Legendum>` — after login, return to this same-origin path
   *  instead of `/` (e.g. a deep link that bounced through login). */
  returnTo?: string;
  /** Forwarded to `<Legendum>` — return to the current location after login.
   *  The ergonomic default for "send me back where I was". */
  returnToCurrent?: boolean;
};

/** Title-case a slug: `"my-app"` → `"My App"`, `"hello_world"` → `"Hello World"`. */
function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function LoginScreen({
  tagline,
  appName,
  logoSrc,
  className = "pues-login-screen",
  logoClassName = "pues-login-logo",
  legendumClassName = "pues-login-btn",
  returnTo,
  returnToCurrent,
}: LoginScreenProps) {
  const resolvedName = appName ?? titleCaseSlug(puesAppMeta.name);
  const resolvedLogo = logoSrc ?? `/${puesAppMeta.name}.png`;
  return (
    <div className={className}>
      <img src={resolvedLogo} alt={resolvedName} className={logoClassName} />
      <h1>{resolvedName}</h1>
      <p>{tagline}</p>
      <Legendum
        className={legendumClassName}
        returnTo={returnTo}
        returnToCurrent={returnToCurrent}
      />
    </div>
  );
}
