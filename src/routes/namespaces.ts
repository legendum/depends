import { Database } from "bun:sqlite";
import { generateToken, generateTokenId, hashToken } from "../auth";
import { PLAN_LIMITS } from "../db";

/**
 * POST /v1/signup — unauthenticated.
 * Creates a new token (account). Returns the token once.
 */
export async function handleSignup(
  db: Database,
  _req: Request
): Promise<Response> {
  const token = generateToken();
  const tokenId = generateTokenId();
  const hash = await hashToken(token);

  db.query("INSERT INTO tokens (id, token_hash) VALUES (?, ?)").run(
    tokenId,
    hash
  );

  return Response.json({ token }, { status: 201 });
}

/**
 * POST /v1/namespaces — authenticated (token required).
 * Creates a namespace under the caller's token.
 */
export async function handleCreateNamespace(
  db: Database,
  req: Request,
  tokenId: string,
  plan: string
): Promise<Response> {
  const body = (await req.json()) as { id?: string };
  const id = body.id;

  if (!id || typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return Response.json(
      { error: "Invalid namespace ID. Use lowercase alphanumeric and hyphens." },
      { status: 400 }
    );
  }

  if (id.length > 64) {
    return Response.json(
      { error: "Namespace ID must be 64 characters or fewer." },
      { status: 400 }
    );
  }

  const existing = db
    .query("SELECT id FROM namespaces WHERE id = ?")
    .get(id);

  if (existing) {
    return Response.json(
      { error: "Namespace already exists." },
      { status: 409 }
    );
  }

  // Check namespace count limit
  const limits = PLAN_LIMITS[plan];
  const nsCount = db
    .query("SELECT COUNT(*) as c FROM namespaces WHERE token_id = ?")
    .get(tokenId) as { c: number };
  if (nsCount.c >= limits.namespaces) {
    return Response.json(
      {
        error: `Namespace limit reached for ${plan} plan (${limits.namespaces} namespaces). Upgrade at depends.cc.`,
      },
      { status: 402 }
    );
  }

  db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run(
    id,
    tokenId
  );

  return Response.json({ id }, { status: 201 });
}

export function handleDeleteNamespace(
  db: Database,
  namespace: string
): Response {
  db.query("DELETE FROM namespaces WHERE id = ?").run(namespace);
  return new Response(null, { status: 204 });
}
