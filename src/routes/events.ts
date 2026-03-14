import { Database } from "bun:sqlite";

export function handleGetEvents(
  db: Database,
  namespace: string,
  nodeId: string | null,
  url: URL
): Response {
  const since = url.searchParams.get("since");
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "100", 10) || 100, 1), 1000);

  let query: string;
  const params: unknown[] = [namespace];

  if (nodeId) {
    query = `SELECT * FROM events WHERE namespace = ? AND node_id = ?`;
    params.push(nodeId);
  } else {
    query = `SELECT * FROM events WHERE namespace = ?`;
  }

  if (since) {
    query += ` AND created_at >= ?`;
    params.push(since);
  }

  query += ` ORDER BY id ASC LIMIT ?`;
  params.push(limit);

  const events = db.query(query).all(...params);

  return Response.json({ events });
}
