import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { createTestDb } from "../src/db";
import { purgeExpiredEvents } from "../src/purge";

let db: Database;
let nsId: number;

function setup() {
  db = createTestDb();
  const { lastInsertRowid: tokenId } = db
    .query("INSERT INTO tokens (token_hash) VALUES ('h')")
    .run();
  const { lastInsertRowid } = db
    .query("INSERT INTO namespaces (id, token_id) VALUES ('ns', ?)")
    .run(tokenId);
  nsId = Number(lastInsertRowid);
  db.query("INSERT INTO nodes (ns_id, id, state) VALUES (?, 'a', 'green')").run(
    nsId,
  );
}

function addEvent(daysAgo: number) {
  const date = new Date(
    Date.now() - daysAgo * 24 * 60 * 60 * 1000,
  ).toISOString();
  db.query(
    "INSERT INTO events (ns_id, node_id, new_state, new_effective_state, created_at) VALUES (?, 'a', 'red', 'red', ?)",
  ).run(nsId, date);
}

function eventCount(): number {
  return (
    db.query("SELECT COUNT(*) as c FROM events WHERE ns_id = ?").get(nsId) as {
      c: number;
    }
  ).c;
}

describe("purge expired events", () => {
  beforeEach(setup);

  test("purges events older than 30 days", () => {
    addEvent(1);
    addEvent(31);
    addEvent(35);

    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(2);
    expect(eventCount()).toBe(1);
  });

  test("keeps events within retention period", () => {
    addEvent(1);
    addEvent(15);
    addEvent(29);

    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(0);
    expect(eventCount()).toBe(3);
  });

  test("purges nothing when no events", () => {
    const purged = purgeExpiredEvents(db);
    expect(purged).toBe(0);
  });
});
