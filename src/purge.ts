import { Database } from "bun:sqlite";
import { PLAN_LIMITS } from "./db";

export function purgeExpiredEvents(db: Database): number {
  let total = 0;

  const namespaces = db
    .query(
      `SELECT n.ns_id, t.plan FROM namespaces n
       JOIN tokens t ON t.id = n.token_id`
    )
    .all() as { ns_id: number; plan: string }[];

  for (const { ns_id, plan } of namespaces) {
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const cutoff = new Date(
      Date.now() - limits.eventRetentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = db
      .query("DELETE FROM events WHERE ns_id = ? AND created_at < ?")
      .run(ns_id, cutoff);

    total += result.changes;
  }

  return total;
}
