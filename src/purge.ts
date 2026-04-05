import type { Database } from "bun:sqlite";

const EVENT_RETENTION_DAYS = 30;

export function purgeExpiredEvents(db: Database): number {
  const cutoff = new Date(
    Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result = db
    .query("DELETE FROM events WHERE created_at < ?")
    .run(cutoff);

  return result.changes;
}
