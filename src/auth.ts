import { Database } from "bun:sqlite";

export interface AuthResult {
  tokenId: number;
  nsId: number;
  plan: string;
}

/** Well-known token for local development — no signup needed, no limits. */
export const LOCAL_TOKEN = "dep_local";

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const encoded = Buffer.from(bytes).toString("base64url");
  return `dep_${encoded}`;
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(hash).toString("hex");
}

/**
 * Verify a bearer token and check it owns the given namespace.
 * Returns { tokenId, nsId, plan } on success, null on failure.
 * If isLocal is true, accepts the well-known LOCAL_TOKEN with no limits.
 */
export async function verifyToken(
  db: Database,
  namespace: string,
  token: string,
  isLocal: boolean = false
): Promise<AuthResult | null> {
  if (isLocal && token === LOCAL_TOKEN) {
    // Resolve ns_id for local token
    const ns = db.query("SELECT ns_id FROM namespaces WHERE token_id = 0 AND id = ?").get(namespace) as { ns_id: number } | null;
    return { tokenId: 0, nsId: ns?.ns_id ?? 0, plan: "enterprise" };
  }
  const hash = await hashToken(token);
  const row = db
    .query(
      `SELECT t.id, t.plan, n.ns_id FROM tokens t
       JOIN namespaces n ON n.token_id = t.id
       WHERE t.token_hash = ? AND n.id = ?`
    )
    .get(hash, namespace) as { id: number; plan: string; ns_id: number } | null;
  if (!row) return null;
  return { tokenId: row.id, nsId: row.ns_id, plan: row.plan };
}

/**
 * Verify a bearer token without checking namespace ownership.
 * Used for endpoints like POST /namespaces where the namespace doesn't exist yet.
 * If isLocal is true, accepts the well-known LOCAL_TOKEN with no limits.
 */
export async function verifyTokenOnly(
  db: Database,
  token: string,
  isLocal: boolean = false
): Promise<{ tokenId: number; plan: string } | null> {
  if (isLocal && token === LOCAL_TOKEN) {
    return { tokenId: 0, plan: "enterprise" };
  }
  const hash = await hashToken(token);
  const row = db
    .query("SELECT id, plan FROM tokens WHERE token_hash = ?")
    .get(hash) as { id: number; plan: string } | null;
  if (!row) return null;
  return { tokenId: row.id, plan: row.plan };
}
