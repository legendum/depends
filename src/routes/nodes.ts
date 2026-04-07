import type { Database } from "bun:sqlite";
import { parseTtl } from "../db";
import { wouldCreateCycle } from "../graph/cycle";
import { computeEffectiveState } from "../graph/effective";
import { chargeCredits } from "../lib/charge";
import { dispatchNotifications } from "../notify/dispatcher";

interface NodeBody {
  state?: string;
  default_state?: string | null;
  reason?: string | null;
  solution?: string | null;
  label?: string;
  depends_on?: string[];
  ttl?: string | null;
  meta?: Record<string, unknown>;
}

export async function handlePutNode(
  db: Database,
  nsId: number,
  namespace: string,
  nodeId: string,
  req: Request,
  legendumToken: string | null,
): Promise<Response> {
  if (nodeId.includes("/")) {
    return Response.json(
      { error: "Node ID must not contain '/'." },
      { status: 400 },
    );
  }

  const body = (await req.json()) as NodeBody;

  const existing = db
    .query("SELECT state FROM nodes WHERE ns_id = ? AND id = ?")
    .get(nsId, nodeId) as { state: string } | null;

  if (!existing) {
    const chargeErr = await chargeCredits(
      legendumToken,
      1,
      `node create: ${namespace}/${nodeId}`,
    );
    if (chargeErr) return chargeErr;
  }

  const validStates = ["green", "yellow", "red"];
  if (body.state && !validStates.includes(body.state)) {
    return Response.json(
      { error: "Invalid state. Use green, yellow, or red." },
      { status: 400 },
    );
  }
  if (
    body.default_state !== undefined &&
    body.default_state !== null &&
    !validStates.includes(body.default_state)
  ) {
    return Response.json(
      { error: "Invalid default_state. Use green, yellow, or red." },
      { status: 400 },
    );
  }

  let ttlSeconds: number | null | undefined;
  if (body.ttl !== undefined) {
    if (body.ttl === null) {
      ttlSeconds = null;
    } else {
      try {
        ttlSeconds = parseTtl(body.ttl);
      } catch {
        return Response.json(
          { error: 'Invalid TTL format. Use e.g. "30s", "10m", "1h", "7d".' },
          { status: 400 },
        );
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
    if (body.default_state !== undefined) {
      setParts.push("default_state = ?");
      params.push(body.default_state);
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
      params.push(nsId, nodeId);
      db.query(
        `UPDATE nodes SET ${setParts.join(", ")} WHERE ns_id = ? AND id = ?`,
      ).run(...params);
    }
  } else {
    const initState = body.state ?? body.default_state ?? "yellow";
    db.query(
      `INSERT INTO nodes (ns_id, id, label, state, default_state, reason, solution, meta, ttl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      nsId,
      nodeId,
      body.label ?? null,
      initState,
      body.default_state ?? null,
      body.reason ?? null,
      body.solution ?? null,
      body.meta ? JSON.stringify(body.meta) : null,
      ttlSeconds ?? null,
    );
  }

  if (body.depends_on !== undefined) {
    db.query("DELETE FROM edges WHERE ns_id = ? AND from_node = ?").run(
      nsId,
      nodeId,
    );

    for (const dep of body.depends_on) {
      const depExists = db
        .query("SELECT id FROM nodes WHERE ns_id = ? AND id = ?")
        .get(nsId, dep);
      if (!depExists) {
        const chargeErr = await chargeCredits(
          legendumToken,
          1,
          `node create: ${namespace}/${dep}`,
        );
        if (chargeErr) return chargeErr;
        db.query(
          "INSERT INTO nodes (ns_id, id, state) VALUES (?, ?, 'yellow')",
        ).run(nsId, dep);
      }

      if (wouldCreateCycle(db, nsId, nodeId, dep)) {
        return Response.json(
          {
            error: `Cycle detected: ${nodeId} -> ${dep} would create a cycle.`,
          },
          { status: 409 },
        );
      }

      db.query(
        "INSERT OR IGNORE INTO edges (ns_id, from_node, to_node) VALUES (?, ?, ?)",
      ).run(nsId, nodeId, dep);
    }
  }

  if (stateChanged) {
    const prevEffective = prevState
      ? computeEffectiveState(db, nsId, nodeId)
      : null;
    dispatchNotifications(
      db,
      nsId,
      namespace,
      nodeId,
      prevState,
      state,
      prevEffective,
      body.reason ?? null,
      body.solution ?? null,
      legendumToken,
    );
  }

  const node = db
    .query("SELECT * FROM nodes WHERE ns_id = ? AND id = ?")
    .get(nsId, nodeId) as Record<string, unknown>;

  return Response.json(formatNode(db, nsId, namespace, node), {
    status: existing ? 200 : 201,
  });
}

export function handleGetNode(
  db: Database,
  nsId: number,
  namespace: string,
  nodeId: string,
): Response {
  const node = db
    .query("SELECT * FROM nodes WHERE ns_id = ? AND id = ?")
    .get(nsId, nodeId) as Record<string, unknown> | null;

  if (!node) {
    return Response.json({ error: "Node not found." }, { status: 404 });
  }

  return Response.json(formatNode(db, nsId, namespace, node));
}

export function handleDeleteNode(
  db: Database,
  nsId: number,
  nodeId: string,
): Response {
  const existing = db
    .query("SELECT id FROM nodes WHERE ns_id = ? AND id = ?")
    .get(nsId, nodeId);

  if (!existing) {
    return Response.json({ error: "Node not found." }, { status: 404 });
  }

  db.query("DELETE FROM nodes WHERE ns_id = ? AND id = ?").run(nsId, nodeId);
  return new Response(null, { status: 204 });
}

export function handleListNodes(
  db: Database,
  nsId: number,
  namespace: string,
): Response {
  const nodes = db
    .query("SELECT * FROM nodes WHERE ns_id = ? ORDER BY id")
    .all(nsId) as Record<string, unknown>[];

  return Response.json(nodes.map((n) => formatNode(db, nsId, namespace, n)));
}

function formatTtl(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function formatNode(
  db: Database,
  nsId: number,
  namespace: string,
  node: Record<string, unknown>,
) {
  const nodeId = node.id as string;

  const dependsOn = db
    .query("SELECT to_node FROM edges WHERE ns_id = ? AND from_node = ?")
    .all(nsId, nodeId) as { to_node: string }[];

  const dependedOnBy = db
    .query("SELECT from_node FROM edges WHERE ns_id = ? AND to_node = ?")
    .all(nsId, nodeId) as { from_node: string }[];

  const ttl = node.ttl as number | null;
  return {
    id: nodeId,
    namespace,
    state: node.state,
    effective_state: computeEffectiveState(db, nsId, nodeId),
    reason: node.reason ?? null,
    solution: node.solution ?? null,
    label: node.label ?? null,
    depends_on: dependsOn.map((e) => e.to_node),
    depended_on_by: dependedOnBy.map((e) => e.from_node),
    default_state: node.default_state ?? null,
    ttl: ttl ? formatTtl(ttl) : null,
    meta: node.meta ? JSON.parse(node.meta as string) : null,
    state_changed_at: node.state_changed_at,
    updated_at: node.updated_at,
  };
}
