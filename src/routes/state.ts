import { Database } from "bun:sqlite";
import { PLAN_LIMITS } from "../db";
import { computeEffectiveState } from "../graph/effective";
import { dispatchNotifications } from "../notify/dispatcher";

const VALID_STATES = ["green", "yellow", "red"] as const;

export async function handlePutState(
  db: Database,
  nsId: number,
  namespace: string,
  nodeId: string,
  state: string,
  req: Request,
  plan: string
): Promise<Response> {
  if (nodeId.includes("/")) {
    return Response.json({ error: "Node ID must not contain '/'." }, { status: 400 });
  }

  const reason = req.headers.get("X-Depends-Reason");
  const solution = req.headers.get("X-Depends-Solution");

  if (!VALID_STATES.includes(state as (typeof VALID_STATES)[number])) {
    return Response.json({ error: "Invalid state. Use green, yellow, or red." }, { status: 400 });
  }

  const existing = db
    .query("SELECT state FROM nodes WHERE ns_id = ? AND id = ?")
    .get(nsId, nodeId) as { state: string } | null;

  const limits = PLAN_LIMITS[plan];

  if (!existing) {
    const count = db.query("SELECT COUNT(*) as c FROM nodes WHERE ns_id = ?").get(nsId) as { c: number };
    if (count.c >= limits.nodes) {
      return Response.json(
        { error: `Node limit reached for ${plan} plan (${limits.nodes} nodes). Upgrade at depends.cc.` },
        { status: 402 }
      );
    }

    db.query(
      "INSERT INTO nodes (ns_id, id, state, reason, solution, last_state_write) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).run(nsId, nodeId, state, reason, solution);

    const eventCount = db
      .query(`SELECT COUNT(*) as c FROM events WHERE ns_id = ? AND created_at >= datetime('now', 'start of month')`)
      .get(nsId) as { c: number };
    if (eventCount.c >= limits.events) {
      return Response.json(
        { error: `Event limit reached for ${plan} plan (${limits.events} events/month). Upgrade at depends.cc.` },
        { status: 402 }
      );
    }

    dispatchNotifications(db, nsId, namespace, nodeId, null, state, null, reason, solution);
    return new Response(null, { status: 204 });
  }

  if (existing.state === state) {
    db.query(
      "UPDATE nodes SET last_state_write = datetime('now'), reason = COALESCE(?, reason), solution = COALESCE(?, solution) WHERE ns_id = ? AND id = ?"
    ).run(reason, solution, nsId, nodeId);
    return new Response(null, { status: 204 });
  }

  const eventCount = db
    .query(`SELECT COUNT(*) as c FROM events WHERE ns_id = ? AND created_at >= datetime('now', 'start of month')`)
    .get(nsId) as { c: number };
  if (eventCount.c >= limits.events) {
    return Response.json(
      { error: `Event limit reached for ${plan} plan (${limits.events} events/month). Upgrade at depends.cc.` },
      { status: 402 }
    );
  }

  const prevState = existing.state;
  const prevEffective = computeEffectiveState(db, nsId, nodeId);

  db.query(
    `UPDATE nodes SET state = ?, reason = ?, solution = ?, state_changed_at = datetime('now'), updated_at = datetime('now'), last_state_write = datetime('now')
     WHERE ns_id = ? AND id = ?`
  ).run(state, reason, solution, nsId, nodeId);

  dispatchNotifications(db, nsId, namespace, nodeId, prevState, state, prevEffective, reason, solution);

  return new Response(null, { status: 204 });
}
