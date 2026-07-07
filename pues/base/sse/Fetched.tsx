import type { ReactNode } from "react";
import type { FetchState } from "./useFetch";

export type FetchedProps<T> = {
  /** The async state, straight from `useFetch` (or anything `FetchState`-shaped).
   *  `Fetched` switches on its `kind`; `children` only runs once `ready`. */
  state: FetchState<T>;
  /** Noun for the default copy: `label="Issues"` renders "Loading Issues…" and
   *  "Couldn't load Issues: <message>". Omit for the bare "Loading…" / raw
   *  message. Ignored when `loading` / `error` are supplied. */
  label?: string;
  /** Override the loading view. Omit for the pues-styled default. */
  loading?: ReactNode;
  /** Override the error view; receives the `FetchState` message. Omit for the
   *  pues-styled default. */
  error?: (message: string) => ReactNode;
  /** Rendered with the **narrowed** `data` once `ready` — so call sites stop
   *  re-deriving `state.kind === "ready" ? state.data : fallback`. */
  children: (data: T) => ReactNode;
};

/** Render a `FetchState<T>`: a placeholder while `loading`, a message on
 *  `error`, and `children(data)` once `ready`. The companion to `useFetch` —
 *  the hook produces the state, this consumes it — so a panel/dialog/summary
 *  stops hand-rolling the three-way `kind` branch. Both fallbacks are
 *  overridable; the defaults are pues-styled (see `.pues-fetch-*`) and read the
 *  `label` for their copy. */
export function Fetched<T>({
  state,
  label,
  loading,
  error,
  children,
}: FetchedProps<T>) {
  if (state.kind === "loading") {
    return <>{loading ?? <FetchFallback kind="loading" label={label} />}</>;
  }
  if (state.kind === "error") {
    return (
      <>
        {error ? (
          error(state.message)
        ) : (
          <FetchFallback kind="error" label={label} message={state.message} />
        )}
      </>
    );
  }
  return <>{children(state.data)}</>;
}

/** The built-in loading/error placeholder. Copy follows the universal
 *  "Loading <label>…" / "Couldn't load <label>: <message>" template when a
 *  `label` is given, else a bare fallback. Markup is intentionally tiny so a
 *  consumer can re-skin it entirely via the `loading` / `error` props. */
function FetchFallback({
  kind,
  label,
  message,
}: {
  kind: "loading" | "error";
  label?: string;
  message?: string;
}) {
  const text =
    kind === "loading"
      ? label
        ? `Loading ${label}…`
        : "Loading…"
      : label
        ? `Couldn't load ${label}: ${message}`
        : (message ?? "Something went wrong.");
  return <p className={`pues-fetch-state pues-fetch-state--${kind}`}>{text}</p>;
}
