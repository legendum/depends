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
  req: Request,
  plan: string
): Promise<Response> {
  // Validate node ID
  if (nodeId.includes("/")) {
    return Response.json({ error: "Node ID must not contain '/'." }, { status: 400 });
  }

  const reason = req.headers.get("X-Depends-Reason");
  const solution = req.headers.get("X-Depends-Solution");

  if (!VALID_STATES.includes(state as (typeof VALID_STATES)[number])) {
    return Response.json(
      { error: "Invalid state. Use green, yellow, or red." },
      { status: 400 }
    );
  }

  const existing = db
    .query("SELECT state FROM nodes WHERE namespace = ? AND id = ?")
    .get(namespace, nodeId) as { state: string } | null;

  const limits = PLAN_LIMITS[plan];

  // Auto-create node if it doesn't exist
  if (!existing) {
    const count = db
      .query("SELECT COUNT(*) as c FROM nodes WHERE namespace = ?")
      .get(namespace) as { c: number };
    if (count.c >= limits.nodes) {
      return Response.json(
        {
          error: `Node limit reached for ${plan} plan (${limits.nodes} nodes). Upgrade at depends.cc.`,
        },
        { status: 402 }
      );
    }

    db.query(
      "INSERT INTO nodes (namespace, id, state, reason, solution, last_state_write) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).run(namespace, nodeId, state, reason, solution);

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
          error: `Event limit reached for ${plan} plan (${limits.events} events/month). Upgrade at depends.cc.`,
        },
        { status: 402 }
      );
    }

    dispatchNotifications(db, namespace, nodeId, null, state, null, reason, solution);
    return new Response(null, { status: 204 });
  }

  // Same state — still update last_state_write (resets TTL clock), reason, and solution
  if (existing.state === state) {
    db.query(
      "UPDATE nodes SET last_state_write = datetime('now'), reason = COALESCE(?, reason), solution = COALESCE(?, solution) WHERE namespace = ? AND id = ?"
    ).run(reason, solution, namespace, nodeId);
    return new Response(null, { status: 204 });
  }

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
        error: `Event limit reached for ${plan} plan (${limits.events} events/month). Upgrade at depends.cc.`,
      },
      { status: 402 }
    );
  }

  const prevState = existing.state;
  const prevEffective = computeEffectiveState(db, namespace, nodeId);

  db.query(
    `UPDATE nodes SET state = ?, reason = ?, solution = ?, state_changed_at = datetime('now'), updated_at = datetime('now'), last_state_write = datetime('now')
     WHERE namespace = ? AND id = ?`
  ).run(state, reason, solution, namespace, nodeId);

  dispatchNotifications(
    db,
    namespace,
    nodeId,
    prevState,
    state,
    prevEffective,
    reason,
    solution
  );

  return new Response(null, { status: 204 });
}
