import { describe, test, expect } from "bun:test";
import { createTestDb } from "../../src/db";
import { wouldCreateCycle } from "../../src/graph/cycle";

function setup() {
  const db = createTestDb();
  db.query("INSERT INTO tokens (id, token_hash) VALUES ('tok', 'h')").run();
  db.query("INSERT INTO namespaces (id, token_id) VALUES ('ns', 'tok')").run();
  return db;
}

function addNode(db: ReturnType<typeof createTestDb>, id: string) {
  db.query(
    "INSERT INTO nodes (namespace, id, state) VALUES ('ns', ?, 'green')"
  ).run(id);
}

function addEdge(
  db: ReturnType<typeof createTestDb>,
  from: string,
  to: string
) {
  db.query(
    "INSERT INTO edges (namespace, from_node, to_node) VALUES ('ns', ?, ?)"
  ).run(from, to);
}

describe("cycle detection", () => {
  test("self-loop is a cycle", () => {
    const db = setup();
    addNode(db, "a");
    expect(wouldCreateCycle(db, "ns", "a", "a")).toBe(true);
    db.close();
  });

  test("direct cycle: a->b, b->a", () => {
    const db = setup();
    addNode(db, "a");
    addNode(db, "b");
    addEdge(db, "a", "b");
    expect(wouldCreateCycle(db, "ns", "b", "a")).toBe(true);
    db.close();
  });

  test("transitive cycle: a->b, b->c, c->a", () => {
    const db = setup();
    addNode(db, "a");
    addNode(db, "b");
    addNode(db, "c");
    addEdge(db, "a", "b");
    addEdge(db, "b", "c");
    expect(wouldCreateCycle(db, "ns", "c", "a")).toBe(true);
    db.close();
  });

  test("valid DAG: diamond shape", () => {
    const db = setup();
    addNode(db, "a");
    addNode(db, "b");
    addNode(db, "c");
    addNode(db, "d");
    addEdge(db, "a", "b");
    addEdge(db, "a", "c");
    addEdge(db, "b", "d");
    // Adding c->d should be fine (diamond)
    expect(wouldCreateCycle(db, "ns", "c", "d")).toBe(false);
    db.close();
  });

  test("no cycle for unrelated nodes", () => {
    const db = setup();
    addNode(db, "a");
    addNode(db, "b");
    addNode(db, "c");
    addEdge(db, "a", "b");
    expect(wouldCreateCycle(db, "ns", "c", "a")).toBe(false);
    db.close();
  });

  test("no false positive: a->b, adding c->b", () => {
    const db = setup();
    addNode(db, "a");
    addNode(db, "b");
    addNode(db, "c");
    addEdge(db, "a", "b");
    expect(wouldCreateCycle(db, "ns", "c", "b")).toBe(false);
    db.close();
  });
});
