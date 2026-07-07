/**
 * `<Legendum>` — the single widget that covers every Legendum auth state.
 *
 *   user === undefined  → render nothing (loading)
 *   user === null       → "Login with Legendum" anchor → /pues/auth/login
 *   user && !user.hosted → render nothing (self-hosted: no Legendum UI)
 *   user && hosted, status "unlinked"   → "Link Legendum" button → startLink
 *   user && hosted, status "linking"    → disabled "Linking…" button
 *   user && hosted, status "error"      → "Retry" button (if `errorLabel` set)
 *                                          else null
 *   user && hosted, status "linked"     → balance anchor → account URL
 *
 * Reads tri-state user via `usePuesUser()`; the consumer must wrap the
 * app in `<Pues user={...}>` for this widget to function.
 *
 * Styling defaults to the pues `.pues-legendum-*` classes (shipped in
 * base/style/defaults.css), so the widget is fully styled with no
 * consumer CSS or className props; pass any `className*` slot to
 * override, or re-declare the classes in a later stylesheet. The URL
 * surface (`/pues/auth/login`, `/pues/legendum/*`, `/pues/auth/logout`)
 * is hardcoded per the pues namespace convention.
 *
 * The `linkController` is owned internally — consumers do not manage
 * it. After a successful link, the user's `legendum_linked` in the
 * `<Pues user>` context stays stale until the next `useUser` refetch
 * or page reload; the widget itself reflects the linked state
 * immediately via its own SDK subscription.
 *
 * Optional behaviors (opt-in via props) cover the bespoke patterns
 * a consumer might want for an inline TopBar widget:
 *   - `pollIntervalMs`: periodic status refresh while mounted.
 *   - `refreshOnEvent`: window event name; calls checkStatus on dispatch.
 *   - `autoLogoutOnUnlink`: POSTs /pues/auth/logout + reloads on
 *     linked → unlinked transition.
 *   - `lowCreditsThreshold` + `classNameLowCredits`: visual hint when
 *     the linked-state balance falls below a threshold.
 *   - `iconSlot`: render a brand glyph before the label / balance text.
 */

import { type ReactNode, useEffect, useRef, useState } from "react";
import { usePuesUser } from "../core/Pues";

// Bun's bundler resolves bare `require()` statically when targeting
// browsers. `createRequire(import.meta.url)` would also work server-side
// but it depends on `node:module` which is absent in browser bundles —
// at runtime the bundled call throws `createRequire is not a function`.
// `<Legendum>` is browser-only, so we use the bare-require pattern.
const legendumSdk =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../vendor/legendum/legendum.js") as typeof import("../vendor/legendum/legendum")["default"];

type LinkControllerState = {
  status: "loading" | "unlinked" | "linking" | "linked" | "error";
  balance: number | null;
  error: string | null;
};

type LinkController = {
  getState(): LinkControllerState;
  checkStatus(): void;
  startLink(): void;
  startAuthAndLink(csrfState?: string | null): void;
  accountUrl: string;
  destroy(): void;
};

