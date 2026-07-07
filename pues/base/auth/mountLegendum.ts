/**
 * `mountLegendum()` — mounts the legendum SDK middleware under
 * `/pues/legendum/*` and subsumes the link-key cookie-mint side-effect
 * that consumers used to glue on themselves.
 *
 * Returns `{}` when `isByLegendum()` is false (self-hosted mode); the
 * SDK isn't configured and there's nothing to mount.
 *
 * SDK routes handled:
 *   - POST /link, /auth-link              (public, delegated to SDK middleware)
 *   - POST /link-key                      (public, pues-managed reuse/refresh policy)
 *   - POST /issue-key, /confirm          (authenticated, userId via cookie/bearer)
 *   - GET  /status                       (authenticated)
 *
 * The `/link-key` route additionally appends a `Set-Cookie` for the
 * resolved user, and reuses the stored `legendum_token` when fresh
 * enough (`PUES_LINK_KEY_MAX_AGE_SECONDS`), instead of always forcing a
 * fresh `linkKey()` exchange.
 *
 * Important boundary: this policy lives in pues route glue only.
 * Services that call `legendum.create().linkKey(...)` directly still get
 * vanilla SDK behavior with no TTL reuse/single-flight layer.
 *
 * Storage adapters compose directly from `UserStorage` (token/meta CRUD).
 */

import { isByLegendum } from "../core/mode";
import { setAuthCookieHeader } from "./cookie";
import { requireAuthAsync } from "./middleware";
import { getAuthConfig, getLinkKeyMaxAgeSeconds } from "./startup";
import { getUserStorage } from "./storage";

// Bare `require()` rather than `createRequire(import.meta.url)`: Bun
// resolves both at runtime, but only bare require() survives browser
// bundling. The auth barrel re-exports this server-only module into
// client code, so the bundler pulls it in too.
const legendumSdk =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../vendor/legendum/legendum.js") as typeof import("../vendor/legendum/legendum")["default"];

type RouteHandler = (req: Request) => Response | Promise<Response>;

const PREFIX = "/pues/legendum";
const TOKEN_REFRESHED_AT_META_KEY = "legendum_token_refreshed_at";
const refreshInFlightByEmail = new Map<string, Promise<LinkKeyResult>>();

type LinkKeyResult = {
  accountToken: string;
  email: string;
  userId: number;
};

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

type MiddlewareClient = Parameters<typeof legendumSdk.middleware>[0]["client"];
type AccountClient = ReturnType<typeof legendumSdk.account>;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorFromCaught(
  err: unknown,
  status: number,
  fallbackError: string,
): Response {
  const e = err as { message?: string; code?: string };
  return jsonResponse(
    {
      ok: false,
      message: e?.message || "Legendum error",
      error: e?.code || fallbackError,
    },
    status,
  );
}

function readRefreshedAtFromMeta(meta: Record<string, unknown>): number | null {
  const raw = meta[TOKEN_REFRESHED_AT_META_KEY];
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return null;
}

async function fetchEmailFromAccountKey(
  accountKey: string,
  accountClientFactory?: (accountKey: string) => AccountClient,
): Promise<string> {
  const accountClient = accountClientFactory
    ? accountClientFactory(accountKey)
    : legendumSdk.account(accountKey);
  const whoami = await accountClient.whoami();
  const email = String((whoami as { email?: unknown })?.email ?? "").trim();
  if (!email) {
    throw Object.assign(new Error("link-key identity missing email"), {
      code: "link_failed",
    });
  }
  return email;
}

async function linkOrReuseTokenForEmail(args: {
  accountKey: string;
  email: string;
  maxAgeSeconds: number;
  client?: MiddlewareClient;
}): Promise<LinkKeyResult> {
  const nowUnixSeconds = Math.floor(Date.now() / 1000);
  const storage = getUserStorage();
  let user = await storage.findUserByEmail(args.email);
  if (user?.legendum_token) {
    const meta = await storage.getMeta(user.id);
    const refreshedAtUnixSeconds = readRefreshedAtFromMeta(meta);
    const tokenAgeSeconds =
      refreshedAtUnixSeconds == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, nowUnixSeconds - refreshedAtUnixSeconds);
    if (args.maxAgeSeconds > 0 && tokenAgeSeconds < args.maxAgeSeconds) {
      return {
        accountToken: user.legendum_token,
        email: args.email,
        userId: user.id,
      };
    }
  }

  const serviceClient = args.client ?? legendumSdk.create();
  const linked = await serviceClient.linkKey(args.accountKey);
  const accountToken = String(
    (linked as { account_token?: unknown })?.account_token ?? "",
  ).trim();
  if (!accountToken) {
    throw Object.assign(new Error("link-key response missing account_token"), {
      code: "link_failed",
    });
  }

  if (!user) {
    user = await storage.createUser({
      email: args.email,
      legendumToken: accountToken,
    });
    const config = getAuthConfig();
    if (config.onNewUser) await config.onNewUser(user.id);
  } else if (user.legendum_token !== accountToken) {
    await storage.updateLegendumToken(user.id, accountToken);
  }

  const existingMeta = await storage.getMeta(user.id);
  await storage.updateMeta(user.id, {
    ...existingMeta,
    [TOKEN_REFRESHED_AT_META_KEY]: nowUnixSeconds,
  });
  return { accountToken, email: args.email, userId: user.id };
}

