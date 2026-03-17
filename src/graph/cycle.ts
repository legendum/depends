import { Database } from "bun:sqlite";

export function wouldCreateCycle(
  db: Database,
  nsId: number,
  fromNode: string,
  toNode: string
): boolean {
  if (fromNode === toNode) return true;

  const visited = new Set<string>();
  const queue = [toNode];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === fromNode) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const rows = db
      .query("SELECT to_node FROM edges WHERE ns_id = ? AND from_node = ?")
      .all(nsId, current) as { to_node: string }[];

    for (const row of rows) {
      if (!visited.has(row.to_node)) {
        queue.push(row.to_node);
      }
    }
  }

  return false;
}
