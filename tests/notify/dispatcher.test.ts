import { describe, test, expect, beforeEach } from "bun:test";
import { createTestDb } from "../../src/db";
import { dispatchNotifications } from "../../src/notify/dispatcher";
import type { Database } from "bun:sqlite";

let db: Database;

function setup() {
  db = createTestDb();
  const { lastInsertRowid } = db.query("INSERT INTO tokens (token_hash) VALUES ('h')").run();
  db.query("INSERT INTO namespaces (id, token_id) VALUES ('ns', ?)").run(lastInsertRowid);
}

function addNode(id: string, state: string = "green") {
  db.query(
    "INSERT INTO nodes (namespace, id, state) VALUES ('ns', ?, ?)"
  ).run(id, state);
}

function addEdge(from: string, to: string) {
  db.query(
    "INSERT INTO edges (namespace, from_node, to_node) VALUES ('ns', ?, ?)"
  ).run(from, to);
}

function addRule(
  id: string,
  opts: {
    watch?: string;
    on?: string;
    ack?: boolean;
  } = {}
) {
  db.query(
    `INSERT INTO notification_rules (namespace, id, watch, on_state, url, ack)
     VALUES ('ns', ?, ?, ?, 'https://example.com/hook', ?)`
  ).run(id, opts.watch ?? "*", opts.on ?? "red", opts.ack ? 1 : 0);
}

function getEvents() {
  return db.query("SELECT * FROM events WHERE namespace = 'ns' ORDER BY id").all() as {
    node_id: string;
    previous_state: string | null;
    new_state: string;
    previous_effective_state: string | null;
    new_effective_state: string;
  }[];
}

