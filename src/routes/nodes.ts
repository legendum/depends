import { Database } from "bun:sqlite";
import { computeEffectiveState } from "../graph/effective";
import { wouldCreateCycle } from "../graph/cycle";
import { PLAN_LIMITS, parseTtl } from "../db";
import { dispatchNotifications } from "../notify/dispatcher";

interface NodeBody {
  state?: string;
  reason?: string | null;
  solution?: string | null;
  label?: string;
  depends_on?: string[];
  ttl?: string | null;
  meta?: Record<string, unknown>;
}

function checkNodeLimit(db: Database, namespace: string, plan: string): Response | null {
  const limits = PLAN_LIMITS[plan];
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
  return null;
}

function checkEventLimit(db: Database, namespace: string, plan: string): Response | null {
  const limits = PLAN_LIMITS[plan];
  const count = db
    .query(
      `SELECT COUNT(*) as c FROM events
       WHERE namespace = ? AND created_at >= datetime('now', 'start of month')`
    )
    .get(namespace) as { c: number };
  if (count.c >= limits.events) {
    return Response.json(
      {
        error: `Event limit reached for ${plan} plan (${limits.events} events/month). Upgrade at depends.cc.`,
      },
      { status: 402 }
    );
  }
  return null;
}

export async function handlePutNode(
  db: Database,
  namespace: string,
  nodeId: string,
  req: Request,
  plan: string
): Promise<Response> {
  // Validate node ID
  if (nodeId.includes("/")) {
    return Response.json({ error: "Node ID must not contain '/'." }, { status: 400 });
  }

  const body = (await req.json()) as NodeBody;

  const existing = db
    .query("SELECT state FROM nodes WHERE namespace = ? AND id = ?")
    .get(namespace, nodeId) as { state: string } | null;

  if (!existing) {
    const limitErr = checkNodeLimit(db, namespace, plan);
    if (limitErr) return limitErr;
  }

  const validStates = ["green", "yellow", "red"];
  if (body.state && !validStates.includes(body.state)) {
    return Response.json({ error: "Invalid state. Use green, yellow, or red." }, { status: 400 });
  }

  let ttlSeconds: number | null | undefined;
  if (body.ttl !== undefined) {
    if (body.ttl === null) {
      ttlSeconds = null; // clear TTL
    } else {
      try {
        ttlSeconds = parseTtl(body.ttl);
      } catch {
        return Response.json({ error: 'Invalid TTL format. Use e.g. "30s", "10m", "1h", "7d".' }, { status: 400 });
      }
    }
  }

  const prevState = existing?.state ?? null;
  const state = body.state ?? existing?.state ?? "yellow";
  const stateChanged = prevState !== null && state !== prevState;

  if (existing) {
    const setParts: string[] = [];
    const params: unknown[] = [];

    if (body.label !== undefined) {
      setParts.push("label = ?");
      params.push(body.label);
    }
    if (body.state !== undefined) {
      setParts.push("state = ?");
      params.push(body.state);
      if (stateChanged) {
        setParts.push("state_changed_at = datetime('now')");
      }
    }
    if (body.reason !== undefined) {
      setParts.push("reason = ?");
      params.push(body.reason);
    }
    if (body.solution !== undefined) {
      setParts.push("solution = ?");
      params.push(body.solution);
    }
    if (body.meta !== undefined) {
      setParts.push("meta = ?");
      params.push(JSON.stringify(body.meta));
    }
    if (ttlSeconds !== undefined) {
      setParts.push("ttl = ?");
      params.push(ttlSeconds);
    }
    setParts.push("updated_at = datetime('now')");

    if (setParts.length > 0) {
      params.push(namespace, nodeId);
      db.query(
        `UPDATE nodes SET ${setParts.join(", ")} WHERE namespace = ? AND id = ?`
      ).run(...params);
    }
  } else {
    db.query(
      `INSERT INTO nodes (namespace, id, label, state, reason, solution, meta, ttl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      namespace,
      nodeId,
      body.label ?? null,
      state,
      body.reason ?? null,
      body.solution ?? null,
      body.meta ? JSON.stringify(body.meta) : null,
      ttlSeconds ?? null
    );
  }

  // Handle depends_on
  if (body.depends_on !== undefined) {
    // Remove existing edges from this node
    db.query("DELETE FROM edges WHERE namespace = ? AND from_node = ?").run(
      namespace,
      nodeId
    );

    for (const dep of body.depends_on) {
      // Auto-create dependency nodes that don't exist
      const depExists = db
        .query("SELECT id FROM nodes WHERE namespace = ? AND id = ?")
        .get(namespace, dep);

      if (!depExists) {
        const limitErr = checkNodeLimit(db, namespace, plan);
        if (limitErr) return limitErr;
        db.query(
          "INSERT INTO nodes (namespace, id, state) VALUES (?, ?, 'yellow')"
        ).run(namespace, dep);
      }

      if (wouldCreateCycle(db, namespace, nodeId, dep)) {
        return Response.json(
          { error: `Cycle detected: ${nodeId} -> ${dep} would create a cycle.` },
          { status: 409 }
        );
      }

      db.query(
        "INSERT OR IGNORE INTO edges (namespace, from_node, to_node) VALUES (?, ?, ?)"
      ).run(namespace, nodeId, dep);
    }
  }

  // Dispatch notifications on state change
  if (stateChanged) {
    const eventLimitErr = checkEventLimit(db, namespace, plan);
    if (eventLimitErr) return eventLimitErr;

    const prevEffective = prevState
      ? computeEffectiveState(db, namespace, nodeId)
      : null;
    // State already updated in DB, recompute
    dispatchNotifications(
      db,
      namespace,
      nodeId,
      prevState,
      state,
      prevEffective,
      body.reason ?? null,
      body.solution ?? null
    );
  }

  const node = db
    .query("SELECT * FROM nodes WHERE namespace = ? AND id = ?")
    .get(namespace, nodeId) as Record<string, unknown>;

  return Response.json(formatNode(db, namespace, node), {
    status: existing ? 200 : 201,
  });
}

export function handleGetNode(
  db: Database,
  namespace: string,
  nodeId: string
): Response {
  const node = db
    .query("SELECT * FROM nodes WHERE namespace = ? AND id = ?")
    .get(namespace, nodeId) as Record<string, unknown> | null;

  if (!node) {
    return Response.json({ error: "Node not found." }, { status: 404 });
  }

  return Response.json(formatNode(db, namespace, node));
}

export function handleDeleteNode(
  db: Database,
  namespace: string,
  nodeId: string
): Response {
  const existing = db
    .query("SELECT id FROM nodes WHERE namespace = ? AND id = ?")
    .get(namespace, nodeId);

  if (!existing) {
    return Response.json({ error: "Node not found." }, { status: 404 });
  }

  db.query("DELETE FROM nodes WHERE namespace = ? AND id = ?").run(
    namespace,
    nodeId
  );
  return new Response(null, { status: 204 });
}

export function handleListNodes(
  db: Database,
  namespace: string
): Response {
  const nodes = db
    .query("SELECT * FROM nodes WHERE namespace = ? ORDER BY id")
    .all(namespace) as Record<string, unknown>[];

  return Response.json(
    nodes.map((n) => formatNode(db, namespace, n))
  );
}

function formatTtl(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function formatNode(
  db: Database,
  namespace: string,
  node: Record<string, unknown>
) {
  const nodeId = node.id as string;

  const dependsOn = db
    .query("SELECT to_node FROM edges WHERE namespace = ? AND from_node = ?")
    .all(namespace, nodeId) as { to_node: string }[];

  const dependedOnBy = db
    .query("SELECT from_node FROM edges WHERE namespace = ? AND to_node = ?")
    .all(namespace, nodeId) as { from_node: string }[];

  const ttl = node.ttl as number | null;
  return {
    id: nodeId,
    namespace,
    state: node.state,
    effective_state: computeEffectiveState(db, namespace, nodeId),
    reason: node.reason ?? null,
    solution: node.solution ?? null,
    label: node.label ?? null,
    depends_on: dependsOn.map((e) => e.to_node),
    depended_on_by: dependedOnBy.map((e) => e.from_node),
    ttl: ttl ? formatTtl(ttl) : null,
    meta: node.meta ? JSON.parse(node.meta as string) : null,
    state_changed_at: node.state_changed_at,
    updated_at: node.updated_at,
  };
}
