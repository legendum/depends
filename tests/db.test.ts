import { describe, test, expect } from "bun:test";
import { createTestDb } from "../src/db";

function insertNs(db: ReturnType<typeof createTestDb>, nsId: string = "test"): number {
  const { lastInsertRowid: tokenId } = db.query("INSERT INTO tokens (token_hash) VALUES ('hash')").run();
  const { lastInsertRowid } = db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run(nsId, tokenId);
  return Number(lastInsertRowid);
}

describe("database", () => {
  test("creates all tables", () => {
    const db = createTestDb();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("tokens");
    expect(names).toContain("namespaces");
    expect(names).toContain("nodes");
    expect(names).toContain("edges");
    expect(names).toContain("notification_rules");
    expect(names).toContain("events");
    db.close();
  });

  test("enables foreign keys", () => {
    const db = createTestDb();
    const result = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(result.foreign_keys).toBe(1);
    db.close();
  });

  test("enforces foreign key on nodes -> namespaces", () => {
    const db = createTestDb();
    expect(() => {
      db.query("INSERT INTO nodes (ns_id, id, state) VALUES (9999, 'n1', 'green')").run();
    }).toThrow();
    db.close();
  });

  test("cascades deletes from namespace to nodes", () => {
    const db = createTestDb();
    const nsId = insertNs(db);
    db.query("INSERT INTO nodes (ns_id, id, state) VALUES (?, 'n1', 'green')").run(nsId);

    db.query("DELETE FROM namespaces WHERE ns_id = ?").run(nsId);

    const nodes = db.query("SELECT * FROM nodes WHERE ns_id = ?").all(nsId);
    expect(nodes).toHaveLength(0);
    db.close();
  });

  test("cascades deletes from namespace to edges", () => {
    const db = createTestDb();
    const nsId = insertNs(db);
    db.query("INSERT INTO nodes (ns_id, id, state) VALUES (?, 'a', 'green')").run(nsId);
    db.query("INSERT INTO nodes (ns_id, id, state) VALUES (?, 'b', 'green')").run(nsId);
    db.query("INSERT INTO edges (ns_id, from_node, to_node) VALUES (?, 'a', 'b')").run(nsId);

    db.query("DELETE FROM namespaces WHERE ns_id = ?").run(nsId);

    const edges = db.query("SELECT * FROM edges WHERE ns_id = ?").all(nsId);
    expect(edges).toHaveLength(0);
    db.close();
  });

  test("enforces state check constraint", () => {
    const db = createTestDb();
    const nsId = insertNs(db);
    expect(() => {
      db.query("INSERT INTO nodes (ns_id, id, state) VALUES (?, 'n1', 'invalid')").run(nsId);
    }).toThrow();
    db.close();
  });

  test("enforces notification rule must have url or email", () => {
    const db = createTestDb();
    const nsId = insertNs(db);
    expect(() => {
      db.query(
        `INSERT INTO notification_rules (ns_id, id, on_state) VALUES (?, 'r1', 'red')`
      ).run(nsId);
    }).toThrow();
    db.close();
  });

  test("allows notification rule with both url and email", () => {
    const db = createTestDb();
    const nsId = insertNs(db);
    db.query(
      `INSERT INTO notification_rules (ns_id, id, on_state, url, email) VALUES (?, 'r1', 'red', 'https://example.com', 'a@b.com')`
    ).run(nsId);
    const rule = db.query("SELECT * FROM notification_rules WHERE ns_id = ? AND id = 'r1'").get(nsId) as Record<string, unknown>;
    expect(rule.url).toBe("https://example.com");
    expect(rule.email).toBe("a@b.com");
    db.close();
  });

  test("allows same namespace name for different tokens", () => {
    const db = createTestDb();
    const { lastInsertRowid: tok1 } = db.query("INSERT INTO tokens (token_hash) VALUES ('h1')").run();
    const { lastInsertRowid: tok2 } = db.query("INSERT INTO tokens (token_hash) VALUES ('h2')").run();
    db.query("INSERT INTO namespaces (id, token_id) VALUES ('api', ?)").run(tok1);
    db.query("INSERT INTO namespaces (id, token_id) VALUES ('api', ?)").run(tok2);

    const count = db.query("SELECT COUNT(*) as c FROM namespaces WHERE id = 'api'").get() as { c: number };
    expect(count.c).toBe(2);
    db.close();
  });

  test("prevents duplicate namespace name for same token", () => {
    const db = createTestDb();
    const { lastInsertRowid: tok } = db.query("INSERT INTO tokens (token_hash) VALUES ('h1')").run();
    db.query("INSERT INTO namespaces (id, token_id) VALUES ('api', ?)").run(tok);
    expect(() => {
      db.query("INSERT INTO namespaces (id, token_id) VALUES ('api', ?)").run(tok);
    }).toThrow();
    db.close();
  });
});
