import { describe, test, expect } from "bun:test";
import { createTestDb } from "../../src/db";
import {
  computeEffectiveState,
  getDownstreamNodes,
  getUpstreamNodes,
} from "../../src/graph/effective";

function setup() {
  const db = createTestDb();
  db.query("INSERT INTO tokens (id, token_hash) VALUES ('tok', 'h')").run();
  db.query("INSERT INTO namespaces (id, token_id) VALUES ('ns', 'tok')").run();
  return db;
}

function addNode(
  db: ReturnType<typeof createTestDb>,
  id: string,
  state: string = "green"
) {
  db.query(
    "INSERT INTO nodes (namespace, id, state) VALUES ('ns', ?, ?)"
  ).run(id, state);
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

describe("effective state", () => {
  test("node with no dependencies = own state", () => {
    const db = setup();
    addNode(db, "a", "green");
    expect(computeEffectiveState(db, "ns", "a")).toBe("green");
    db.close();
  });

  test("node with green dependency = own state", () => {
    const db = setup();
    addNode(db, "a", "green");
    addNode(db, "b", "green");
    addEdge(db, "a", "b");
    expect(computeEffectiveState(db, "ns", "a")).toBe("green");
    db.close();
  });

  test("node depends on red = red", () => {
    const db = setup();
    addNode(db, "a", "green");
    addNode(db, "b", "red");
    addEdge(db, "a", "b");
    expect(computeEffectiveState(db, "ns", "a")).toBe("red");
    db.close();
  });

  test("node depends on yellow, own green = yellow", () => {
    const db = setup();
    addNode(db, "a", "green");
    addNode(db, "b", "yellow");
    addEdge(db, "a", "b");
    expect(computeEffectiveState(db, "ns", "a")).toBe("yellow");
    db.close();
  });

  test("own state is red, dependency green = red", () => {
    const db = setup();
    addNode(db, "a", "red");
    addNode(db, "b", "green");
    addEdge(db, "a", "b");
    expect(computeEffectiveState(db, "ns", "a")).toBe("red");
    db.close();
  });

  test("transitive: a->b->c, c is red", () => {
    const db = setup();
    addNode(db, "a", "green");
    addNode(db, "b", "green");
    addNode(db, "c", "red");
    addEdge(db, "a", "b");
    addEdge(db, "b", "c");
    expect(computeEffectiveState(db, "ns", "a")).toBe("red");
    db.close();
  });

  test("diamond: worst propagates", () => {
    const db = setup();
    addNode(db, "a", "green");
    addNode(db, "b", "green");
    addNode(db, "c", "yellow");
    addNode(db, "d", "red");
    addEdge(db, "a", "b");
    addEdge(db, "a", "c");
    addEdge(db, "b", "d");
    addEdge(db, "c", "d");
    expect(computeEffectiveState(db, "ns", "a")).toBe("red");
    db.close();
  });

  test("multiple deps: worst wins", () => {
    const db = setup();
    addNode(db, "a", "green");
    addNode(db, "b", "green");
    addNode(db, "c", "yellow");
    addEdge(db, "a", "b");
    addEdge(db, "a", "c");
    expect(computeEffectiveState(db, "ns", "a")).toBe("yellow");
    db.close();
  });

  test("throws for non-existent node", () => {
    const db = setup();
    expect(() => computeEffectiveState(db, "ns", "nope")).toThrow();
    db.close();
  });
});

describe("downstream nodes", () => {
  test("returns direct dependents", () => {
    const db = setup();
    addNode(db, "a");
    addNode(db, "b");
    addEdge(db, "b", "a"); // b depends on a
    expect(getDownstreamNodes(db, "ns", "a")).toEqual(["b"]);
    db.close();
  });

  test("returns transitive dependents", () => {
    const db = setup();
    addNode(db, "a");
    addNode(db, "b");
    addNode(db, "c");
    addEdge(db, "b", "a");
    addEdge(db, "c", "b");
    const result = getDownstreamNodes(db, "ns", "a").sort();
    expect(result).toEqual(["b", "c"]);
    db.close();
  });

  test("returns empty for leaf node", () => {
    const db = setup();
    addNode(db, "a");
    addNode(db, "b");
    addEdge(db, "a", "b");
    expect(getDownstreamNodes(db, "ns", "b")).toEqual(["a"]);
    expect(getDownstreamNodes(db, "ns", "a")).toEqual([]);
    db.close();
  });
});

describe("upstream nodes", () => {
  test("returns transitive dependencies", () => {
    const db = setup();
    addNode(db, "a");
    addNode(db, "b");
    addNode(db, "c");
    addEdge(db, "a", "b");
    addEdge(db, "b", "c");
    const result = getUpstreamNodes(db, "ns", "a").sort();
    expect(result).toEqual(["b", "c"]);
    db.close();
  });
});
