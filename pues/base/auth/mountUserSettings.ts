/**
 * `mountUserSettings()` — mounts `/pues/me` (GET + PATCH).
 *
 *   GET /pues/me   → { legendum_linked, hosted, meta }
 *   PATCH /pues/me → accepts `{ meta: {...} }`; merges into existing
 *                    meta and returns `{ meta: <merged> }`
 *
 * `meta` is consumer-extensible — pues passes unknown keys through to
 * `users.meta` unchanged. Pues-owned keys (today: just `theme`) are
 * validated and dropped silently if invalid; unknown keys are never
 * dropped. The intent is for consumers to persist arbitrary
 * customization without pues needing to know about it.
 *
 * Authenticated only — returns 401 otherwise.
 */

import { isSelfHosted } from "../core/mode";
import { requireAuthAsync } from "./middleware";
import { getUserStorage } from "./storage";

type RouteHandler = (req: Request) => Response | Promise<Response>;

const ALLOWED_THEMES = new Set(["system", "light", "dark"]);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Validate pues-owned keys; pass everything else through unchanged.
 * Today's only pues-owned key is `theme`. An invalid `theme` value is
 * dropped (matches the historical sanitizer behaviour — no 400, the
 * client just sees the field absent in the response).
 */
function sanitizeMeta(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {
    ...(input as Record<string, unknown>),
  };
  if (out.theme !== undefined) {
    const ok = typeof out.theme === "string" && ALLOWED_THEMES.has(out.theme);
    if (!ok) delete out.theme;
  }
  return out;
}

const getMe: RouteHandler = async (req) => {
  const auth = await requireAuthAsync(req);
  if (auth instanceof Response) return auth;

  const storage = getUserStorage();
  const token = await storage.getLegendumToken(auth.userId);
  const meta = await storage.getMeta(auth.userId);

  return jsonResponse({
    legendum_linked: !!token,
    hosted: !isSelfHosted(),
    meta,
  });
};

const patchMe: RouteHandler = async (req) => {
  const auth = await requireAuthAsync(req);
  if (auth instanceof Response) return auth;

  let body: { meta?: unknown };
  try {
    body = (await req.json()) as { meta?: unknown };
  } catch {
    return jsonResponse(
      { error: "invalid_request", message: "Invalid JSON" },
      400,
    );
  }
  if (!body.meta || typeof body.meta !== "object" || Array.isArray(body.meta)) {
    return jsonResponse(
      { error: "invalid_request", message: "meta must be an object" },
      400,
    );
  }

  const storage = getUserStorage();
  const existing = await storage.getMeta(auth.userId);
  const merged = { ...existing, ...sanitizeMeta(body.meta) };
  await storage.updateMeta(auth.userId, merged);

  return jsonResponse({ meta: merged });
};

export function mountUserSettings(): Record<
  string,
  Record<string, RouteHandler>
> {
  return {
    "/pues/me": {
      GET: getMe,
      PATCH: patchMe,
    },
  };
}
