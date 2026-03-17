import { Database } from "bun:sqlite";

export function handleGetEvents(
  db: Database,
  nsId: number,
  nodeId: string | null,
  url: URL
): Response {
  const since = url.searchParams.get("since");
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "100", 10) || 100, 1), 1000);

  let query: string;
  const params: unknown[] = [nsId];

  if (nodeId) {
    query = `SELECT * FROM events WHERE ns_id = ? AND node_id = ?`;
    params.push(nodeId);
  } else {
    query = `SELECT * FROM events WHERE ns_id = ?`;
  }

  if (since) {
    query += ` AND created_at >= ?`;
    params.push(since);
  }

  const order = url.searchParams.get("order") === "desc" ? "DESC" : "ASC";
  query += ` ORDER BY id ${order} LIMIT ?`;
  params.push(limit);

  const events = db.query(query).all(...params);

  return Response.json({ events });
}
