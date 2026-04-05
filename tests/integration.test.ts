import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateToken, hashToken } from "../src/auth";
import { createTestDb } from "../src/db";
import { createServer } from "../src/server";

const legendum = require("../src/lib/legendum.js");
legendum.mock({
  charge: () => ({ transaction_id: 1, balance: 50 }),
  balance: () => ({ balance: 100, held: 0 }),
  linkAccount: () => ({ token: "lt_mock_token" }),
});

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let token: string;
let db: ReturnType<typeof createTestDb>;
const NS = "test-ns";

beforeAll(async () => {
  db = createTestDb();
  server = createServer(db, 0);
  baseUrl = `http://localhost:${server.port}/v1`;

  // Seed a test token directly
  token = generateToken();
  const hash = await hashToken(token);
  db.query("INSERT INTO tokens (token_hash, email) VALUES (?, ?)").run(
    hash,
    "test@example.com",
  );
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
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.auth !== false && token) {
    headers.Authorization = `Bearer ${token}`;
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

describe("signup and namespaces", () => {
  test("signup requires email", async () => {
    const res = await api("/signup", {
      method: "POST",
      auth: false,
      body: { account_key: "lak_test123" },
    });
    expect(res.status).toBe(400);
  });

  test("signup requires account_key", async () => {
    const res = await api("/signup", {
      method: "POST",
      auth: false,
      body: { email: "signup@example.com" },
    });
    expect(res.status).toBe(400);
  });

  test("signup with email and account_key succeeds", async () => {
    const res = await api("/signup", {
      method: "POST",
      auth: false,
      body: { email: "signup@example.com", account_key: "lak_test123" },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.email).toBe("signup@example.com");
    expect(data.message).toContain("emailed");
  });

  test("duplicate email rejected", async () => {
    const res = await api("/signup", {
      method: "POST",
      auth: false,
      body: { email: "signup@example.com", account_key: "lak_test123" },
    });
    expect(res.status).toBe(409);
  });

  test("create namespace with token", async () => {
    const res = await api("/namespaces", {
      method: "POST",
      body: { id: NS },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(NS);
  });

  test("duplicate namespace returns 409", async () => {
    const res = await api("/namespaces", {
      method: "POST",
      body: { id: NS },
    });
    expect(res.status).toBe(409);
  });

  test("invalid namespace id returns 400", async () => {
    const res = await api("/namespaces", {
      method: "POST",
      body: { id: "INVALID!" },
    });
    expect(res.status).toBe(400);
  });

  test("create namespace without token returns 401", async () => {
    const res = await api("/namespaces", {
      method: "POST",
      body: { id: "no-auth" },
      auth: false,
    });
    expect(res.status).toBe(401);
  });
});

describe("auth", () => {
  test("missing token returns 401", async () => {
    const res = await api(`/nodes/${NS}`, { auth: false });
    expect(res.status).toBe(401);
  });

  test("wrong token returns 401", async () => {
    const res = await fetch(`${baseUrl}/nodes/${NS}`, {
      headers: { Authorization: "Bearer dep_wrong" },
    });
    expect(res.status).toBe(401);
  });

  test("valid token but wrong namespace returns 401", async () => {
    const res = await api(`/nodes/nonexistent-ns`);
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

  test("reject node ID with slash", async () => {
    const res = await api(`/nodes/${NS}/bad%2Fid`, {
      method: "PUT",
      body: { state: "green" },
    });
    expect(res.status).toBe(400);
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
    await api(`/nodes/${NS}/redis`, {
      method: "PUT",
      body: { state: "green" },
    });
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

describe("default_state", () => {
  test("node with default_state starts in that state", async () => {
    const res = await api(`/nodes/${NS}/aggregator`, {
      method: "PUT",
      body: { default_state: "green", depends_on: ["database"] },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.state).toBe("green");
    expect(data.default_state).toBe("green");
  });

  test("explicit state overrides default_state on creation", async () => {
    const res = await api(`/nodes/${NS}/agg2`, {
      method: "PUT",
      body: { state: "red", default_state: "green" },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.state).toBe("red");
    expect(data.default_state).toBe("green");
  });

  test("invalid default_state returns 400", async () => {
    const res = await api(`/nodes/${NS}/bad-default`, {
      method: "PUT",
      body: { default_state: "purple" },
    });
    expect(res.status).toBe(400);
  });

  test("default_state can be cleared with null", async () => {
    await api(`/nodes/${NS}/aggregator`, {
      method: "PUT",
      body: { default_state: null },
    });
    const data = await (await api(`/nodes/${NS}/aggregator`)).json();
    expect(data.default_state).toBeNull();
  });

  test("aggregator node reflects dependency state", async () => {
    // Recreate aggregator with default_state green
    await api(`/nodes/${NS}/aggregator`, {
      method: "PUT",
      body: {
        state: "green",
        default_state: "green",
        depends_on: ["database"],
      },
    });
    // Set database to red
    await api(`/state/${NS}/database/red`, { method: "PUT" });

    const data = await (await api(`/nodes/${NS}/aggregator`)).json();
    expect(data.state).toBe("green");
    expect(data.effective_state).toBe("red");
  });

  test("YAML import uses default_state for new nodes", async () => {
    const yaml = `
namespace: ${NS}
nodes:
  yaml-agg:
    default_state: green
    depends_on:
      - database
`;
    await api(`/graph/${NS}`, {
      method: "PUT",
      body: yaml,
      contentType: "application/yaml",
    });

    const data = await (await api(`/nodes/${NS}/yaml-agg`)).json();
    expect(data.state).toBe("green");
    expect(data.default_state).toBe("green");
  });

  test("YAML export includes default_state", async () => {
    const res = await api(`/graph/${NS}?format=yaml`);
    const text = await res.text();
    expect(text).toContain("default_state: green");
  });
});

describe("state shorthand", () => {
  test("set state on existing node", async () => {
    // Reset database to green
    const res = await api(`/state/${NS}/database/green`, { method: "PUT" });
    expect(res.status).toBe(204);

    const node = await (await api(`/nodes/${NS}/database`)).json();
    expect(node.state).toBe("green");
  });

  test("auto-creates node on PUT /state", async () => {
    const res = await api(`/state/${NS}/new-service/green`, { method: "PUT" });
    expect(res.status).toBe(204);

    const node = await (await api(`/nodes/${NS}/new-service`)).json();
    expect(node.state).toBe("green");
    expect(node.depends_on).toEqual([]);
  });

  test("invalid state returns 400", async () => {
    const res = await api(`/state/${NS}/database/purple`, { method: "PUT" });
    expect(res.status).toBe(400);
  });

  test("same state is a no-op (no event)", async () => {
    // Set to green again (already green)
    const beforeEvents = await (await api(`/events/${NS}/database`)).json();

    await api(`/state/${NS}/database/green`, { method: "PUT" });

    const afterEvents = await (await api(`/events/${NS}/database`)).json();

    expect(afterEvents.events.length).toBe(beforeEvents.events.length);
  });
});

describe("reason", () => {
  test("PUT /state with X-Reason header", async () => {
    await api(`/state/${NS}/database/red`, {
      method: "PUT",
      headers: { "X-Reason": "disk full on /var/data" },
    });

    const node = await (await api(`/nodes/${NS}/database`)).json();
    expect(node.state).toBe("red");
    expect(node.reason).toBe("disk full on /var/data");
  });

  test("reason appears in events", async () => {
    const res = await api(`/events/${NS}/database`);
    const data = await res.json();
    const last = data.events[data.events.length - 1];
    expect(last.reason).toBe("disk full on /var/data");
  });

  test("reason updates on state change", async () => {
    await api(`/state/${NS}/database/green`, {
      method: "PUT",
      headers: { "X-Reason": "disk cleaned up" },
    });

    const node = await (await api(`/nodes/${NS}/database`)).json();
    expect(node.reason).toBe("disk cleaned up");
  });

  test("reason via PUT /nodes", async () => {
    await api(`/nodes/${NS}/database`, {
      method: "PUT",
      body: { state: "yellow", reason: "maintenance window" },
    });

    const node = await (await api(`/nodes/${NS}/database`)).json();
    expect(node.reason).toBe("maintenance window");
  });

  test("PUT /state with X-Solution header", async () => {
    await api(`/state/${NS}/database/red`, {
      method: "PUT",
      headers: {
        "X-Reason": "disk full",
        "X-Solution": "Run df -h and clear logs",
      },
    });

    const node = await (await api(`/nodes/${NS}/database`)).json();
    expect(node.reason).toBe("disk full");
    expect(node.solution).toBe("Run df -h and clear logs");
  });

  test("solution appears in events and graph", async () => {
    const eventsRes = await api(`/events/${NS}/database`);
    const eventsData = await eventsRes.json();
    const last = eventsData.events[eventsData.events.length - 1];
    expect(last.solution).toBe("Run df -h and clear logs");

    const graphRes = await api(`/graph/${NS}?state=red`);
    const graphData = await graphRes.json();
    const dbNode = graphData.nodes.find(
      (n: { id: string }) => n.id === "database",
    );
    expect(dbNode?.solution).toBe("Run df -h and clear logs");
  });
});

describe("events", () => {
  test("state change creates an event", async () => {
    // Set to green then yellow so we have a known transition
    await api(`/state/${NS}/database/green`, { method: "PUT" });
    await api(`/state/${NS}/database/yellow`, { method: "PUT" });

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

  test("events endpoint supports order=desc (newest first)", async () => {
    const res = await api(`/events/${NS}?limit=2&order=desc`);
    const data = await res.json();
    expect(data.events.length).toBeLessThanOrEqual(2);
    if (data.events.length >= 2) {
      expect(data.events[0].id).toBeGreaterThan(data.events[1].id);
    }
  });
});

describe("graph", () => {
  test("full graph returns nodes and edges", async () => {
    // Reset database to green for cleaner test
    await api(`/state/${NS}/database/green`, { method: "PUT" });

    const res = await api(`/graph/${NS}`);
    const data = await res.json();
    expect(data.namespace).toBe(NS);
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.edges.length).toBeGreaterThan(0);
  });

  test("filter by effective state", async () => {
    // Set database to red so api-server is effectively red
    await api(`/state/${NS}/database/red`, { method: "PUT" });

    const res = await api(`/graph/${NS}?state=red`);
    const data = await res.json();
    for (const node of data.nodes) {
      expect(node.effective_state).toBe("red");
      expect(node).toHaveProperty("label");
      expect(node).toHaveProperty("reason");
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
    await api(`/state/${NS}/database/red`, { method: "PUT" });

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
        email: true,
        ack: true,
      },
    });
    expect(res.status).toBe(200);
  });

  test("allow rule with both url and email", async () => {
    const res = await api(`/notifications/${NS}`, {
      method: "PUT",
      body: {
        id: "both-rule",
        url: "https://example.com",
        email: true,
      },
    });
    expect(res.status).toBe(200);
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
    expect(
      data.find((r: { id: string }) => r.id === "test-hook"),
    ).toBeUndefined();
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
    expect(typeof data.nodes).toBe("number");
    expect(typeof data.active_nodes).toBe("number");
    expect(typeof data.total_events).toBe("number");
    expect(data.period).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("status page /ns/:namespace", () => {
  let nsToken: string;
  const nsName = "status-test";

  test("setup: create token and namespace with nodes", async () => {
    nsToken = generateToken();
    const hash = await hashToken(nsToken);
    db.query("INSERT INTO tokens (token_hash, email) VALUES (?, ?)").run(
      hash,
      "status@example.com",
    );

    const res = await fetch(`${baseUrl.replace("/v1", "")}/v1/namespaces`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nsToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: nsName }),
    });
    expect(res.status).toBe(201);

    await fetch(`${baseUrl}/nodes/${nsName}/db`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${nsToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: "green", label: "Database" }),
    });
    await fetch(`${baseUrl}/nodes/${nsName}/api`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${nsToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: "red", label: "API", depends_on: ["db"] }),
    });
  });

  test("returns 401 without credentials", async () => {
    const res = await fetch(`${baseUrl.replace("/v1", "")}/ns/${nsName}`);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("depends.cc");
  });

  test("returns 401 with wrong credentials", async () => {
    const res = await fetch(`${baseUrl.replace("/v1", "")}/ns/${nsName}`, {
      headers: {
        Authorization: `Basic ${btoa("status@example.com:dep_wrong")}`,
      },
    });
    expect(res.status).toBe(401);
  });

  test("text response is valid plain text (not [object Promise])", async () => {
    const res = await fetch(`${baseUrl.replace("/v1", "")}/ns/${nsName}`, {
      headers: {
        Authorization: `Basic ${btoa(`status@example.com:${nsToken}`)}`,
      },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("[object Promise]");
    expect(text).toContain("db");
    expect(text).toContain("api");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  test("json response returns valid JSON array", async () => {
    const res = await fetch(`${baseUrl.replace("/v1", "")}/ns/${nsName}.json`, {
      headers: {
        Authorization: `Basic ${btoa(`status@example.com:${nsToken}`)}`,
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    const ids = data.map((n: { id: string }) => n.id).sort();
    expect(ids).toEqual(["api", "db"]);
  });

  test("yaml response returns valid YAML graph", async () => {
    const res = await fetch(`${baseUrl.replace("/v1", "")}/ns/${nsName}.yaml`, {
      headers: {
        Authorization: `Basic ${btoa(`status@example.com:${nsToken}`)}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("namespace:");
    expect(text).toContain("db");
    expect(text).toContain("api");
  });

  test("svg response returns valid SVG", async () => {
    const res = await fetch(`${baseUrl.replace("/v1", "")}/ns/${nsName}.svg`, {
      headers: {
        Authorization: `Basic ${btoa(`status@example.com:${nsToken}`)}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    const text = await res.text();
    expect(text).toContain("<svg");
    expect(text).toContain("db");
    expect(text).toContain("api");
  });

  test("single node text response", async () => {
    const res = await fetch(`${baseUrl.replace("/v1", "")}/ns/${nsName}/db`, {
      headers: {
        Authorization: `Basic ${btoa(`status@example.com:${nsToken}`)}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toStartWith("db");
    expect(text).toContain("green");
  });

  test("single node json response", async () => {
    const res = await fetch(
      `${baseUrl.replace("/v1", "")}/ns/${nsName}/api.json`,
      {
        headers: {
          Authorization: `Basic ${btoa(`status@example.com:${nsToken}`)}`,
        },
      },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("api");
    expect(data.state).toBe("red");
    expect(data.depends_on).toEqual(["db"]);
  });

  test("single node 404 for missing node", async () => {
    const res = await fetch(
      `${baseUrl.replace("/v1", "")}/ns/${nsName}/nonexistent`,
      {
        headers: {
          Authorization: `Basic ${btoa(`status@example.com:${nsToken}`)}`,
        },
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("namespace deletion", () => {
  test("delete cascades everything", async () => {
    // Create a token directly
    const delToken = generateToken();
    const delHash = await hashToken(delToken);
    db.query("INSERT INTO tokens (token_hash, email) VALUES (?, ?)").run(
      delHash,
      "delete@example.com",
    );

    const createRes = await fetch(`${baseUrl}/namespaces`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${delToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "to-delete" }),
    });
    expect(createRes.status).toBe(201);

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
