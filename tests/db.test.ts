import { describe, test, expect } from "bun:test";
import { createTestDb } from "../src/db";

describe("database", () => {
  test("creates all tables", () => {
    const db = createTestDb();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("namespaces");
    expect(names).toContain("nodes");
    expect(names).toContain("edges");
    expect(names).toContain("notification_rules");
    expect(names).toContain("events");
    db.close();
  });

  test("enables foreign keys", () => {
    const db = createTestDb();
    const result = db.query("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    expect(result.foreign_keys).toBe(1);
    db.close();
  });

  test("enforces foreign key on nodes -> namespaces", () => {
    const db = createTestDb();
    expect(() => {
      db.query(
        "INSERT INTO nodes (namespace, id, state) VALUES ('nonexistent', 'n1', 'green')"
      ).run();
    }).toThrow();
    db.close();
  });

  test("cascades deletes from namespace to nodes", () => {
    const db = createTestDb();
    db.query(
      "INSERT INTO namespaces (id, token_hash) VALUES ('test', 'hash')"
    ).run();
    db.query(
      "INSERT INTO nodes (namespace, id, state) VALUES ('test', 'n1', 'green')"
    ).run();

    db.query("DELETE FROM namespaces WHERE id = 'test'").run();

    const nodes = db.query("SELECT * FROM nodes WHERE namespace = 'test'").all();
    expect(nodes).toHaveLength(0);
    db.close();
  });

  test("cascades deletes from namespace to edges", () => {
    const db = createTestDb();
    db.query(
      "INSERT INTO namespaces (id, token_hash) VALUES ('test', 'hash')"
    ).run();
    db.query(
      "INSERT INTO nodes (namespace, id, state) VALUES ('test', 'a', 'green')"
    ).run();
    db.query(
      "INSERT INTO nodes (namespace, id, state) VALUES ('test', 'b', 'green')"
    ).run();
    db.query(
      "INSERT INTO edges (namespace, from_node, to_node) VALUES ('test', 'a', 'b')"
    ).run();

    db.query("DELETE FROM namespaces WHERE id = 'test'").run();

    const edges = db.query("SELECT * FROM edges WHERE namespace = 'test'").all();
    expect(edges).toHaveLength(0);
    db.close();
  });

  test("enforces state check constraint", () => {
    const db = createTestDb();
    db.query(
      "INSERT INTO namespaces (id, token_hash) VALUES ('test', 'hash')"
    ).run();
    expect(() => {
      db.query(
        "INSERT INTO nodes (namespace, id, state) VALUES ('test', 'n1', 'invalid')"
      ).run();
    }).toThrow();
    db.close();
  });

  test("enforces notification rule must have url or email", () => {
    const db = createTestDb();
    db.query(
      "INSERT INTO namespaces (id, token_hash) VALUES ('test', 'hash')"
    ).run();
    expect(() => {
      db.query(
        `INSERT INTO notification_rules (namespace, id, on_state)
         VALUES ('test', 'r1', 'red')`
      ).run();
    }).toThrow();
    db.close();
  });

  test("enforces notification rule cannot have both url and email", () => {
    const db = createTestDb();
    db.query(
      "INSERT INTO namespaces (id, token_hash) VALUES ('test', 'hash')"
    ).run();
    expect(() => {
      db.query(
        `INSERT INTO notification_rules (namespace, id, on_state, url, email)
         VALUES ('test', 'r1', 'red', 'https://example.com', 'a@b.com')`
      ).run();
    }).toThrow();
    db.close();
  });
});
