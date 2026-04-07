import type { Database } from "bun:sqlite";
import { type AuthResult, LOCAL_TOKEN, verifyToken } from "../auth";

/**
 * Self-hosted mode is the default for FOSS users: auth is bypassed,
 * billing is skipped, and the server uses the well-known local token.
 *
 * Hosted mode (depends.cc) is enabled automatically when `LEGENDUM_API_KEY`
 * is set in the environment — full bearer-token auth, Legendum billing,
 * account signup, etc.
 */
let byLegendumOverride: boolean | null = null;

export function isByLegendum(): boolean {
  if (byLegendumOverride !== null) return byLegendumOverride;
  return !!process.env.LEGENDUM_API_KEY;
}

export function isSelfHosted(): boolean {
  return !isByLegendum();
}

/**
 * Test helper: force hosted-mode on or off, ignoring the env var.
 * Pass `null` to restore env-based detection.
 */
export function setByLegendum(value: boolean | null): void {
  byLegendumOverride = value;
}

const LOCALHOST_ADDRS = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "localhost",
]);

export function isLocalRequest(request: Request, server: unknown): boolean {
  if (isSelfHosted()) return true;
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) {
    const clientIp = forwarded.split(",")[0].trim();
    return LOCALHOST_ADDRS.has(clientIp);
  }
  if (
    !server ||
    typeof (server as Record<string, unknown>).requestIP !== "function"
  )
    return false;
  const ip = (
    server as { requestIP(req: Request): { address: string } | null }
  ).requestIP(request);
  return ip ? LOCALHOST_ADDRS.has(ip.address) : false;
}

/** Extract bearer token from request, returning 401 response on failure */
export function extractBearer(request: Request): string | Response {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    // In self-hosted mode, treat missing auth as the local token.
    if (isSelfHosted()) return LOCAL_TOKEN;
    return Response.json({ error: "Missing authorization." }, { status: 401 });
  }
  return authHeader.slice(7);
}

export function ensureLocalToken(db: Database) {
  db.query(
    "INSERT OR IGNORE INTO tokens (id, token_hash) VALUES (0, 'local')",
  ).run();
}

export function basicAuthChallenge(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="depends.cc"' },
  });
}

export async function authenticateBasic(
  db: Database,
  namespace: string,
  request: Request,
  isLocal: boolean,
): Promise<AuthResult | Response> {
  // In self-hosted mode, skip Basic Auth entirely and auto-create the namespace.
  if (isLocal && isSelfHosted()) {
    db.query(
      "INSERT OR IGNORE INTO namespaces (id, token_id) VALUES (?, 0)",
    ).run(namespace);
    const auth = await verifyToken(db, LOCAL_TOKEN, {
      namespace,
      isLocal: true,
    });
    if (auth) return auth;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Basic ")) return basicAuthChallenge();

  const decoded = atob(authHeader.slice(6));
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return basicAuthChallenge();

  const token = decoded.slice(colonIdx + 1);

  const auth = await verifyToken(db, token, { namespace, isLocal });
  if (!auth) return basicAuthChallenge();
  return auth;
}

/** Helper to extract auth from store */
export function auth(store: unknown): AuthResult {
  return (store as { auth: AuthResult }).auth;
}
