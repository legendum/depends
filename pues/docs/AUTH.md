# Auth — `pues/base/auth`

Authentication for pues/Legendum services: session cookies, request→user
resolution, the login/settings UI, and the OAuth / bearer link-key / self-hosted
flows. Cookie names and `/pues/*` route prefixes are hardcoded in the `pues`
namespace by convention — not configurable.

## Provides
**Client** (`pues/base/auth`):
- `useUser` (`UseUserResult`) — own the current-user tri-state (feeds `<Pues user>`)

**Server** (`pues/base/auth/server`):
- `configureAuth(AuthConfig)` — the single wiring entry (see Config)
- route mounts: `mountAuthRoutes`, `mountLegendum`, `mountUserSettings`
- request→user: `getAuthUserId`, `getAuthUserIdWithBearer`, `requireAuth`,
  `requireAuthAsync`, `resolveUser`
- cookies: `createSessionCookie`, `verifySessionCookie`, `getUserIdFromRequest`,
  `setAuthCookieHeader`, `clearAuthCookieHeader`, `COOKIE_NAME`,
  `OAUTH_STATE_COOKIE_NAME`
- self-hosted: `ensureLocalUser`, `ensureSelfHostedSession`, `withSelfHostedSession`
- storage: `puesUserStorage` (+ `UserStorage`, `UserRow`, `Awaitable` types)
- env helpers: `getCookieSecret`, `getDomain`

## Components
Client (`pues/base/auth`) — the auth UI (each with its prop types):
- `LoginScreen` — the combined login / signup entry (defaults from `puesAppMeta`)
- `Logout` — sign-out control
- `Settings` / `SettingsDialog` — user settings, inline / modal
- `Legendum` — the account / credits widget (renders per auth state)

## Config
`configureAuth({ … })` at boot — pass **exactly one** of:
- `getDb` — build the default `puesUserStorage(getDb)` against the canonical
  `users` table (below), or
- `storage` — a custom `UserStorage` adapter (7 CRUD fns; use this for a renamed
  table/columns or a non-SQLite store).

**Canonical `users` table** — you create it (a `CREATE TABLE IF NOT EXISTS` in
your `config/schema.sql`; see [DB.md](DB.md)); `getDb`-mode auth expects exactly:

```sql
id             INTEGER PRIMARY KEY
email          TEXT NOT NULL UNIQUE
legendum_token TEXT
meta           TEXT               -- JSON object (user settings, e.g. theme)
```
Extra columns are fine (pues ignores them). Rename any of these and you must
supply your own `storage` instead.

Plus optional `onNewUser(userId)` — fires once when any flow creates a user (seed
defaults here).

Per-deployment values are read from env (the `pues` namespace), not passed in:
- `PUES_COOKIE_SECRET` — session-cookie HMAC. Required in hosted mode (throws if
  missing or the dev placeholder); dev fallback self-hosted.
- `PUES_DOMAIN` — public origin. Required hosted; falls back to
  `http://localhost:$PORT` self-hosted.
- `PUES_LINK_KEY_MAX_AGE_SECONDS` — reuse window for the stored `legendum_token`
  before re-linking (default 14 days; `0` = always re-link).

`configureAuth` validates these in hosted mode at startup — fails loudly before
the first request.

## Routes / mounts / interfaces
Each mount returns a route-map object to spread into your `routes:` block:
- `mountAuthRoutes()` — `/pues/auth/*` (login, OAuth callback, logout)
- `mountLegendum()` — `/pues/legendum/*`, incl. `POST /pues/legendum/link-key`
  (a pues policy layer over the SDK: TTL token reuse + single-flight)
- `mountUserSettings()` — user-settings routes

## Consume it
```ts
// server
import { configureAuth, mountAuthRoutes, mountLegendum, requireAuth }
  from "pues/base/auth/server";
configureAuth({ getDb, onNewUser: seedDefaultsForNewUser });
const routes = { ...mountAuthRoutes(), ...mountLegendum() };

// client
import { LoginScreen, useUser } from "pues/base/auth";
```

## Notes
Hosted vs self-hosted mode branches on `isByLegendum()` (`core`): hosted demands a
real secret/domain; self-hosted bootstraps a local user + dev session so the SPA
lands authenticated. Auto-pulls `vendor` (the Legendum SDK). Full design:
`docs/pues/SPEC.md` §3.
