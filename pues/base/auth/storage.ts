/**
 * `UserStorage` — the pluggable data layer that pues' auth needs to do
 * its job. Each consumer owns its `users` table schema; pues talks to
 * that schema only through this interface.
 *
 * Pure CRUD — no business logic, no lifecycle hooks, no derived state.
 * Lifecycle hooks (e.g. `onNewUser`) live on `AuthConfig`; derived state
 * (e.g. `legendum_linked = !!legendum_token`) is computed at the call
 * site, not in storage.
 *
 * Functions are typed as `Awaitable<T>` so sync (bun:sqlite) and async
 * (postgres, libsql, …) storage layers both fit. Pues always `await`s
 * the result internally.
 */

export type Awaitable<T> = T | Promise<T>;

/**
 * The minimum shape pues expects when looking up a user. Consumers may
 * return a wider object (e.g. with `created_at`, `last_login_at`); pues
 * ignores the extras.
 */
export type UserRow = {
  id: number;
  email: string;
  legendum_token: string | null;
};

export type UserStorage = {
  /** Stable identity lookup by email. Used during OAuth callback +
   * link-key flows to find-or-create. */
  findUserByEmail(email: string): Awaitable<UserRow | null>;

  /** Bearer-token authentication: given an `account_token`
   * (stored in `users.legendum_token`), return the owning user. */
  findUserByLegendumToken(token: string): Awaitable<UserRow | null>;

  /** Token lookup used by the legendum SDK middleware's `getToken`
   * adapter — given a userId, return their current legendum token (or
   * null if unlinked). */
  getLegendumToken(userId: number): Awaitable<string | null>;

  /** Insert a new user. The OAuth/link-key flows pass `legendumToken`;
   * the self-hosted bootstrap omits it. Pues calls `onNewUser` (if
   * configured) after this returns. */
  createUser(input: {
    email: string;
    legendumToken?: string | null;
  }): Awaitable<UserRow>;

  /** Update or clear the user's legendum token. Used by the SDK
   * middleware's `setToken` / `clearToken` adapters, and by the OAuth
   * callback when re-linking. */
  updateLegendumToken(userId: number, token: string | null): Awaitable<void>;

  /** Read the user's `meta` JSON. Returns `{}` if the row's meta is
   * null/empty/unparseable. Pues' `mountUserSettings` GET reads this. */
  getMeta(userId: number): Awaitable<Record<string, unknown>>;

  /** Write the merged `meta` JSON for the user. Pues' `mountUserSettings`
   * PATCH calls this after merging the incoming patch with the existing
   * meta and validating any pues-owned keys (e.g. `theme`). */
  updateMeta(userId: number, meta: Record<string, unknown>): Awaitable<void>;
};

let _impl: UserStorage | null = null;

/**
 * Register the consumer's `UserStorage` implementation. Call this once
 * at boot, before any pues route is mounted that touches users (auth
 * routes, `mountResource` with `resolveUser`, etc.).
 */
export function setUserStorage(impl: UserStorage): void {
  _impl = impl;
}

/**
 * Resolve the registered `UserStorage`. Throws if `setUserStorage`
 * has not been called — pues can do nothing useful without it. The
 * throw fires at first use, not at module load, so test setup can
 * register a stub between the import and the first call.
 */
export function getUserStorage(): UserStorage {
  if (!_impl) {
    throw new Error(
      "pues/base/auth: setUserStorage() was not called. Register a UserStorage implementation at boot before any auth routes or pues resources are mounted.",
    );
  }
  return _impl;
}