export type LegendumProps = {
  /** Class applied to the rendered element in every non-null branch. */
  className?: string;
  /** Additional class for the anonymous login CTA. */
  classNameAnon?: string;
  /** Additional class for any authenticated branch (unlinked, linking,
   * error, linked). Applied alongside the more specific
   * `classNameLinked` / `classNameUnlinked` when those match. */
  classNameAuthed?: string;
  /** Additional class for the linked-state anchor (status === "linked"). */
  classNameLinked?: string;
  /** Additional class for the unlinked / linking / error states
   * (the "needs to link" button family). */
  classNameUnlinked?: string;
  /** Additional class for the linked-state anchor when the balance
   * falls below `lowCreditsThreshold`. */
  classNameLowCredits?: string;
  /** Label for the anonymous login CTA (default "Login with Legendum"). */
  loginLabel?: string;
  /** Label for the "link Legendum" button shown to authed-but-not-linked users. */
  linkLabel?: string;
  /** Label for the disabled in-flight "Linking…" button. */
  linkingLabel?: string;
  /** Label for the error-state retry button. When omitted, the widget
   * renders null on error (consumer must surface failures another way). */
  errorLabel?: string;
  /** Format the balance (in cents) for display. Default returns the
   * `$X.XX · Buy more credits` shape. Override to swap currency,
   * units, or copy entirely (e.g. return "1234 Credits"). */
  formatBalance?: (cents: number) => string;
  /** Optional glyph rendered before the label / balance text. When
   * provided, the text is wrapped in a `<span>` so the icon and text
   * are styled as siblings. */
  iconSlot?: ReactNode;
  /** Poll `checkStatus` on this interval (milliseconds) while the
   * widget is mounted in an authed branch. Default 0 = no polling. */
  pollIntervalMs?: number;
  /** Window event name; dispatching it triggers `checkStatus`. Use to
   * refresh the balance right after a known credit-spending action
   * (e.g. dispatch after creating a list to see the new balance). */
  refreshOnEvent?: string;
  /** Apply `classNameLowCredits` when the linked balance is below
   * this many cents. Default 0 = never low. */
  lowCreditsThreshold?: number;
  /** When set, a linked → unlinked transition triggers a POST to
   * `/pues/auth/logout` followed by `window.location.reload()`. */
  autoLogoutOnUnlink?: boolean;
  /** After login, return to this same-origin path (e.g. `/login?req=…`) instead
   * of the default `/`. Carried to `/pues/auth/login` as `?next=` and honored by
   * the callback; the server re-validates it as same-origin. */
  returnTo?: string;
  /** Convenience for the common case: return to the current location after login.
   * Ignored when `returnTo` is set. */
  returnToCurrent?: boolean;
};

function defaultFormatBalance(cents: number): string {
  return `$${(cents / 100).toFixed(2)} · Buy more credits`;
}

