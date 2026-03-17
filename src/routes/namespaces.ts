import { Database } from "bun:sqlite";
import { generateToken, hashToken } from "../auth";
import { PLAN_LIMITS } from "../db";
import { sendSignupEmail } from "../notify/email";

export async function handleSignup(
  db: Database,
  req: Request
): Promise<Response> {
  let email: string | undefined;
  try {
    const body = (await req.json()) as { email?: string };
    email = body.email?.trim().toLowerCase();
  } catch {}

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "A valid email address is required." }, { status: 400 });
  }

  const existing = db.query("SELECT id FROM tokens WHERE email = ?").get(email);
  if (existing) {
    return Response.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const token = generateToken();
  const hash = await hashToken(token);

  db.query("INSERT INTO tokens (token_hash, email) VALUES (?, ?)").run(hash, email);

  sendSignupEmail(email, token);

  return Response.json(
    { message: "Account created. Your token will be emailed to you.", email },
    { status: 201 }
  );
}

export async function handleCreateNamespace(
  db: Database,
  req: Request,
  tokenId: number,
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
    return Response.json({ error: "Namespace ID must be 64 characters or fewer." }, { status: 400 });
  }

  const existing = db
    .query("SELECT ns_id FROM namespaces WHERE token_id = ? AND id = ?")
    .get(tokenId, id);

  if (existing) {
    return Response.json({ error: "Namespace already exists." }, { status: 409 });
  }

  const limits = PLAN_LIMITS[plan];
  const nsCount = db
    .query("SELECT COUNT(*) as c FROM namespaces WHERE token_id = ?")
    .get(tokenId) as { c: number };
  if (nsCount.c >= limits.namespaces) {
    return Response.json(
      { error: `Namespace limit reached for ${plan} plan (${limits.namespaces} namespaces). Upgrade at depends.cc.` },
      { status: 402 }
    );
  }

  db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run(id, tokenId);

  return Response.json({ id }, { status: 201 });
}

export function handleDeleteNamespace(
  db: Database,
  nsId: number
): Response {
  db.query("DELETE FROM namespaces WHERE ns_id = ?").run(nsId);
  return new Response(null, { status: 204 });
}
