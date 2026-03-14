import { describe, test, expect, beforeEach } from "bun:test";
import { createTestDb } from "../src/db";
import { purgeExpiredEvents } from "../src/purge";
import type { Database } from "bun:sqlite";

let db: Database;

function setup() {
  db = createTestDb();
  db.query("INSERT INTO tokens (id, token_hash, plan) VALUES ('tok', 'h', 'free')").run();
  db.query("INSERT INTO namespaces (id, token_id) VALUES ('ns', 'tok')").run();
  db.query("INSERT INTO nodes (namespace, id, state) VALUES ('ns', 'a', 'green')").run();
}

function addEvent(daysAgo: number) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  db.query(
    "INSERT INTO events (namespace, node_id, new_state, new_effective_state, created_at) VALUES ('ns', 'a', 'red', 'red', ?)"
  ).run(date);
}

function eventCount(): number {
  return (db.query("SELECT COUNT(*) as c FROM events").get() as { c: number }).c;
}

describe("purge expired events", () => {
  beforeEach(() => setup());

  test("purges events older than 7 days on free plan", () => {
    addEvent(8); // 8 days ago — should be purged
    addEvent(3); // 3 days ago — should be kept

    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(1);
    expect(eventCount()).toBe(1);
  });

  test("keeps events within retention period", () => {
    addEvent(1);
    addEvent(5);
    addEvent(6);

    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(0);
    expect(eventCount()).toBe(3);
  });

  test("pro plan retains 30 days", () => {
    db.query("UPDATE tokens SET plan = 'pro' WHERE id = 'tok'").run();

    addEvent(25); // 25 days ago — kept on pro
    addEvent(31); // 31 days ago — purged on pro

    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(1);
    expect(eventCount()).toBe(1);
  });

  test("purges nothing when no events", () => {
    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(0);
  });
});
