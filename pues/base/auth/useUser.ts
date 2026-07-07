/**
 * `useUser()` — client-side data fetcher for `/pues/me`. The consumer
 * calls this once at the React root, then passes the result into
 * `<Pues user={user}>` so widgets like `<Legendum>` can read it via
 * `usePuesUser()`.
 *
 * Returns `{ user, loading, setUser, refetch }`:
 *   - `user`     — `null` while loading OR if anonymous; a `PuesUser`
 *                  if authenticated. The consumer gates UI on this.
 *   - `loading`  — `true` until the first fetch completes. The
 *                  consumer gates a loading screen on this so the
 *                  initial null doesn't flash as "anonymous".
 *   - `setUser`  — exposed so the consumer can wire their authedFetch
 *                  401-handler to flip back to anonymous on session
 *                  expiry: `setUnauthorizedHandler(() => setUser(null))`.
 *   - `refetch`  — re-runs the GET; does NOT flip `loading` back to
 *                  true. Use after explicit login completion or to
 *                  pick up a server-side meta change in another tab.
 *
 * Hits `/pues/me` (hardcoded per the pues namespace convention; no
 * `endpoint` prop). Uses `usePuesFetch(opts?.fetch)` so a consumer-
 * supplied `authedFetch` wrapper (passed via `<Pues fetch={...}>`)
 * automatically applies.
 *
 * Also calls `reconcileTheme(user.meta?.theme)` internally — the
 * server-persisted theme arrives with the user and pues owns the
 * theme part, so the consumer doesn't need to call reconcileTheme.
 */

import { useCallback, useEffect, useState } from "react";
import { type PuesUser, usePuesFetch } from "../core/Pues";
import { onPuesUnauthorized } from "../core/unauthorizedHandler";
import { reconcileTheme } from "../theme/state";

export type UseUserResult = {
  user: PuesUser | null;
  loading: boolean;
  setUser: (user: PuesUser | null) => void;
  refetch: () => Promise<void>;
};

export function useUser(opts?: { fetch?: typeof fetch }): UseUserResult {
  const [user, setUser] = useState<PuesUser | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchImpl = usePuesFetch(opts?.fetch);

  const refetch = useCallback(async () => {
    try {
      const res = await fetchImpl("/pues/me", { credentials: "include" });
      if (!res.ok) {
        setUser(null);
        return;
      }
      const data = (await res.json()) as PuesUser;
      reconcileTheme(data.meta?.theme);
      setUser(data);
    } catch {
      setUser(null);
    }
  }, [fetchImpl]);

  useEffect(() => {
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  // Auto-subscribe to 401 events from puesAuthedFetch — when the
  // server starts rejecting authenticated requests mid-session, flip
  // the user back to anonymous so the consumer renders the login UI.
  // No-op if the consumer is not using puesAuthedFetch.
  useEffect(() => onPuesUnauthorized(() => setUser(null)), []);

  return { user, loading, setUser, refetch };
}
