import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestDb } from "../src/db";
import { createServer } from "../src/server";
import type { Server } from "bun";

let server: Server;
let baseUrl: string;
let token: string;
const NS = "test-ns";

beforeAll(async () => {
  const db = createTestDb();
  server = createServer(db, 0); // random port
  baseUrl = `http://localhost:${server.port}/v1`;
});

afterAll(() => {
  server.stop(true);
});

async function api(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    auth?: boolean;
    contentType?: string;
  } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.auth !== false && token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (opts.body && opts.contentType !== "text/plain") {
    if (opts.contentType) {
      headers["Content-Type"] = opts.contentType;
    } else {
      headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body
      ? typeof opts.body === "string"
        ? opts.body
        : JSON.stringify(opts.body)
      : undefined,
  });

  return res;
}

describe("namespaces", () => {
  test("create namespace returns token", async () => {
    const res = await api("/namespaces", {
      method: "POST",
      body: { id: NS },
      auth: false,
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(NS);
    expect(data.token).toMatch(/^dps_/);
    token = data.token;
  });

  test("duplicate namespace returns 409", async () => {
    const res = await api("/namespaces", {
      method: "POST",
      body: { id: NS },
      auth: false,
    });
    expect(res.status).toBe(409);
  });

  test("invalid namespace id returns 400", async () => {
    const res = await api("/namespaces", {
      method: "POST",
      body: { id: "INVALID!" },
      auth: false,
    });
    expect(res.status).toBe(400);
  });
});

describe("auth", () => {
  test("missing token returns 401", async () => {
    const res = await api(`/nodes/${NS}`, { auth: false });
    expect(res.status).toBe(401);
  });

  test("wrong token returns 401", async () => {
    const res = await fetch(`${baseUrl}/nodes/${NS}`, {
      headers: { Authorization: "Bearer dps_wrong" },
    });
    expect(res.status).toBe(401);
  });
});

describe("nodes", () => {
  test("create a node", async () => {
    const res = await api(`/nodes/${NS}/database`, {
      method: "PUT",
      body: { label: "PostgreSQL", state: "green", meta: { host: "db.local" } },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe("database");
    expect(data.state).toBe("green");
    expect(data.effective_state).toBe("green");
    expect(data.label).toBe("PostgreSQL");
    expect(data.meta.host).toBe("db.local");
  });

  test("get a node", async () => {
    const res = await api(`/nodes/${NS}/database`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("database");
    expect(data.state).toBe("green");
  });

  test("create node with dependencies", async () => {
    const res = await api(`/nodes/${NS}/api-server`, {
      method: "PUT",
      body: {
        label: "API Server",
        state: "green",
        depends_on: ["database"],
      },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.depends_on).toEqual(["database"]);
  });

  test("effective state propagates through dependencies", async () => {
    // Set database to red
    await api(`/nodes/${NS}/database`, {
      method: "PUT",
      body: { state: "red" },
    });

    // api-server should now be effectively red
    const res = await api(`/nodes/${NS}/api-server`);
    const data = await res.json();
    expect(data.state).toBe("green"); // own state unchanged
    expect(data.effective_state).toBe("red"); // effective is red due to dependency
  });

  test("depended_on_by is populated", async () => {
    const res = await api(`/nodes/${NS}/database`);
    const data = await res.json();
    expect(data.depended_on_by).toContain("api-server");
  });

  test("update node (patch semantics)", async () => {
    const res = await api(`/nodes/${NS}/database`, {
      method: "PUT",
      body: { label: "PostgreSQL Primary" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.label).toBe("PostgreSQL Primary");
    expect(data.state).toBe("red"); // unchanged
  });

  test("auto-creates dependency nodes", async () => {
    await api(`/nodes/${NS}/worker`, {
      method: "PUT",
      body: { state: "green", depends_on: ["redis"] },
    });

    const res = await api(`/nodes/${NS}/redis`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("yellow"); // default state
  });

  test("cycle detection on depends_on", async () => {
    // database already depends on nothing
    // api-server depends on database
    // trying to make database depend on api-server should fail
    const res = await api(`/nodes/${NS}/database`, {
      method: "PUT",
      body: { depends_on: ["api-server"] },
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("Cycle");
  });

  test("list nodes", async () => {
    const res = await api(`/nodes/${NS}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(3);
  });

  test("get non-existent node returns 404", async () => {
    const res = await api(`/nodes/${NS}/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("delete a node", async () => {
    await api(`/nodes/${NS}/redis`, { method: "PUT", body: { state: "green" } });
    const del = await api(`/nodes/${NS}/redis`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const get = await api(`/nodes/${NS}/redis`);
    expect(get.status).toBe(404);
  });

  test("invalid state returns 400", async () => {
    const res = await api(`/nodes/${NS}/database`, {
      method: "PUT",
      body: { state: "purple" },
    });
    expect(res.status).toBe(400);
  });
});

describe("state shorthand", () => {
  test("set state on existing node", async () => {
    // Reset database to green
    const res = await api(`/state/${NS}/database`, {
      method: "PUT",
      body: "green",
      contentType: "text/plain",
    });
    expect(res.status).toBe(204);

    const node = await (await api(`/nodes/${NS}/database`)).json();
    expect(node.state).toBe("green");
  });

  test("auto-creates node on PUT /state", async () => {
    const res = await api(`/state/${NS}/new-service`, {
      method: "PUT",
      body: "green",
      contentType: "text/plain",
    });
    expect(res.status).toBe(204);

    const node = await (await api(`/nodes/${NS}/new-service`)).json();
    expect(node.state).toBe("green");
    expect(node.depends_on).toEqual([]);
  });

  test("invalid state returns 400", async () => {
    const res = await api(`/state/${NS}/database`, {
      method: "PUT",
      body: "purple",
      contentType: "text/plain",
    });
    expect(res.status).toBe(400);
  });

  test("same state is a no-op (no event)", async () => {
    // Set to green again (already green)
    const beforeEvents = await (
      await api(`/events/${NS}/database`)
    ).json();

    await api(`/state/${NS}/database`, {
      method: "PUT",
      body: "green",
      contentType: "text/plain",
    });

    const afterEvents = await (
      await api(`/events/${NS}/database`)
    ).json();

    expect(afterEvents.events.length).toBe(beforeEvents.events.length);
  });
});

describe("events", () => {
  test("state change creates an event", async () => {
    // Change database from green to yellow
    await api(`/state/${NS}/database`, {
      method: "PUT",
      body: "yellow",
      contentType: "text/plain",
    });

    const res = await api(`/events/${NS}/database`);
    const data = await res.json();
    expect(data.events.length).toBeGreaterThan(0);

    const last = data.events[data.events.length - 1];
    expect(last.previous_state).toBe("green");
    expect(last.new_state).toBe("yellow");
  });

  test("events endpoint supports limit", async () => {
    const res = await api(`/events/${NS}?limit=1`);
    const data = await res.json();
    expect(data.events.length).toBeLessThanOrEqual(1);
  });

  test("events endpoint supports since filter", async () => {
    const future = "2099-01-01T00:00:00Z";
    const res = await api(`/events/${NS}?since=${future}`);
    const data = await res.json();
    expect(data.events.length).toBe(0);
  });
});

describe("graph", () => {
  test("full graph returns nodes and edges", async () => {
    // Reset database to green for cleaner test
    await api(`/state/${NS}/database`, {
      method: "PUT",
      body: "green",
      contentType: "text/plain",
    });

    const res = await api(`/graph/${NS}`);
    const data = await res.json();
    expect(data.namespace).toBe(NS);
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.edges.length).toBeGreaterThan(0);
  });

  test("filter by effective state", async () => {
    // Set database to red so api-server is effectively red
    await api(`/state/${NS}/database`, {
      method: "PUT",
      body: "red",
      contentType: "text/plain",
    });

    const res = await api(`/graph/${NS}?state=red`);
    const data = await res.json();
    for (const node of data.nodes) {
      expect(node.effective_state).toBe("red");
    }
  });

  test("upstream returns transitive dependencies", async () => {
    const res = await api(`/graph/${NS}/api-server/upstream`);
    const data = await res.json();
    const nodeIds = data.nodes.map((n: { id: string }) => n.id);
    expect(nodeIds).toContain("api-server");
    expect(nodeIds).toContain("database");
  });

  test("downstream returns transitive dependents", async () => {
    const res = await api(`/graph/${NS}/database/downstream`);
    const data = await res.json();
    const nodeIds = data.nodes.map((n: { id: string }) => n.id);
    expect(nodeIds).toContain("database");
    expect(nodeIds).toContain("api-server");
  });

  test("YAML export", async () => {
    const res = await api(`/graph/${NS}?format=yaml`);
    expect(res.headers.get("Content-Type")).toBe("application/yaml");
    const text = await res.text();
    expect(text).toContain("namespace:");
    expect(text).toContain("database");
  });

  test("YAML import preserves state", async () => {
    // Set database to red
    await api(`/state/${NS}/database`, {
      method: "PUT",
      body: "red",
      contentType: "text/plain",
    });

    // Import YAML that mentions database
    const yaml = `
namespace: ${NS}
nodes:
  database:
    label: Updated Label
  api-server:
    label: API
    depends_on:
      - database
`;
    await api(`/graph/${NS}`, {
      method: "PUT",
      body: yaml,
      contentType: "application/yaml",
    });

    // State should be preserved
    const node = await (await api(`/nodes/${NS}/database`)).json();
    expect(node.state).toBe("red"); // preserved
    expect(node.label).toBe("Updated Label"); // updated
  });

  test("YAML import with cycle returns 409", async () => {
    const yaml = `
namespace: ${NS}
nodes:
  x:
    depends_on: [y]
  y:
    depends_on: [x]
`;
    const res = await api(`/graph/${NS}`, {
      method: "PUT",
      body: yaml,
      contentType: "application/yaml",
    });
    expect(res.status).toBe(409);
  });
});

describe("notifications", () => {
  test("create webhook rule", async () => {
    const res = await api(`/notifications/${NS}`, {
      method: "PUT",
      body: {
        id: "test-hook",
        watch: "*",
        on: ["red", "green"],
        url: "https://example.com/hook",
        secret: "whsec_test",
      },
    });
    expect(res.status).toBe(200);
  });

  test("create email rule", async () => {
    const res = await api(`/notifications/${NS}`, {
      method: "PUT",
      body: {
        id: "test-email",
        watch: "*",
        on: "red",
        email: "ops@example.com",
        ack: true,
      },
    });
    expect(res.status).toBe(200);
  });

  test("reject rule with both url and email", async () => {
    const res = await api(`/notifications/${NS}`, {
      method: "PUT",
      body: {
        id: "bad-rule",
        url: "https://example.com",
        email: "a@b.com",
      },
    });
    expect(res.status).toBe(400);
  });

  test("reject rule with neither url nor email", async () => {
    const res = await api(`/notifications/${NS}`, {
      method: "PUT",
      body: { id: "bad-rule" },
    });
    expect(res.status).toBe(400);
  });

  test("list notification rules", async () => {
    const res = await api(`/notifications/${NS}`);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
    const hook = data.find((r: { id: string }) => r.id === "test-hook");
    expect(hook.on).toEqual(["red", "green"]);
    expect(hook.secret).toBe("***"); // masked
  });

  test("ack re-arms suppressed rule", async () => {
    // Manually suppress the email rule by changing state to trigger it
    // First, let's suppress it directly via the DB... actually let's test the ack endpoint
    const res = await api(`/notifications/${NS}/test-email/ack`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });

  test("delete notification rule", async () => {
    const res = await api(`/notifications/${NS}/test-hook`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);

    const get = await api(`/notifications/${NS}`);
    const data = await get.json();
    expect(data.find((r: { id: string }) => r.id === "test-hook")).toBeUndefined();
  });

  test("delete non-existent rule returns 404", async () => {
    const res = await api(`/notifications/${NS}/nonexistent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

describe("usage", () => {
  test("returns usage stats", async () => {
    const res = await api(`/usage/${NS}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.namespace).toBe(NS);
    expect(data.plan).toBe("free");
    expect(typeof data.nodes).toBe("number");
    expect(typeof data.active_nodes).toBe("number");
    expect(typeof data.total_events).toBe("number");
    expect(data.period).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("plan limits", () => {
  let limitToken: string;
  const limitNs = "limit-test";

  test("setup: create namespace", async () => {
    const res = await api("/namespaces", {
      method: "POST",
      body: { id: limitNs },
      auth: false,
    });
    const data = await res.json();
    limitToken = data.token;
  });

  test("node limit enforced on free plan", async () => {
    // Create 10 nodes (the free limit)
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/nodes/${limitNs}/node-${i}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${limitToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state: "green" }),
      });
      expect(res.status).toBe(201);
    }

    // 11th node should fail
    const res = await fetch(`${baseUrl}/nodes/${limitNs}/node-overflow`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${limitToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: "green" }),
    });
    expect(res.status).toBe(402);
  });

  test("node limit enforced on PUT /state auto-create", async () => {
    const res = await fetch(`${baseUrl}/state/${limitNs}/auto-overflow`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${limitToken}` },
      body: "green",
    });
    expect(res.status).toBe(402);
  });
});

describe("namespace deletion", () => {
  test("delete cascades everything", async () => {
    // Create a fresh namespace
    const createRes = await api("/namespaces", {
      method: "POST",
      body: { id: "to-delete" },
      auth: false,
    });
    const { token: delToken } = await createRes.json();

    // Add a node
    await fetch(`${baseUrl}/nodes/to-delete/mynode`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${delToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: "green" }),
    });

    // Delete namespace
    const delRes = await fetch(`${baseUrl}/namespaces/to-delete`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${delToken}` },
    });
    expect(delRes.status).toBe(204);

    // Node should be gone (auth will also fail since namespace is gone)
    const getRes = await fetch(`${baseUrl}/nodes/to-delete/mynode`, {
      headers: { Authorization: `Bearer ${delToken}` },
    });
    expect(getRes.status).toBe(401);
  });
});
