import { describe, test, expect, beforeEach } from "bun:test";
import { createTestDb } from "../src/db";
import { purgeExpiredEvents } from "../src/purge";
import type { Database } from "bun:sqlite";

let db: Database;
let nsId: number;

function setup() {
  db = createTestDb();
  const { lastInsertRowid: tokenId } = db.query("INSERT INTO tokens (token_hash, plan) VALUES ('h', 'free')").run();
  const { lastInsertRowid } = db.query("INSERT INTO namespaces (id, token_id) VALUES ('ns', ?)").run(tokenId);
  nsId = Number(lastInsertRowid);
  db.query("INSERT INTO nodes (ns_id, id, state) VALUES (?, 'a', 'green')").run(nsId);
}

function addEvent(daysAgo: number) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  db.query(
    "INSERT INTO events (ns_id, node_id, new_state, new_effective_state, created_at) VALUES (?, 'a', 'red', 'red', ?)"
  ).run(nsId, date);
}

function eventCount(): number {
  return (db.query("SELECT COUNT(*) as c FROM events WHERE ns_id = ?").get(nsId) as { c: number }).c;
}

describe("purge expired events", () => {
  beforeEach(setup);

  test("purges events older than 7 days on free plan", () => {
    addEvent(1);
    addEvent(8);
    addEvent(10);

    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(2);
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
    db.query("UPDATE tokens SET plan = 'pro' WHERE token_hash = 'h'").run();

    addEvent(25);
    addEvent(31);

    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(1);
    expect(eventCount()).toBe(1);
  });

  test("purges nothing when no events", () => {
    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(0);
  });
});
