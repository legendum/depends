import { describe, test, expect } from "bun:test";
import { createTestDb } from "../../src/db";
import { wouldCreateCycle } from "../../src/graph/cycle";

function setup() {
  const db = createTestDb();
  const { lastInsertRowid: tokenId } = db.query("INSERT INTO tokens (token_hash) VALUES ('h')").run();
  const { lastInsertRowid } = db.query("INSERT INTO namespaces (id, token_id) VALUES ('ns', ?)").run(tokenId);
  const nsId = Number(lastInsertRowid);
  return { db, nsId };
}

function addNode(db: ReturnType<typeof createTestDb>, nsId: number, id: string) {
  db.query(
    "INSERT INTO nodes (ns_id, id, state) VALUES (?, ?, 'green')"
  ).run(nsId, id);
}

function addEdge(
  db: ReturnType<typeof createTestDb>,
  nsId: number,
  from: string,
  to: string
) {
  db.query(
    "INSERT INTO edges (ns_id, from_node, to_node) VALUES (?, ?, ?)"
  ).run(nsId, from, to);
}

describe("cycle detection", () => {
  test("self-loop is a cycle", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    expect(wouldCreateCycle(db, nsId, "a", "a")).toBe(true);
    db.close();
  });

  test("direct cycle: a->b, b->a", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    addNode(db, nsId, "b");
    addEdge(db, nsId, "a", "b");
    expect(wouldCreateCycle(db, nsId, "b", "a")).toBe(true);
    db.close();
  });

  test("transitive cycle: a->b, b->c, c->a", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    addNode(db, nsId, "b");
    addNode(db, nsId, "c");
    addEdge(db, nsId, "a", "b");
    addEdge(db, nsId, "b", "c");
    expect(wouldCreateCycle(db, nsId, "c", "a")).toBe(true);
    db.close();
  });

  test("valid DAG: diamond shape", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    addNode(db, nsId, "b");
    addNode(db, nsId, "c");
    addNode(db, nsId, "d");
    addEdge(db, nsId, "a", "b");
    addEdge(db, nsId, "a", "c");
    addEdge(db, nsId, "b", "d");
    // Adding c->d should be fine (diamond)
    expect(wouldCreateCycle(db, nsId, "c", "d")).toBe(false);
    db.close();
  });

  test("no cycle for unrelated nodes", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    addNode(db, nsId, "b");
    addNode(db, nsId, "c");
    addEdge(db, nsId, "a", "b");
    expect(wouldCreateCycle(db, nsId, "c", "a")).toBe(false);
    db.close();
  });

  test("no false positive: a->b, adding c->b", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    addNode(db, nsId, "b");
    addNode(db, nsId, "c");
    addEdge(db, nsId, "a", "b");
    expect(wouldCreateCycle(db, nsId, "c", "b")).toBe(false);
    db.close();
  });
});
