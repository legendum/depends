import { usePuesFetch } from "../core/Pues";

export type LogoutProps = {
  /** Logout endpoint. Defaults to `/pues/auth/logout` (the route mounted
   * by `mountAuthRoutes`). Override for a consumer on a different path. */
  endpoint?: string;
  /** Override the `fetch` implementation. Falls back to the value from
   * `<Pues fetch={...}>`, then the global `fetch`. */
  fetch?: typeof fetch;
  /** `"fixed"` (default): the fixed bottom-left screen dock. `"inline"`:
   * in-flow, for embedding — e.g. `<SettingsDialog>`'s bottom-left, where the
   * fixed dock would otherwise pin to the viewport, not the dialog. */
  variant?: "fixed" | "inline";
};

/**
 * "Logout" link. POSTs to the auth logout route and reloads.
 *
 * `"fixed"` (default) is the bottom-left dock — pairs with the bottom-centre
 * <ThemeChooser> and bottom-right <AddButton>, all reading `--pues-fab-offset`.
 * `"inline"` drops the fixed positioning so it can sit inside a dialog (its
 * default home is `<SettingsDialog>`'s footer). Muted text, danger-red on hover.
 */
export function Logout({
  endpoint = "/pues/auth/logout",
  fetch: fetchOverride,
  variant = "fixed",
}: LogoutProps = {}) {
  const fetchImpl = usePuesFetch(fetchOverride);

  function logout() {
    fetchImpl(endpoint, {
      method: "POST",
      credentials: "include",
    }).finally(() => window.location.reload());
  }

  const className =
    variant === "inline"
      ? "pues-logout pues-logout--inline"
      : "pues-logout pues-shadow";

  return (
    <button type="button" className={className} onClick={logout}>
      Logout
    </button>
  );
}
