import type { Database } from "bun:sqlite";

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
  nsId: number,
  req: Request,
  tokenId: number,
): Promise<Response> {
  const body = (await req.json()) as NotificationBody;

  if (!body.id || typeof body.id !== "string") {
    return Response.json(
      { error: "Missing or invalid rule ID." },
      { status: 400 },
    );
  }

  if (!body.url && !body.email) {
    return Response.json(
      { error: "Rule must have either 'url' or 'email'." },
      { status: 400 },
    );
  }

  let emailAddr: string | null = null;
  if (body.email) {
    const owner = db
      .query("SELECT email FROM tokens WHERE id = ?")
      .get(tokenId) as { email: string | null } | null;
    if (!owner?.email) {
      return Response.json(
        { error: "No email address on file for this token." },
        { status: 400 },
      );
    }
    emailAddr = owner.email;
  }

  const onState = Array.isArray(body.on)
    ? body.on.join(",")
    : (body.on ?? "red");

  const ackToken = body.ack
    ? Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
        "base64url",
      )
    : null;

  db.query(
    `INSERT OR REPLACE INTO notification_rules
     (ns_id, id, watch, on_state, url, email, secret, ack, ack_token, suppressed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    nsId,
    body.id,
    body.watch ?? "*",
    onState,
    body.url ?? null,
    emailAddr,
    body.secret ?? null,
    body.ack ? 1 : 0,
    ackToken,
  );

  return Response.json({ ok: true }, { status: 200 });
}

export function handleListNotifications(
  db: Database,
  nsId: number,
  namespace: string,
): Response {
  const rules = db
    .query("SELECT * FROM notification_rules WHERE ns_id = ? ORDER BY id")
    .all(nsId) as Record<string, unknown>[];

  return Response.json(rules.map((r) => formatRule(r, namespace)));
}

export function handleDeleteNotification(
  db: Database,
  nsId: number,
  ruleId: string,
): Response {
  const existing = db
    .query("SELECT id FROM notification_rules WHERE ns_id = ? AND id = ?")
    .get(nsId, ruleId);

  if (!existing) {
    return Response.json({ error: "Rule not found." }, { status: 404 });
  }

  db.query("DELETE FROM notification_rules WHERE ns_id = ? AND id = ?").run(
    nsId,
    ruleId,
  );
  return new Response(null, { status: 204 });
}

export function handleAckNotification(
  db: Database,
  nsId: number,
  ruleId: string,
): Response {
  const existing = db
    .query("SELECT id FROM notification_rules WHERE ns_id = ? AND id = ?")
    .get(nsId, ruleId);

  if (!existing) {
    return Response.json({ error: "Rule not found." }, { status: 404 });
  }

  db.query(
    "UPDATE notification_rules SET suppressed = 0 WHERE ns_id = ? AND id = ?",
  ).run(nsId, ruleId);
  return Response.json({ ok: true });
}

function formatRule(r: Record<string, unknown>, namespace: string) {
  const onParts = (r.on_state as string).split(",");
  return {
    id: r.id,
    namespace,
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
