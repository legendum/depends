import { Database } from "bun:sqlite";
import { generateToken, hashToken } from "../auth";

export async function handleCreateNamespace(
  db: Database,
  req: Request
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

  const token = generateToken();
  const hash = await hashToken(token);

  db.query("INSERT INTO namespaces (id, token_hash) VALUES (?, ?)").run(
    id,
    hash
  );

  return Response.json({ id, token }, { status: 201 });
}

export function handleDeleteNamespace(
  db: Database,
  namespace: string
): Response {
  db.query("DELETE FROM namespaces WHERE id = ?").run(namespace);
  return new Response(null, { status: 204 });
}
