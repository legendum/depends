import { describe, test, expect } from "bun:test";
import { createTestDb } from "../src/db";
import { computeEffectiveState } from "../src/graph/effective";

function setup() {
  const db = createTestDb();
  const { lastInsertRowid: tokenId } = db.query("INSERT INTO tokens (token_hash) VALUES ('h')").run();
  const { lastInsertRowid } = db.query("INSERT INTO namespaces (id, token_id) VALUES ('ns', ?)").run(tokenId);
  const nsId = Number(lastInsertRowid);
  return { db, nsId };
}

describe("TTL", () => {
  test("node without TTL: effective state is own state", () => {
    const { db, nsId } = setup();
    db.query(
      "INSERT INTO nodes (ns_id, id, state, ttl, last_state_write) VALUES (?, 'a', 'green', NULL, datetime('now'))"
    ).run(nsId);
    expect(computeEffectiveState(db, nsId, "a")).toBe("green");
    db.close();
  });

  test("node with TTL and recent write: stays green", () => {
    const { db, nsId } = setup();
    db.query(
      "INSERT INTO nodes (ns_id, id, state, ttl, last_state_write) VALUES (?, 'a', 'green', 600, datetime('now'))"
    ).run(nsId);
    expect(computeEffectiveState(db, nsId, "a")).toBe("green");
    db.close();
  });

  test("node with TTL and expired write: degrades to yellow", () => {
    const { db, nsId } = setup();
    // last_state_write was 20 minutes ago, TTL is 10 minutes (600s)
    db.query(
      "INSERT INTO nodes (ns_id, id, state, ttl, last_state_write) VALUES (?, 'a', 'green', 600, datetime('now', '-20 minutes'))"
    ).run(nsId);
    expect(computeEffectiveState(db, nsId, "a")).toBe("yellow");
    db.close();
  });

  test("TTL expiry never degrades to red", () => {
    const { db, nsId } = setup();
    // Even with a very old write, TTL only goes to yellow
    db.query(
      "INSERT INTO nodes (ns_id, id, state, ttl, last_state_write) VALUES (?, 'a', 'green', 60, datetime('now', '-1 day'))"
    ).run(nsId);
    expect(computeEffectiveState(db, nsId, "a")).toBe("yellow");
    db.close();
  });

  test("TTL only affects green nodes: red stays red", () => {
    const { db, nsId } = setup();
    db.query(
      "INSERT INTO nodes (ns_id, id, state, ttl, last_state_write) VALUES (?, 'a', 'red', 600, datetime('now'))"
    ).run(nsId);
    expect(computeEffectiveState(db, nsId, "a")).toBe("red");
    db.close();
  });

  test("TTL only affects green nodes: yellow stays yellow", () => {
    const { db, nsId } = setup();
    db.query(
      "INSERT INTO nodes (ns_id, id, state, ttl, last_state_write) VALUES (?, 'a', 'yellow', 600, datetime('now'))"
    ).run(nsId);
    expect(computeEffectiveState(db, nsId, "a")).toBe("yellow");
    db.close();
  });

  test("TTL expiry on dependency propagates to parent", () => {
    const { db, nsId } = setup();
    // a depends on b, b has expired TTL
    db.query(
      "INSERT INTO nodes (ns_id, id, state, ttl, last_state_write) VALUES (?, 'b', 'green', 600, datetime('now', '-20 minutes'))"
    ).run(nsId);
    db.query(
      "INSERT INTO nodes (ns_id, id, state) VALUES (?, 'a', 'green')"
    ).run(nsId);
    db.query(
      "INSERT INTO edges (ns_id, from_node, to_node) VALUES (?, 'a', 'b')"
    ).run(nsId);
    // b is effectively yellow (expired), so a should be yellow too
    expect(computeEffectiveState(db, nsId, "a")).toBe("yellow");
    db.close();
  });

  test("node with no last_state_write: TTL has no effect", () => {
    const { db, nsId } = setup();
    db.query(
      "INSERT INTO nodes (ns_id, id, state, ttl, last_state_write) VALUES (?, 'a', 'green', 600, NULL)"
    ).run(nsId);
    expect(computeEffectiveState(db, nsId, "a")).toBe("green");
    db.close();
  });
});
