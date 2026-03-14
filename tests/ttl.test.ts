import { describe, test, expect } from "bun:test";
import { createTestDb } from "../src/db";
import { computeEffectiveState } from "../src/graph/effective";

function setup() {
  const db = createTestDb();
  db.query("INSERT INTO namespaces (id, token_hash) VALUES ('ns', 'h')").run();
  return db;
}

describe("TTL", () => {
  test("node without TTL: effective state is own state", () => {
    const db = setup();
    db.query(
      "INSERT INTO nodes (namespace, id, state, ttl, last_state_write) VALUES ('ns', 'a', 'green', NULL, datetime('now'))"
    ).run();
    expect(computeEffectiveState(db, "ns", "a")).toBe("green");
    db.close();
  });

  test("node with TTL and recent write: stays green", () => {
    const db = setup();
    db.query(
      "INSERT INTO nodes (namespace, id, state, ttl, last_state_write) VALUES ('ns', 'a', 'green', 600, datetime('now'))"
    ).run();
    expect(computeEffectiveState(db, "ns", "a")).toBe("green");
    db.close();
  });

  test("node with TTL and expired write: degrades to yellow", () => {
    const db = setup();
    // last_state_write was 20 minutes ago, TTL is 10 minutes (600s)
    db.query(
      "INSERT INTO nodes (namespace, id, state, ttl, last_state_write) VALUES ('ns', 'a', 'green', 600, datetime('now', '-20 minutes'))"
    ).run();
    expect(computeEffectiveState(db, "ns", "a")).toBe("yellow");
    db.close();
  });

  test("TTL expiry never degrades to red", () => {
    const db = setup();
    // Even with a very old write, TTL only goes to yellow
    db.query(
      "INSERT INTO nodes (namespace, id, state, ttl, last_state_write) VALUES ('ns', 'a', 'green', 60, datetime('now', '-1 day'))"
    ).run();
    expect(computeEffectiveState(db, "ns", "a")).toBe("yellow");
    db.close();
  });

  test("TTL only affects green nodes: red stays red", () => {
    const db = setup();
    db.query(
      "INSERT INTO nodes (namespace, id, state, ttl, last_state_write) VALUES ('ns', 'a', 'red', 600, datetime('now'))"
    ).run();
    expect(computeEffectiveState(db, "ns", "a")).toBe("red");
    db.close();
  });

  test("TTL only affects green nodes: yellow stays yellow", () => {
    const db = setup();
    db.query(
      "INSERT INTO nodes (namespace, id, state, ttl, last_state_write) VALUES ('ns', 'a', 'yellow', 600, datetime('now'))"
    ).run();
    expect(computeEffectiveState(db, "ns", "a")).toBe("yellow");
    db.close();
  });

  test("TTL expiry on dependency propagates to parent", () => {
    const db = setup();
    // a depends on b, b has expired TTL
    db.query(
      "INSERT INTO nodes (namespace, id, state, ttl, last_state_write) VALUES ('ns', 'b', 'green', 600, datetime('now', '-20 minutes'))"
    ).run();
    db.query(
      "INSERT INTO nodes (namespace, id, state) VALUES ('ns', 'a', 'green')"
    ).run();
    db.query(
      "INSERT INTO edges (namespace, from_node, to_node) VALUES ('ns', 'a', 'b')"
    ).run();
    // b is effectively yellow (expired), so a should be yellow too
    expect(computeEffectiveState(db, "ns", "a")).toBe("yellow");
    db.close();
  });

  test("node with no last_state_write: TTL has no effect", () => {
    const db = setup();
    db.query(
      "INSERT INTO nodes (namespace, id, state, ttl, last_state_write) VALUES ('ns', 'a', 'green', 600, NULL)"
    ).run();
    expect(computeEffectiveState(db, "ns", "a")).toBe("green");
    db.close();
  });
});