describe("dispatcher", () => {
  beforeEach(() => setup());

  test("records event on state change", () => {
    addNode("a", "green");
    db.query("UPDATE nodes SET state = 'red' WHERE namespace = 'ns' AND id = 'a'").run();
    dispatchNotifications(db, "ns", "a", "green", "red", "green");

    const events = getEvents();
    expect(events.length).toBe(1);
    expect(events[0].node_id).toBe("a");
    expect(events[0].previous_state).toBe("green");
    expect(events[0].new_state).toBe("red");
    expect(events[0].new_effective_state).toBe("red");
  });

  test("records events for downstream nodes", () => {
    addNode("a", "green");
    addNode("b", "green");
    addEdge("b", "a"); // b depends on a

    // Change a to red
    db.query("UPDATE nodes SET state = 'red' WHERE namespace = 'ns' AND id = 'a'").run();
    dispatchNotifications(db, "ns", "a", "green", "red", "green");

    const events = getEvents();
    expect(events.length).toBe(2); // one for a, one for b
    const bEvent = events.find((e) => e.node_id === "b");
    expect(bEvent).toBeDefined();
    expect(bEvent!.new_state).toBe("green"); // b's own state unchanged
    expect(bEvent!.new_effective_state).toBe("red"); // but effective is red
  });

  test("ack rule suppresses after firing", () => {
    addNode("a", "green");
    addRule("alert", { ack: true });

    db.query("UPDATE nodes SET state = 'red' WHERE namespace = 'ns' AND id = 'a'").run();
    dispatchNotifications(db, "ns", "a", "green", "red", "green");

    const rule = db
      .query("SELECT suppressed FROM notification_rules WHERE namespace = 'ns' AND id = 'alert'")
      .get() as { suppressed: number };
    expect(rule.suppressed).toBe(1);
  });

  test("suppressed rule does not fire again", () => {
    addNode("a", "green");
    addNode("b", "green");
    addRule("alert", { ack: true });

    // First change: a goes red
    db.query("UPDATE nodes SET state = 'red' WHERE namespace = 'ns' AND id = 'a'").run();
    dispatchNotifications(db, "ns", "a", "green", "red", "green");

    // Rule is now suppressed
    const rule1 = db
      .query("SELECT suppressed, last_fired_at FROM notification_rules WHERE namespace = 'ns' AND id = 'alert'")
      .get() as { suppressed: number; last_fired_at: string };
    expect(rule1.suppressed).toBe(1);
    const firstFiredAt = rule1.last_fired_at;

    // Second change: b goes red — rule should NOT fire
    db.query("UPDATE nodes SET state = 'red' WHERE namespace = 'ns' AND id = 'b'").run();
    dispatchNotifications(db, "ns", "b", "green", "red", "green");

    const rule2 = db
      .query("SELECT last_fired_at FROM notification_rules WHERE namespace = 'ns' AND id = 'alert'")
      .get() as { last_fired_at: string };
    expect(rule2.last_fired_at).toBe(firstFiredAt); // unchanged
  });

  test("rule with specific watch only matches that node", () => {
    addNode("a", "green");
    addNode("b", "green");
    addRule("only-a", { watch: "a" });

    // Change b to red — should not trigger rule watching "a"
    db.query("UPDATE nodes SET state = 'red' WHERE namespace = 'ns' AND id = 'b'").run();
    dispatchNotifications(db, "ns", "b", "green", "red", "green");

    const rule = db
      .query("SELECT last_fired_at FROM notification_rules WHERE namespace = 'ns' AND id = 'only-a'")
      .get() as { last_fired_at: string | null };
    expect(rule.last_fired_at).toBeNull();
  });

  test("rule with on=green fires on recovery", () => {
    addNode("a", "red");
    addRule("recovery", { on: "green" });

    // Change a from red to green
    db.query("UPDATE nodes SET state = 'green' WHERE namespace = 'ns' AND id = 'a'").run();
    dispatchNotifications(db, "ns", "a", "red", "green", "red");

    const rule = db
      .query("SELECT last_fired_at FROM notification_rules WHERE namespace = 'ns' AND id = 'recovery'")
      .get() as { last_fired_at: string | null };
    expect(rule.last_fired_at).not.toBeNull();
  });

  test("rule with on=* fires on any change", () => {
    addNode("a", "green");
    addRule("any-change", { on: "*" });

    db.query("UPDATE nodes SET state = 'yellow' WHERE namespace = 'ns' AND id = 'a'").run();
    dispatchNotifications(db, "ns", "a", "green", "yellow", "green");

    const rule = db
      .query("SELECT last_fired_at FROM notification_rules WHERE namespace = 'ns' AND id = 'any-change'")
      .get() as { last_fired_at: string | null };
    expect(rule.last_fired_at).not.toBeNull();
  });

  test("rule with on=red,green fires on both", () => {
    addNode("a", "green");
    addRule("red-and-green", { on: "red,green" });

    // Go red
    db.query("UPDATE nodes SET state = 'red' WHERE namespace = 'ns' AND id = 'a'").run();
    dispatchNotifications(db, "ns", "a", "green", "red", "green");

    const rule1 = db
      .query("SELECT last_fired_at FROM notification_rules WHERE namespace = 'ns' AND id = 'red-and-green'")
      .get() as { last_fired_at: string | null };
    expect(rule1.last_fired_at).not.toBeNull();

    // Go back to green
    db.query("UPDATE nodes SET state = 'green' WHERE namespace = 'ns' AND id = 'a'").run();
    dispatchNotifications(db, "ns", "a", "red", "green", "red");

    const rule2 = db
      .query("SELECT last_fired_at FROM notification_rules WHERE namespace = 'ns' AND id = 'red-and-green'")
      .get() as { last_fired_at: string | null };
    // last_fired_at should have been updated again
    expect(rule2.last_fired_at).not.toBeNull();
  });

  test("no event or notification when effective state unchanged", () => {
    addNode("a", "green");
    addNode("b", "green");
    addNode("c", "green");
    addEdge("a", "b"); // a depends on b
    addEdge("a", "c"); // a also depends on c

    addRule("alert");

    // First: b goes red — a becomes effectively red (first time)
    db.query("UPDATE nodes SET state = 'red' WHERE namespace = 'ns' AND id = 'b'").run();
    dispatchNotifications(db, "ns", "b", "green", "red", "green");

    // a should now have an event (effective went green -> red)
    const eventsAfterB = getEvents().filter((e) => e.node_id === "a");
    expect(eventsAfterB.length).toBe(1);

    // Now: c also goes red — a's effective state is STILL red (unchanged)
    db.query("UPDATE nodes SET state = 'red' WHERE namespace = 'ns' AND id = 'c'").run();
    dispatchNotifications(db, "ns", "c", "green", "red", "green");

    const eventsAfterC = getEvents().filter((e) => e.node_id === "a");
    // No new event for a — effective state didn't change
    expect(eventsAfterC.length).toBe(1);
  });
});
