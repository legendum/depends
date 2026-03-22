import { Database } from "bun:sqlite";
import { computeEffectiveState } from "../graph/effective";
import { dispatchNotifications } from "../notify/dispatcher";

const legendum = require("../legendum.js");

const VALID_STATES = ["green", "yellow", "red"] as const;

async function chargeCredits(
  legendumToken: string | null,
  amount: number,
  description: string
): Promise<Response | null> {
  if (!legendumToken) return null;
  try {
    await legendum.charge(legendumToken, amount, description);
    return null;
  } catch (err: any) {
    if (err.code === "insufficient_funds") {
      return Response.json(
        { error: "Insufficient credits. Buy more at legendum.co.uk/account" },
        { status: 402 }
      );
    }
    throw err;
  }
}

export async function handlePutState(
  db: Database,
  nsId: number,
  namespace: string,
  nodeId: string,
  state: string,
  req: Request,
  legendumToken: string | null
): Promise<Response> {
  if (nodeId.includes("/")) {
    return Response.json({ error: "Node ID must not contain '/'." }, { status: 400 });
  }

  const reason = req.headers.get("X-Reason");
  const solution = req.headers.get("X-Solution");

  if (!VALID_STATES.includes(state as (typeof VALID_STATES)[number])) {
    return Response.json({ error: "Invalid state. Use green, yellow, or red." }, { status: 400 });
  }

  const existing = db
    .query("SELECT state FROM nodes WHERE ns_id = ? AND id = ?")
    .get(nsId, nodeId) as { state: string } | null;

  if (!existing) {
    // New node — charge for node create + state write
    const chargeErr = await chargeCredits(legendumToken, 5, `node create: ${namespace}/${nodeId}`);
    if (chargeErr) return chargeErr;

    db.query(
      "INSERT INTO nodes (ns_id, id, state, reason, solution, last_state_write) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).run(nsId, nodeId, state, reason, solution);

    const writeErr = await chargeCredits(legendumToken, 1, `state write: ${namespace}/${nodeId}`);
    if (writeErr) return writeErr;

    dispatchNotifications(db, nsId, namespace, nodeId, null, state, null, reason, solution, legendumToken);
    return new Response(null, { status: 204 });
  }

  if (existing.state === state) {
    db.query(
      "UPDATE nodes SET last_state_write = datetime('now'), reason = COALESCE(?, reason), solution = COALESCE(?, solution) WHERE ns_id = ? AND id = ?"
    ).run(reason, solution, nsId, nodeId);

    const writeErr = await chargeCredits(legendumToken, 1, `state write: ${namespace}/${nodeId}`);
    if (writeErr) return writeErr;

    return new Response(null, { status: 204 });
  }

  // State change — charge for state write
  const writeErr = await chargeCredits(legendumToken, 1, `state write: ${namespace}/${nodeId}`);
  if (writeErr) return writeErr;

  const prevState = existing.state;
  const prevEffective = computeEffectiveState(db, nsId, nodeId);

  db.query(
    `UPDATE nodes SET state = ?, reason = ?, solution = ?, state_changed_at = datetime('now'), updated_at = datetime('now'), last_state_write = datetime('now')
     WHERE ns_id = ? AND id = ?`
  ).run(state, reason, solution, nsId, nodeId);

  dispatchNotifications(db, nsId, namespace, nodeId, prevState, state, prevEffective, reason, solution, legendumToken);

  return new Response(null, { status: 204 });
}