function cn(...classes: (string | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Render the icon + text together. When no icon, returns the text
 *  directly (preserves the prior `<a>{text}</a>` DOM shape). */
function withIcon(icon: ReactNode, label: ReactNode): ReactNode {
  if (!icon) return label;
  return (
    <>
      {icon}
      <span>{label}</span>
    </>
  );
}

/** Default brand glyph (Ⱡ, U+2C60), styled by `.pues-legendum-icon`.
 *  Pass `iconSlot={null}` to suppress it. */
const DEFAULT_LEGENDUM_ICON = <span className="pues-legendum-icon">{"Ⱡ"}</span>;

/** Resolve the post-login return path from props — explicit `returnTo`, else the
 *  current location when `returnToCurrent`. Only same-origin paths (a single
 *  leading "/", not "//"); the server re-validates. Null ⇒ default to `/`. */
function loginNext(
  returnTo?: string,
  returnToCurrent?: boolean,
): string | null {
  const raw =
    returnTo ??
    (returnToCurrent && typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : undefined);
  if (!raw?.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export function Legendum(rawProps: LegendumProps = {}) {
  const user = usePuesUser();

  // Default the styling slots to the pues classes + brand icon (styled
  // by base/style/defaults.css) so a consumer needs no className props
  // or CSS. Pass any slot to override; `iconSlot={null}` hides the icon.
  const props: LegendumProps = {
    ...rawProps,
    className: rawProps.className ?? "pues-legendum-btn",
    classNameLinked: rawProps.classNameLinked ?? "pues-legendum-linked",
    classNameUnlinked: rawProps.classNameUnlinked ?? "pues-legendum-link",
    classNameLowCredits:
      rawProps.classNameLowCredits ?? "pues-legendum-low-credits",
    iconSlot:
      rawProps.iconSlot === undefined
        ? DEFAULT_LEGENDUM_ICON
        : rawProps.iconSlot,
  };

  // Loading: render nothing so layout does not jump pre-fetch.
  if (user === undefined) return null;

  // Anonymous: login CTA. (In self-hosted there is always a local user
  // and this branch is unreachable; pues makes no assumption about it.)
  if (user === null) {
    const next = loginNext(props.returnTo, props.returnToCurrent);
    const loginHref = next
      ? `/pues/auth/login?next=${encodeURIComponent(next)}`
      : "/pues/auth/login";
    return (
      <a className={cn(props.className, props.classNameAnon)} href={loginHref}>
        {withIcon(null, props.loginLabel ?? "Login / Signup")}
      </a>
    );
  }

  // Authenticated, self-hosted: no Legendum widget surface.
  if (!user.hosted) return null;

  return <LegendumAuthed {...props} />;
}

function LegendumAuthed(props: LegendumProps) {
  const [state, setState] = useState<LinkControllerState>({
    status: "loading",
    balance: null,
    error: null,
  });
  const controllerRef = useRef<LinkController | null>(null);
  const wasLinkedRef = useRef(false);

  // Build the controller + subscribe; also wire the optional polling
  // interval and refreshOnEvent listener inside the same effect so
  // they tear down with the controller.
  const { pollIntervalMs, refreshOnEvent } = props;
  useEffect(() => {
    const controller = legendumSdk.linkController({
      linkUrl: "/pues/legendum/link",
      confirmUrl: "/pues/legendum/confirm",
      statusUrl: "/pues/legendum/status",
      onChange: setState,
    }) as LinkController;
    controllerRef.current = controller;
    controller.checkStatus();

    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (pollIntervalMs && pollIntervalMs > 0) {
      intervalId = setInterval(() => controller.checkStatus(), pollIntervalMs);
    }

    let onRefresh: (() => void) | null = null;
    if (refreshOnEvent) {
      onRefresh = () => controller.checkStatus();
      window.addEventListener(refreshOnEvent, onRefresh);
    }

    return () => {
      if (intervalId !== null) clearInterval(intervalId);
      if (onRefresh && refreshOnEvent)
        window.removeEventListener(refreshOnEvent, onRefresh);
      controller.destroy();
      controllerRef.current = null;
    };
  }, [pollIntervalMs, refreshOnEvent]);

  // Auto-logout on linked → unlinked transition.
  const autoLogout = props.autoLogoutOnUnlink;
  useEffect(() => {
    if (!autoLogout) return;
    if (state.status === "linked") {
      wasLinkedRef.current = true;
      return;
    }
    if (wasLinkedRef.current && state.status === "unlinked") {
      fetch("/pues/auth/logout", {
        method: "POST",
        credentials: "include",
      }).finally(() => window.location.reload());
    }
  }, [autoLogout, state.status]);

  const formatBalance = props.formatBalance ?? defaultFormatBalance;
  const linkLabel = props.linkLabel ?? "Link Legendum";
  const linkingLabel = props.linkingLabel ?? "Linking…";
  const baseAuthed = cn(props.className, props.classNameAuthed);

  if (state.status === "loading") return null;

  if (state.status === "unlinked") {
    return (
      <button
        type="button"
        className={cn(baseAuthed, props.classNameUnlinked)}
        onClick={() => controllerRef.current?.startLink()}
      >
        {withIcon(props.iconSlot, linkLabel)}
      </button>
    );
  }

  if (state.status === "linking") {
    return (
      <button
        type="button"
        className={cn(baseAuthed, props.classNameUnlinked)}
        disabled
      >
        {withIcon(props.iconSlot, linkingLabel)}
      </button>
    );
  }

  if (state.status === "error") {
    if (!props.errorLabel) return null;
    return (
      <button
        type="button"
        className={cn(baseAuthed, props.classNameUnlinked)}
        onClick={() => controllerRef.current?.startLink()}
      >
        {withIcon(props.iconSlot, props.errorLabel)}
      </button>
    );
  }

  // status === "linked"
  const balance = state.balance ?? 0;
  const isLow =
    props.lowCreditsThreshold !== undefined &&
    props.lowCreditsThreshold > 0 &&
    balance < props.lowCreditsThreshold;
  const linkedClass = cn(
    baseAuthed,
    props.classNameLinked,
    isLow ? props.classNameLowCredits : null,
  );
  return (
    <a
      className={linkedClass}
      href={controllerRef.current?.accountUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {withIcon(props.iconSlot, formatBalance(balance))}
    </a>
  );
}