async function singleFlightResolveLinkKeyByEmail(args: {
  accountKey: string;
  email: string;
  client?: MiddlewareClient;
  maxAgeSeconds: number;
}): Promise<LinkKeyResult> {
  const key = args.email.toLowerCase().trim();
  const existing = refreshInFlightByEmail.get(key);
  if (existing) return existing;
  const inFlight = linkOrReuseTokenForEmail(args);
  refreshInFlightByEmail.set(key, inFlight);
  try {
    return await inFlight;
  } finally {
    if (refreshInFlightByEmail.get(key) === inFlight) {
      refreshInFlightByEmail.delete(key);
    }
  }
}

function buildMiddleware(
  client?: MiddlewareClient,
): (req: Request, ...extra: unknown[]) => Promise<Response | null | undefined> {
  return legendumSdk.middleware({
    prefix: PREFIX,
    client,
    getToken: async (_req: Request, ...extra: unknown[]) => {
      const userId = extra[0] as number;
      return await getUserStorage().getLegendumToken(userId);
    },
    setToken: async (
      _req: Request,
      accountToken: string,
      ...extra: unknown[]
    ) => {
      const userId = extra[0] as number;
      await getUserStorage().updateLegendumToken(userId, accountToken);
    },
    clearToken: async (_req: Request, ...extra: unknown[]) => {
      const userId = extra[0] as number;
      await getUserStorage().updateLegendumToken(userId, null);
    },
  });
}

/**
 * Mount the legendum SDK routes. `opts.client` is an escape hatch
 * mainly for tests — pass a mock SDK client to bypass real network /
 * API-key resolution. Production callers omit it and the SDK uses
 * `create()` to build a client from env.
 */
export function mountLegendum(opts?: {
  client?: MiddlewareClient;
  accountClientFactory?: (accountKey: string) => AccountClient;
}): Record<string, Record<string, RouteHandler>> {
  if (!isByLegendum()) return {};

  const middleware = buildMiddleware(opts?.client);

  // Pues "bells and whistles" link-key path:
  // - identify the user via account().whoami()
  // - reuse recent stored token (TTL from startup.ts)
  // - otherwise call SDK linkKey() and persist token + refreshed_at meta
  //
  // The SDK contract itself is unchanged; this behavior applies only when a
  // service mounts /pues/legendum/link-key via mountLegendum().
  const linkKey: RouteHandler = async (req) => {
    try {
      const authHeader = req.headers.get("Authorization") || "";
      const bearer = /^Bearer\s+(\S+)/i.exec(authHeader);
      if (!bearer?.[1]) {
        return jsonResponse(
          {
            ok: false,
            message: "Authorization: Bearer <account_key> required",
            error: "unauthorized",
          },
          401,
        );
      }
      const accountKey = bearer[1];
      const maxAgeSeconds = getLinkKeyMaxAgeSeconds();
      const email = await fetchEmailFromAccountKey(
        accountKey,
        opts?.accountClientFactory,
      );
      const linked = await singleFlightResolveLinkKeyByEmail({
        accountKey,
        email,
        client: opts?.client,
        maxAgeSeconds,
      });

      // Mint a session cookie so the bearer flow opens a browser session.
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.append("Set-Cookie", setAuthCookieHeader(linked.userId));
      return new Response(
        JSON.stringify({
          account_token: linked.accountToken,
          email: linked.email,
        }),
        { status: 200, headers },
      );
    } catch (err) {
      const e = err as { status?: number; code?: string };
      const status = e.status;
      if (status === 401 || e.code === "unauthorized") {
        return errorFromCaught(err, 401, "unauthorized");
      }
      if (typeof status === "number" && status >= 400 && status < 500) {
        return errorFromCaught(err, status, "bad_request");
      }
      return errorFromCaught(err, 500, "internal");
    }
  };

  const publicDelegate: RouteHandler = async (req) => {
    const res = await middleware(req);
    return res ?? notFound();
  };

  const authedDelegate: RouteHandler = async (req) => {
    const auth = await requireAuthAsync(req);
    if (auth instanceof Response) return auth;
    const res = await middleware(req, auth.userId);
    return res ?? notFound();
  };

  return {
    [`${PREFIX}/link`]: { POST: publicDelegate },
    [`${PREFIX}/auth-link`]: { POST: publicDelegate },
    [`${PREFIX}/link-key`]: { POST: linkKey },
    [`${PREFIX}/issue-key`]: { POST: authedDelegate },
    [`${PREFIX}/confirm`]: { POST: authedDelegate },
    [`${PREFIX}/status`]: { GET: authedDelegate },
  };
}
