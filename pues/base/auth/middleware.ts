/**
 * Request → user-id resolution. Cookie HMAC first, then optionally
 * Bearer `account_token` (the opaque string returned by
 * `POST /pues/legendum/link-key`, stored in `users.legendum_token`).
 *
 * Per-request DB existence checks are deliberately omitted (the HMAC
 * is trusted). If a user is deleted, their cookie still verifies but
 * downstream queries (`SELECT … WHERE owner = ?`) return empty rows
 * and PATCH/DELETE 404s — safe by construction.
 */

import { getUserIdFromRequest } from "./cookie";
import { getUserStorage } from "./storage";

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Cookie-only auth. Use when bearer tokens are not accepted on this
 * surface (e.g. browser-only routes). */
export function getAuthUserId(req: Request): number | null {
  return getUserIdFromRequest(req);
}

/**
 * Cookie auth, falling back to Bearer `account_token` if no cookie.
 * Use on API routes that accept both browser sessions and
 * server-to-server / agent calls.
 *
 * Legendum account keys (`lak_…`) are NOT accepted here — clients call
 * `POST /pues/legendum/link-key` with `Authorization: Bearer <lak_…>`
 * to exchange a `lak_` for an `account_token`, then use that token on
 * subsequent requests.
 */
export async function getAuthUserIdWithBearer(
  req: Request,
): Promise<number | null> {
  const cookieId = getAuthUserId(req);
  if (cookieId) return cookieId;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const bearer = authHeader.slice(7).trim();
  if (!bearer) return null;

  const user = await getUserStorage().findUserByLegendumToken(bearer);
  return user?.id ?? null;
}

/** Cookie-only requireAuth — returns `{ userId }` or a 401 `Response`. */
export function requireAuth(req: Request): { userId: number } | Response {
  const userId = getAuthUserId(req);
  if (!userId) return jsonError(401, "unauthorized", "Not authenticated");
  return { userId };
}

/** Cookie-or-Bearer requireAuth — returns `{ userId }` or a 401 `Response`. */
export async function requireAuthAsync(
  req: Request,
): Promise<{ userId: number } | Response> {
  const userId = await getAuthUserIdWithBearer(req);
  if (!userId) return jsonError(401, "unauthorized", "Not authenticated");
  return { userId };
}
