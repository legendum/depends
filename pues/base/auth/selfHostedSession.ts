/**
 * `ensureSelfHostedSession(req)` / `withSelfHostedSession(req, res)` —
 * the self-hosted-mode bootstrap pattern lifted out of consumer
 * server.ts files.
 *
 * In hosted mode, OAuth flows through `/pues/auth/*` and the session
 * cookie is minted by `mountAuthRoutes`. In self-hosted mode there is
 * no OAuth: a single well-known local user owns everything, and pues
 * routes (`/pues/me`, `mountResource`, …) still require a session
 * cookie to identify them. These helpers mint that cookie on first
 * page navigation so the SPA shell lands authenticated.
 *
 * Two layers:
 *
 *   ensureSelfHostedSession(req) -> Promise<string | null>
 *       Low-level. Returns the Set-Cookie header value if a cookie
 *       should be minted (self-hosted mode + no cookie already
 *       present), or null otherwise (hosted mode, or cookie already
 *       in the request).
 *
 *   withSelfHostedSession(req, response) -> Promise<Response>
 *       High-level. Wraps a Response and adds the Set-Cookie header
 *       if needed. The intended call site is the SPA shell route:
 *
 *           return withSelfHostedSession(req,
 *               new Response(html, { headers: {...} }));
 *
 * Both are cheap no-ops when the cookie is already present (a regex
 * test on the Cookie header), so they are safe to call on every page
 * navigation.
 */

import { isSelfHosted } from "../core/mode";
import { COOKIE_NAME, setAuthCookieHeader } from "./cookie";
import { ensureLocalUser } from "./ensureLocalUser";

export async function ensureSelfHostedSession(
  req: Request,
): Promise<string | null> {
  if (!isSelfHosted()) return null;
  const cookie = req.headers.get("Cookie") ?? "";
  if (new RegExp(`(?:^|; )${COOKIE_NAME}=`).test(cookie)) return null;
  const userId = await ensureLocalUser();
  return setAuthCookieHeader(userId);
}

export async function withSelfHostedSession(
  req: Request,
  response: Response,
): Promise<Response> {
  const setCookie = await ensureSelfHostedSession(req);
  if (!setCookie) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", setCookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
