import type { Database } from "bun:sqlite";
import { generateToken, hashToken } from "../auth";
import { sendSignupEmail } from "../notify/email";

const legendum = require("../lib/legendum.js");

export async function handleSignup(
  db: Database,
  req: Request,
): Promise<Response> {
  let body: { email?: string; account_key?: string };
  try {
    body = (await req.json()) as { email?: string; account_key?: string };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json(
      { error: "A valid email address is required." },
      { status: 400 },
    );
  }

  if (!body.account_key?.startsWith("lak_")) {
    return Response.json(
      { error: "A Legendum account key (lak_...) is required." },
      { status: 400 },
    );
  }

  const existing = db.query("SELECT id FROM tokens WHERE email = ?").get(email);
  if (existing) {
    return Response.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  // Link agent key to this service via Legendum
  let legendumToken: string;
  try {
    const result = (await legendum.linkAccount(body.account_key)) as {
      account_token: string;
      email: string;
    };
    if (!result.account_token) {
      return Response.json(
        { error: "Legendum did not return an account token for this key." },
        { status: 502 },
      );
    }
    legendumToken = result.account_token;
  } catch (err: any) {
    const message = err?.message || "Failed to link Legendum account";
    const status = err?.status || 502;
    return Response.json({ error: message }, { status });
  }

  const token = generateToken();
  const hash = await hashToken(token);

  db.query(
    "INSERT INTO tokens (token_hash, email, legendum_token) VALUES (?, ?, ?)",
  ).run(hash, email, legendumToken);

  sendSignupEmail(email, token);

  return Response.json(
    { message: "Account created. Your token will be emailed to you.", email },
    { status: 201 },
  );
}

export async function handleCreateNamespace(
  db: Database,
  req: Request,
  tokenId: number,
): Promise<Response> {
  const body = (await req.json()) as { id?: string };
  const id = body.id;

  if (!id || typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return Response.json(
      {
        error: "Invalid namespace ID. Use lowercase alphanumeric and hyphens.",
      },
      { status: 400 },
    );
  }

  if (id.length > 64) {
    return Response.json(
      { error: "Namespace ID must be 64 characters or fewer." },
      { status: 400 },
    );
  }

  const existing = db
    .query("SELECT ns_id FROM namespaces WHERE token_id = ? AND id = ?")
    .get(tokenId, id);

  if (existing) {
    return Response.json(
      { error: "Namespace already exists." },
      { status: 409 },
    );
  }

  db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run(
    id,
    tokenId,
  );

  return Response.json({ id }, { status: 201 });
}

export function handleDeleteNamespace(db: Database, nsId: number): Response {
  db.query("DELETE FROM namespaces WHERE ns_id = ?").run(nsId);
  return new Response(null, { status: 204 });
}
