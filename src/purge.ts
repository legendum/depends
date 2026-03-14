import { Database } from "bun:sqlite";
import { PLAN_LIMITS } from "./db";

/**
 * Purge events older than the retention period for each namespace's plan.
 */
export function purgeExpiredEvents(db: Database): number {
  let total = 0;

  const namespaces = db
    .query(
      `SELECT n.id as namespace, t.plan FROM namespaces n
       JOIN tokens t ON t.id = n.token_id`
    )
    .all() as { namespace: string; plan: string }[];

  for (const { namespace, plan } of namespaces) {
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const cutoff = new Date(
      Date.now() - limits.eventRetentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = db
      .query("DELETE FROM events WHERE namespace = ? AND created_at < ?")
      .run(namespace, cutoff);

    total += result.changes;
  }

  return total;
}
