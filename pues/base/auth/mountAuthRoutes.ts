/**
 * `mountAuthRoutes()` — returns the three OAuth routes under
 * `/pues/auth/*`. Mounted only in hosted mode (returns `{}` when
 * `isByLegendum()` is false, so the consumer's `routes:` block keeps
 * the OAuth surface entirely absent in self-hosted deployments).
 *
 * The callback orchestrates the OAuth exchange:
 *   verify state cookie → SDK.exchangeCode → find-or-create user via
 *   UserStorage → fire `onNewUser` if created (else refresh
 *   legendum_token) → set session cookie → redirect to `/`.
 */

import { isByLegendum } from "../core/mode";
import {
  clearAuthCookieHeader,
  OAUTH_STATE_COOKIE_NAME,
  setAuthCookieHeader,
} from "./cookie";
import { getAuthConfig, getDomain } from "./startup";
import { getUserStorage } from "./storage";

// Bare `require()` rather than `createRequire(import.meta.url)`: Bun
// resolves both at runtime, but only bare require() survives browser
// bundling. The auth part is server-only, yet consumers re-export the
// whole barrel (`pues/base/auth`) into client code (`Legendum`,
// `useUser`), so the bundler pulls this module in too. See Legendum.tsx
// for the equivalent client-side note.
const legendumSdk =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../vendor/legendum/legendum.js") as typeof import("../vendor/legendum/legendum")["default"];

type LegendumExchange = {
  email: string;
  linked?: boolean;
  account_token?: string;
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Cookie that carries the post-login return path across the OAuth round-trip.
 *  Per-origin (not per-tab), so it survives the magic-link opening in a new tab. */
const LOGIN_NEXT_COOKIE_NAME = "pues_login_next";

/** A safe same-origin return path: a single leading "/" and no "//" or scheme —
 *  so it can't be turned into an open redirect to another host. Else null. */
function safeLocalPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

async function getLogin(req: Request): Promise<Response> {
  const domain = getDomain();
  const state = crypto.randomUUID();
  const redirectUri = `${domain}/pues/auth/callback`;

  const linkData = await legendumSdk.requestLink();
  const url = legendumSdk.authAndLinkUrl({
    redirectUri,
    state,
    linkCode: linkData.code,
  });

  const headers = new Headers({ Location: url, "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    `${OAUTH_STATE_COOKIE_NAME}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
  );
  // `?next=` — where to land after login, so a deep link that bounced through
  // login returns to itself. Validated as same-origin here AND in the callback.
  // Absent ⇒ the callback lands on `/`, unchanged.
  const next = safeLocalPath(new URL(req.url).searchParams.get("next"));
  if (next) {
    headers.append(
      "Set-Cookie",
      `${LOGIN_NEXT_COOKIE_NAME}=${encodeURIComponent(next)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
    );
  }
  return new Response(null, { status: 302, headers });
}

async function getCallback(req: Request): Promise<Response> {
  const domain = getDomain();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return json(
      { error: "invalid_request", message: "Missing code or state" },
      400,
    );
  }

  const cookieHeader = req.headers.get("Cookie") ?? "";
  const stateMatch = cookieHeader.match(
    new RegExp(`${OAUTH_STATE_COOKIE_NAME}=([^;]+)`),
  );
  const savedState = stateMatch?.[1];
  if (state !== savedState) {
    return json({ error: "invalid_state", message: "State mismatch" }, 400);
  }

  const redirectUri = `${domain}/pues/auth/callback`;

  let data: LegendumExchange;
  try {
    data = (await legendumSdk.exchangeCode(
      code,
      redirectUri,
    )) as LegendumExchange;
  } catch (err: unknown) {
    console.error("Legendum code exchange failed", err);
    return json({ error: "auth_failed", message: "Login failed" }, 400);
  }

  const { email } = data;
  if (!email) {
    return json(
      { error: "auth_failed", message: "Could not read email from Legendum" },
      400,
    );
  }

  const accountToken = data.account_token ?? null;
  const storage = getUserStorage();
  let user = await storage.findUserByEmail(email);

  if (!user) {
    user = await storage.createUser({ email, legendumToken: accountToken });
    const config = getAuthConfig();
    if (config.onNewUser) await config.onNewUser(user.id);
  } else if (accountToken && user.legendum_token !== accountToken) {
    await storage.updateLegendumToken(user.id, accountToken);
  }

  const sessionCookie = setAuthCookieHeader(user.id);
  const clearState = `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  // Land on the remembered `next` path if one survived the round-trip (re-validated
  // same-origin), else `/`. Clear the cookie either way.
  const nextMatch = cookieHeader.match(
    new RegExp(`${LOGIN_NEXT_COOKIE_NAME}=([^;]+)`),
  );
  const next = nextMatch
    ? safeLocalPath(decodeURIComponent(nextMatch[1]))
    : null;
  const clearNext = `${LOGIN_NEXT_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  return new Response(null, {
    status: 302,
    headers: [
      ["Location", `${domain}${next ?? "/"}`],
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", clearState],
      ["Set-Cookie", clearNext],
    ] as [string, string][],
  });
}

async function postLogout(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearAuthCookieHeader(),
    },
  });
}

export function mountAuthRoutes(): Record<
  string,
  Record<string, (req: Request) => Response | Promise<Response>>
> {
  if (!isByLegendum()) return {};
  return {
    "/pues/auth/login": { GET: getLogin },
    "/pues/auth/callback": { GET: getCallback },
    "/pues/auth/logout": { POST: postLogout },
  };
}
