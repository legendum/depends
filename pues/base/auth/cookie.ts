/**
 * Session cookie HMAC: signs `${userId}:${expires}` with the pues
 * cookie secret. Cookie name is hardcoded to `pues_session` (no
 * per-consumer override — see the pues namespace convention).
 *
 * Format: `{userId}:{expiresMs}:{hmacSha256Base64Url}`.
 */

import { createHmac } from "node:crypto";
import { getCookieSecret, getDomain } from "./startup";

/** Session cookie name. Hardcoded per the pues namespace convention. */
export const COOKIE_NAME = "pues_session";

/** OAuth state cookie name. Hardcoded per the pues namespace convention. */
export const OAUTH_STATE_COOKIE_NAME = "pues_oauth_state";

const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function createSessionCookie(userId: number): string {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${userId}:${expires}`;
  const sig = createHmac("sha256", getCookieSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}:${sig}`;
}

export function verifySessionCookie(cookie: string): number | null {
  const parts = cookie.split(":");
  if (parts.length !== 3) return null;
  const [userIdStr, expiresStr, sig] = parts;
  const payload = `${userIdStr}:${expiresStr}`;
  const expected = createHmac("sha256", getCookieSecret())
    .update(payload)
    .digest("base64url");
  if (sig !== expected) return null;
  const expires = Number.parseInt(expiresStr, 10);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;
  const userId = Number.parseInt(userIdStr, 10);
  if (!Number.isFinite(userId)) return null;
  return userId;
}

/** Extract the user id from a request's session cookie, or null. */
export function getUserIdFromRequest(req: Request): number | null {
  const cookieHeader = req.headers.get("Cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySessionCookie(decodeURIComponent(match[1]));
}

/** Build the `Set-Cookie` value to attach to a sign-in response. */
export function setAuthCookieHeader(userId: number): string {
  const value = encodeURIComponent(createSessionCookie(userId));
  const isSecure = getDomain().startsWith("https://");
  const secureFlag = isSecure ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secureFlag}`;
}

/** Build the `Set-Cookie` value to clear the session on logout. */
export function clearAuthCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
