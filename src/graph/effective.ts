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
 * Resolve a node's own state, accounting for TTL expiry.
 * If the node has a TTL and the last state write is older than TTL,
 * the state is degraded to yellow (but never to red — TTL expiry means
 * "we haven't heard from it", not "it told us it's broken").
 */
function resolveNodeState(node: {
  state: string;
  ttl: number | null;
  last_state_write: string | null;
}): string {
  if (!node.ttl || !node.last_state_write) return node.state;
  if (node.state !== "green") return node.state; // only degrade green -> yellow

  const lastWrite = new Date(node.last_state_write + "Z").getTime();
  const now = Date.now();
  const elapsed = (now - lastWrite) / 1000;

  if (elapsed > node.ttl) return "yellow";
  return node.state;
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
    .query("SELECT state, ttl, last_state_write FROM nodes WHERE namespace = ? AND id = ?")
    .get(namespace, nodeId) as { state: string; ttl: number | null; last_state_write: string | null } | null;

  if (!node) throw new Error(`Node not found: ${namespace}/${nodeId}`);

  let worst = resolveNodeState(node);
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
        .query("SELECT state, ttl, last_state_write FROM nodes WHERE namespace = ? AND id = ?")
        .get(namespace, dep.to_node) as { state: string; ttl: number | null; last_state_write: string | null } | null;

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
