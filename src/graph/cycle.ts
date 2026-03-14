import { Database } from "bun:sqlite";

/**
 * Check if adding an edge from_node -> to_node would create a cycle.
 * A cycle exists if to_node can already reach from_node via existing edges.
 */
export function wouldCreateCycle(
  db: Database,
  namespace: string,
  fromNode: string,
  toNode: string
): boolean {
  if (fromNode === toNode) return true;

  // BFS from toNode following edges (to_node -> from_node direction means
  // "what depends on toNode"). But we need to check if fromNode is reachable
  // from toNode via the *depends_on* direction (from_node -> to_node).
  // An edge from_node -> to_node means "from_node depends on to_node".
  // A cycle means: toNode can reach fromNode by following depends_on edges.
  // i.e., there's a path toNode -> ... -> fromNode via existing from_node->to_node edges.
  const visited = new Set<string>();
  const queue = [toNode];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === fromNode) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const rows = db
      .query("SELECT to_node FROM edges WHERE namespace = ? AND from_node = ?")
      .all(namespace, current) as { to_node: string }[];

    for (const row of rows) {
      if (!visited.has(row.to_node)) {
        queue.push(row.to_node);
      }
    }
  }

  return false;
}
