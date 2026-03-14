import { Database } from "bun:sqlite";

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const encoded = Buffer.from(bytes).toString("base64url");
  return `dps_${encoded}`;
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(hash).toString("hex");
}

export async function verifyToken(
  db: Database,
  namespace: string,
  token: string
): Promise<boolean> {
  const row = db
    .query("SELECT token_hash FROM namespaces WHERE id = ?")
    .get(namespace) as { token_hash: string } | null;
  if (!row) return false;
  const hash = await hashToken(token);
  return hash === row.token_hash;
}
