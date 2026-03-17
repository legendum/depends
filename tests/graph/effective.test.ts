import { describe, test, expect } from "bun:test";
import { createTestDb } from "../../src/db";
import {
  computeEffectiveState,
  getDownstreamNodes,
  getUpstreamNodes,
} from "../../src/graph/effective";

function setup() {
  const db = createTestDb();
  const { lastInsertRowid: tokenId } = db.query("INSERT INTO tokens (token_hash) VALUES ('h')").run();
  const { lastInsertRowid } = db.query("INSERT INTO namespaces (id, token_id) VALUES ('ns', ?)").run(tokenId);
  const nsId = Number(lastInsertRowid);
  return { db, nsId };
}

function addNode(
  db: ReturnType<typeof createTestDb>,
  nsId: number,
  id: string,
  state: string = "green"
) {
  db.query(
    "INSERT INTO nodes (ns_id, id, state) VALUES (?, ?, ?)"
  ).run(nsId, id, state);
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

describe("effective state", () => {
  test("node with no dependencies = own state", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a", "green");
    expect(computeEffectiveState(db, nsId, "a")).toBe("green");
    db.close();
  });

  test("node with green dependency = own state", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a", "green");
    addNode(db, nsId, "b", "green");
    addEdge(db, nsId, "a", "b");
    expect(computeEffectiveState(db, nsId, "a")).toBe("green");
    db.close();
  });

  test("node depends on red = red", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a", "green");
    addNode(db, nsId, "b", "red");
    addEdge(db, nsId, "a", "b");
    expect(computeEffectiveState(db, nsId, "a")).toBe("red");
    db.close();
  });

  test("node depends on yellow, own green = yellow", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a", "green");
    addNode(db, nsId, "b", "yellow");
    addEdge(db, nsId, "a", "b");
    expect(computeEffectiveState(db, nsId, "a")).toBe("yellow");
    db.close();
  });

  test("own state is red, dependency green = red", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a", "red");
    addNode(db, nsId, "b", "green");
    addEdge(db, nsId, "a", "b");
    expect(computeEffectiveState(db, nsId, "a")).toBe("red");
    db.close();
  });

  test("transitive: a->b->c, c is red", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a", "green");
    addNode(db, nsId, "b", "green");
    addNode(db, nsId, "c", "red");
    addEdge(db, nsId, "a", "b");
    addEdge(db, nsId, "b", "c");
    expect(computeEffectiveState(db, nsId, "a")).toBe("red");
    db.close();
  });

  test("diamond: worst propagates", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a", "green");
    addNode(db, nsId, "b", "green");
    addNode(db, nsId, "c", "yellow");
    addNode(db, nsId, "d", "red");
    addEdge(db, nsId, "a", "b");
    addEdge(db, nsId, "a", "c");
    addEdge(db, nsId, "b", "d");
    addEdge(db, nsId, "c", "d");
    expect(computeEffectiveState(db, nsId, "a")).toBe("red");
    db.close();
  });

  test("multiple deps: worst wins", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a", "green");
    addNode(db, nsId, "b", "green");
    addNode(db, nsId, "c", "yellow");
    addEdge(db, nsId, "a", "b");
    addEdge(db, nsId, "a", "c");
    expect(computeEffectiveState(db, nsId, "a")).toBe("yellow");
    db.close();
  });

  test("throws for non-existent node", () => {
    const { db, nsId } = setup();
    expect(() => computeEffectiveState(db, nsId, "nope")).toThrow();
    db.close();
  });
});

describe("downstream nodes", () => {
  test("returns direct dependents", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    addNode(db, nsId, "b");
    addEdge(db, nsId, "b", "a"); // b depends on a
    expect(getDownstreamNodes(db, nsId, "a")).toEqual(["b"]);
    db.close();
  });

  test("returns transitive dependents", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    addNode(db, nsId, "b");
    addNode(db, nsId, "c");
    addEdge(db, nsId, "b", "a");
    addEdge(db, nsId, "c", "b");
    const result = getDownstreamNodes(db, nsId, "a").sort();
    expect(result).toEqual(["b", "c"]);
    db.close();
  });

  test("returns empty for leaf node", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    addNode(db, nsId, "b");
    addEdge(db, nsId, "a", "b");
    expect(getDownstreamNodes(db, nsId, "b")).toEqual(["a"]);
    expect(getDownstreamNodes(db, nsId, "a")).toEqual([]);
    db.close();
  });
});

describe("upstream nodes", () => {
  test("returns transitive dependencies", () => {
    const { db, nsId } = setup();
    addNode(db, nsId, "a");
    addNode(db, nsId, "b");
    addNode(db, nsId, "c");
    addEdge(db, nsId, "a", "b");
    addEdge(db, nsId, "b", "c");
    const result = getUpstreamNodes(db, nsId, "a").sort();
    expect(result).toEqual(["b", "c"]);
    db.close();
  });
});
