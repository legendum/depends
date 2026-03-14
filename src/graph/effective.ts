import { Database } from "bun:sqlite";

const STATE_PRIORITY: Record<string, number> = {
  green: 0,
  yellow: 1,
  red: 2,
};

function worstState(a: string, b: string): string {
  return STATE_PRIORITY[a] >= STATE_PRIORITY[b] ? a : b;
}

/**
 * Compute the effective state of a node by traversing all transitive dependencies.
 * Effective state = worst of (own state, all dependency states).
 */
export function computeEffectiveState(
  db: Database,
  namespace: string,
  nodeId: string
): string {
  const node = db
    .query("SELECT state FROM nodes WHERE namespace = ? AND id = ?")
    .get(namespace, nodeId) as { state: string } | null;

  if (!node) throw new Error(`Node not found: ${namespace}/${nodeId}`);

  let worst = node.state;
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    // Get all dependencies (edges where current depends on to_node)
    const deps = db
      .query("SELECT to_node FROM edges WHERE namespace = ? AND from_node = ?")
      .all(namespace, current) as { to_node: string }[];

    for (const dep of deps) {
      const depNode = db
        .query("SELECT state FROM nodes WHERE namespace = ? AND id = ?")
        .get(namespace, dep.to_node) as { state: string } | null;

      if (depNode) {
        worst = worstState(worst, depNode.state);
        if (!visited.has(dep.to_node)) {
          queue.push(dep.to_node);
        }
      }
    }
  }

  return worst;
}

/**
 * Get all nodes downstream of a given node (nodes that transitively depend on it).
 */
export function getDownstreamNodes(
  db: Database,
  namespace: string,
  nodeId: string
): string[] {
  const downstream: string[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    // Find nodes that depend on current (edges where to_node = current)
    const dependents = db
      .query(
        "SELECT from_node FROM edges WHERE namespace = ? AND to_node = ?"
      )
      .all(namespace, current) as { from_node: string }[];

    for (const dep of dependents) {
      if (!visited.has(dep.from_node)) {
        downstream.push(dep.from_node);
        queue.push(dep.from_node);
      }
    }
  }

  return downstream;
}

/**
 * Get all nodes upstream of a given node (transitive dependencies).
 */
export function getUpstreamNodes(
  db: Database,
  namespace: string,
  nodeId: string
): string[] {
  const upstream: string[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = db
      .query("SELECT to_node FROM edges WHERE namespace = ? AND from_node = ?")
      .all(namespace, current) as { to_node: string }[];

    for (const dep of deps) {
      if (!visited.has(dep.to_node)) {
        upstream.push(dep.to_node);
        queue.push(dep.to_node);
      }
    }
  }

  return upstream;
}
