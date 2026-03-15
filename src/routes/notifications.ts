import { Database } from "bun:sqlite";

interface NotificationBody {
  id: string;
  watch?: string;
  on?: string | string[];
  url?: string;
  email?: boolean;
  secret?: string;
  ack?: boolean;
}

export async function handlePutNotification(
  db: Database,
  namespace: string,
  req: Request,
  tokenId: string
): Promise<Response> {
  const body = (await req.json()) as NotificationBody;

  if (!body.id || typeof body.id !== "string") {
    return Response.json({ error: "Missing or invalid rule ID." }, { status: 400 });
  }

  if (!body.url && !body.email) {
    return Response.json(
      { error: "Rule must have either 'url' or 'email'." },
      { status: 400 }
    );
  }

  // email: true resolves to the token owner's email
  let emailAddr: string | null = null;
  if (body.email) {
    const owner = db.query("SELECT email FROM tokens WHERE id = ?").get(tokenId) as { email: string | null } | null;
    if (!owner?.email) {
      return Response.json(
        { error: "No email address on file for this token." },
        { status: 400 }
      );
    }
    emailAddr = owner.email;
  }

  const onState = Array.isArray(body.on)
    ? body.on.join(",")
    : body.on ?? "red";

  db.query(
    `INSERT OR REPLACE INTO notification_rules
     (namespace, id, watch, on_state, url, email, secret, ack, suppressed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    namespace,
    body.id,
    body.watch ?? "*",
    onState,
    body.url ?? null,
    emailAddr,
    body.secret ?? null,
    body.ack ? 1 : 0
  );

  return Response.json({ ok: true }, { status: 200 });
}

export function handleListNotifications(
  db: Database,
  namespace: string
): Response {
  const rules = db
    .query(
      "SELECT * FROM notification_rules WHERE namespace = ? ORDER BY id"
    )
    .all(namespace) as Record<string, unknown>[];

  return Response.json(
    rules.map((r) => formatRule(r))
  );
}

export function handleDeleteNotification(
  db: Database,
  namespace: string,
  ruleId: string
): Response {
  const existing = db
    .query(
      "SELECT id FROM notification_rules WHERE namespace = ? AND id = ?"
    )
    .get(namespace, ruleId);

  if (!existing) {
    return Response.json({ error: "Rule not found." }, { status: 404 });
  }

  db.query(
    "DELETE FROM notification_rules WHERE namespace = ? AND id = ?"
  ).run(namespace, ruleId);

  return new Response(null, { status: 204 });
}

export function handleAckNotification(
  db: Database,
  namespace: string,
  ruleId: string
): Response {
  const existing = db
    .query(
      "SELECT id FROM notification_rules WHERE namespace = ? AND id = ?"
    )
    .get(namespace, ruleId);

  if (!existing) {
    return Response.json({ error: "Rule not found." }, { status: 404 });
  }

  db.query(
    "UPDATE notification_rules SET suppressed = 0 WHERE namespace = ? AND id = ?"
  ).run(namespace, ruleId);

  return Response.json({ ok: true });
}

function formatRule(r: Record<string, unknown>) {
  const onParts = (r.on_state as string).split(",");
  return {
    id: r.id,
    namespace: r.namespace,
    watch: r.watch,
    on: onParts.length === 1 ? onParts[0] : onParts,
    url: r.url ?? undefined,
    email: r.email ?? undefined,
    secret: r.secret ? "***" : undefined,
    ack: r.ack === 1,
    suppressed: r.suppressed === 1,
    last_fired_at: r.last_fired_at ?? null,
  };
}
