import { Database } from "bun:sqlite";
import { PLAN_LIMITS } from "../db";
import { computeEffectiveState } from "../graph/effective";
import { dispatchNotifications } from "../notify/dispatcher";

const VALID_STATES = ["green", "yellow", "red"] as const;

export async function handlePutState(
  db: Database,
  namespace: string,
  nodeId: string,
  state: string,
  req: Request
): Promise<Response> {
  const reason = req.headers.get("X-Depends-Reason");

  if (!VALID_STATES.includes(state as (typeof VALID_STATES)[number])) {
    return Response.json(
      { error: "Invalid state. Use green, yellow, or red." },
      { status: 400 }
    );
  }

  const existing = db
    .query("SELECT state FROM nodes WHERE namespace = ? AND id = ?")
    .get(namespace, nodeId) as { state: string } | null;

  // Auto-create node if it doesn't exist
  if (!existing) {
    const ns = db
      .query("SELECT plan FROM namespaces WHERE id = ?")
      .get(namespace) as { plan: string };
    const limits = PLAN_LIMITS[ns.plan];
    const count = db
      .query("SELECT COUNT(*) as c FROM nodes WHERE namespace = ?")
      .get(namespace) as { c: number };
    if (count.c >= limits.nodes) {
      return Response.json(
        {
          error: `Node limit reached for ${ns.plan} plan (${limits.nodes} nodes). Upgrade at depends.cc.`,
        },
        { status: 402 }
      );
    }

    db.query(
      "INSERT INTO nodes (namespace, id, state, reason, last_state_write) VALUES (?, ?, ?, ?, datetime('now'))"
    ).run(namespace, nodeId, state, reason);

    // Check event limit
    const eventCount = db
      .query(
        `SELECT COUNT(*) as c FROM events
         WHERE namespace = ? AND created_at >= datetime('now', 'start of month')`
      )
      .get(namespace) as { c: number };
    if (eventCount.c >= limits.events) {
      return Response.json(
        {
          error: `Event limit reached for ${ns.plan} plan (${limits.events} events/month). Upgrade at depends.cc.`,
        },
        { status: 402 }
      );
    }

    dispatchNotifications(db, namespace, nodeId, null, state, null, reason);
    return new Response(null, { status: 204 });
  }

  // Same state — still update last_state_write (resets TTL clock) and reason
  if (existing.state === state) {
    db.query(
      "UPDATE nodes SET last_state_write = datetime('now'), reason = COALESCE(?, reason) WHERE namespace = ? AND id = ?"
    ).run(reason, namespace, nodeId);
    return new Response(null, { status: 204 });
  }

  // Check event limit
  const ns = db
    .query("SELECT plan FROM namespaces WHERE id = ?")
    .get(namespace) as { plan: string };
  const limits = PLAN_LIMITS[ns.plan];
  const eventCount = db
    .query(
      `SELECT COUNT(*) as c FROM events
       WHERE namespace = ? AND created_at >= datetime('now', 'start of month')`
    )
    .get(namespace) as { c: number };
  if (eventCount.c >= limits.events) {
    return Response.json(
      {
        error: `Event limit reached for ${ns.plan} plan (${limits.events} events/month). Upgrade at depends.cc.`,
      },
      { status: 402 }
    );
  }

  const prevState = existing.state;
  const prevEffective = computeEffectiveState(db, namespace, nodeId);

  db.query(
    `UPDATE nodes SET state = ?, reason = ?, state_changed_at = datetime('now'), updated_at = datetime('now'), last_state_write = datetime('now')
     WHERE namespace = ? AND id = ?`
  ).run(state, reason, namespace, nodeId);

  dispatchNotifications(
    db,
    namespace,
    nodeId,
    prevState,
    state,
    prevEffective,
    reason
  );

  return new Response(null, { status: 204 });
}
