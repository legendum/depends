import type { Database } from "bun:sqlite";

const STATE_PRIORITY: Record<string, number> = {
  green: 0,
  yellow: 1,
  red: 2,
};

function worstState(a: string, b: string): string {
  return STATE_PRIORITY[a] >= STATE_PRIORITY[b] ? a : b;
}

function resolveNodeState(node: {
  state: string;
  ttl: number | null;
  last_state_write: string | null;
}): string {
  if (!node.ttl || !node.last_state_write) return node.state;
  if (node.state !== "green") return node.state;

  const lastWrite = new Date(`${node.last_state_write}Z`).getTime();
  const now = Date.now();
  const elapsed = (now - lastWrite) / 1000;

  if (elapsed > node.ttl) return "yellow";
  return node.state;
}

export function computeEffectiveState(
  db: Database,
  nsId: number,
  nodeId: string,
): string {
  const node = db
    .query(
      "SELECT state, ttl, last_state_write FROM nodes WHERE ns_id = ? AND id = ?",
    )
    .get(nsId, nodeId) as {
    state: string;
    ttl: number | null;
    last_state_write: string | null;
  } | null;

  if (!node) throw new Error(`Node not found: ${nodeId}`);

  let worst = resolveNodeState(node);
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = db
      .query("SELECT to_node FROM edges WHERE ns_id = ? AND from_node = ?")
      .all(nsId, current) as { to_node: string }[];

    for (const dep of deps) {
      const depNode = db
        .query(
          "SELECT state, ttl, last_state_write FROM nodes WHERE ns_id = ? AND id = ?",
        )
        .get(nsId, dep.to_node) as {
        state: string;
        ttl: number | null;
        last_state_write: string | null;
      } | null;

      if (depNode) {
        worst = worstState(worst, resolveNodeState(depNode));
        if (!visited.has(dep.to_node)) {
          queue.push(dep.to_node);
        }
      }
    }
  }

  return worst;
}

export function getDownstreamNodes(
  db: Database,
  nsId: number,
  nodeId: string,
): string[] {
  const downstream: string[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    if (visited.has(current)) continue;
    visited.add(current);

    const dependents = db
      .query("SELECT from_node FROM edges WHERE ns_id = ? AND to_node = ?")
      .all(nsId, current) as { from_node: string }[];

    for (const dep of dependents) {
      if (!visited.has(dep.from_node)) {
        downstream.push(dep.from_node);
        queue.push(dep.from_node);
      }
    }
  }

  return downstream;
}

export function getUpstreamNodes(
  db: Database,
  nsId: number,
  nodeId: string,
): string[] {
  const upstream: string[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = db
      .query("SELECT to_node FROM edges WHERE ns_id = ? AND from_node = ?")
      .all(nsId, current) as { to_node: string }[];

    for (const dep of deps) {
      if (!visited.has(dep.to_node)) {
        upstream.push(dep.to_node);
        queue.push(dep.to_node);
      }
    }
  }

  return upstream;
}
