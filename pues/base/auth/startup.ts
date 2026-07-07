/**
 * `configureAuth(config)` — register the `UserStorage` adapter, auth
 * lifecycle hooks, and validate the pues namespace env vars
 * (`PUES_COOKIE_SECRET`, `PUES_DOMAIN`).
 *
 * Storage is wired in one of two ways:
 *
 *   configureAuth({ getDb, … })             // default: puesUserStorage(getDb)
 *   configureAuth({ storage: myAdapter, … }) // custom override
 *
 * Exactly one of `getDb` / `storage` must be supplied; throws otherwise.
 * Pass `storage` when your `users` schema is non-canonical; otherwise
 * pass `getDb` and let pues build the default `puesUserStorage` for you.
 *
 * Cookie names, OAuth state cookie name, and route prefixes are all
 * hardcoded in the `pues` namespace and not configurable — that is the
 * point of the convention.
 *
 * Per-deployment values that MUST differ between services are read
 * directly from env vars by pues, so the consumer does not pass them in:
 *
 *   - `PUES_COOKIE_SECRET` — HMAC secret for session cookies. Required
 *     in hosted mode (throws if missing OR equals the dev placeholder).
 *     Self-hosted falls back to a known dev secret.
 *   - `PUES_DOMAIN` — public origin (e.g. `https://example.com`). Required
 *     in hosted mode. Self-hosted falls back to `http://localhost:$PORT`.
 *   - `PUES_LINK_KEY_MAX_AGE_SECONDS` — max age for reusing the stored
 *     `legendum_token` on `POST /pues/legendum/link-key` before re-linking.
 *     Optional; defaults to 14 days. Set `0` to force re-link on every call.
 *
 * `configureAuth` validates both in hosted mode at startup, so
 * misconfiguration fails loudly before the first request.
 */

import type { Database } from "bun:sqlite";
import { isByLegendum } from "../core/mode";
import { puesUserStorage } from "./puesUserStorage";
import { setUserStorage, type UserStorage } from "./storage";

export type AuthConfig = {
  /** Build the default `puesUserStorage(getDb)`. Required ONLY when
   * `storage` is omitted; ignored when `storage` is supplied. */
  getDb?: () => Database;
  /** Custom `UserStorage` adapter — overrides the default. Pass this
   * when your `users` schema diverges from the canonical shape. */
  storage?: UserStorage;
  /** Fires exactly once after a new user is created by any pues flow:
   * `/pues/auth/callback` (OAuth), `/pues/legendum/link-key` (bearer),
   * or `ensureLocalUser()` (self-hosted bootstrap). The userId is the
   * one just inserted. Typical use: seed default rows for the new user
   * (e.g. `seedDefaultListsForNewUser`). */
  onNewUser?: (userId: number) => void | Promise<void>;
};

let _config: { onNewUser?: AuthConfig["onNewUser"] } = {};

const DEV_COOKIE_SECRET = "dev-secret-change-in-production";
const DEFAULT_LINK_KEY_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

/**
 * Wire the `UserStorage` adapter + register auth lifecycle hooks +
 * fail-fast on misconfigured env vars in hosted mode. Call once at boot.
 */
export function configureAuth(config: AuthConfig): void {
  if (config.storage) {
    setUserStorage(config.storage);
  } else if (config.getDb) {
    setUserStorage(puesUserStorage(config.getDb));
  } else {
    throw new Error(
      "configureAuth: pass either `storage` (custom UserStorage) or `getDb` (to use the default puesUserStorage).",
    );
  }
  _config = { onNewUser: config.onNewUser };
  if (isByLegendum()) {
    getCookieSecret();
    getDomain();
    getLinkKeyMaxAgeSeconds();
  }
}

export function getAuthConfig(): { onNewUser?: AuthConfig["onNewUser"] } {
  return _config;
}

/**
 * HMAC secret for session cookies. Reads `process.env.PUES_COOKIE_SECRET`.
 * Throws in hosted mode if missing or equal to the dev placeholder.
 * Falls back to the dev placeholder in self-hosted mode.
 */
export function getCookieSecret(): string {
  const secret = process.env.PUES_COOKIE_SECRET;
  if (isByLegendum()) {
    if (!secret) {
      throw new Error(
        "PUES_COOKIE_SECRET must be set in hosted mode (LEGENDUM_API_KEY is set).",
      );
    }
    if (secret === DEV_COOKIE_SECRET) {
      throw new Error(
        "PUES_COOKIE_SECRET must not equal the dev placeholder in hosted mode.",
      );
    }
    return secret;
  }
  return secret || DEV_COOKIE_SECRET;
}

/**
 * Public origin URL. Reads `process.env.PUES_DOMAIN`. Throws in hosted
 * mode if missing. Falls back to `http://localhost:$PORT` in self-hosted.
 */
export function getDomain(): string {
  const domain = process.env.PUES_DOMAIN;
  if (domain) return domain;
  if (isByLegendum()) {
    throw new Error(
      "PUES_DOMAIN must be set in hosted mode (LEGENDUM_API_KEY is set).",
    );
  }
  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

/**
 * Max token age before `/pues/legendum/link-key` re-links with `linkKey()`.
 * Reads `process.env.PUES_LINK_KEY_MAX_AGE_SECONDS`.
 *
 * - default: 14 days
 * - `0`: always re-link (legacy behavior)
 * - must be an integer >= 0
 */
export function getLinkKeyMaxAgeSeconds(): number {
  const raw = process.env.PUES_LINK_KEY_MAX_AGE_SECONDS?.trim();
  if (!raw) return DEFAULT_LINK_KEY_MAX_AGE_SECONDS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("PUES_LINK_KEY_MAX_AGE_SECONDS must be an integer >= 0.");
  }
  return n;
}
