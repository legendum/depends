import { Database } from "bun:sqlite";

export function handleGetUsage(
  db: Database,
  nsId: number,
  namespace: string,
  tokenId: number,
  plan: string
): Response {
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const activeNodes = db
    .query(`SELECT COUNT(DISTINCT node_id) as c FROM events WHERE ns_id = ? AND created_at >= datetime('now', 'start of month')`)
    .get(nsId) as { c: number };

  const totalEvents = db
    .query(`SELECT COUNT(*) as c FROM events WHERE ns_id = ? AND created_at >= datetime('now', 'start of month')`)
    .get(nsId) as { c: number };

  const totalNodes = db
    .query("SELECT COUNT(*) as c FROM nodes WHERE ns_id = ?")
    .get(nsId) as { c: number };

  const webhookDeliveries = db
    .query(`SELECT COUNT(*) as c FROM notification_rules WHERE ns_id = ? AND url IS NOT NULL AND last_fired_at >= datetime('now', 'start of month')`)
    .get(nsId) as { c: number };

  const emailsSent = db
    .query(`SELECT COUNT(*) as c FROM notification_rules WHERE ns_id = ? AND email IS NOT NULL AND last_fired_at >= datetime('now', 'start of month')`)
    .get(nsId) as { c: number };

  const token = db
    .query("SELECT email FROM tokens WHERE id = ?")
    .get(tokenId) as { email: string | null } | null;

  return Response.json({
    email: token?.email ?? null,
    namespace,
    plan,
    period,
    nodes: totalNodes.c,
    active_nodes: activeNodes.c,
    total_events: totalEvents.c,
    webhook_deliveries: webhookDeliveries.c,
    emails_sent: emailsSent.c,
  });
}
