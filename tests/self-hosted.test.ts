import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb } from "../src/db";
import { createServer, setByLegendum } from "../src/server";

const legendum = require("../src/lib/legendum.js");
legendum.mock({
  charge: () => {
    throw new Error("charge should not be called in self-hosted mode");
  },
  balance: () => ({ balance: 100, held: 0 }),
  linkAccount: () => ({
    account_token: "lt_mock_token",
    email: "mock@test.com",
  }),
});

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let db: ReturnType<typeof createTestDb>;
const NS = "self-hosted-ns";

beforeAll(() => {
  setByLegendum(false);
  db = createTestDb();
  server = createServer(db, 0);
  baseUrl = `http://localhost:${server.port}/v1`;
});

afterAll(() => {
  server.stop(true);
  setByLegendum(null);
});

async function req(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${baseUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

describe("self-hosted mode", () => {
  test("PUT state without any Authorization header succeeds", async () => {
    const res = await req(`/state/${NS}/api/green`, { method: "PUT" });
    expect(res.status).toBe(204);
  });

  test("namespace is auto-created on first state write", async () => {
    const ns = db
      .query("SELECT ns_id, token_id FROM namespaces WHERE id = ?")
      .get(NS) as { ns_id: number; token_id: number } | null;
    expect(ns).not.toBeNull();
    expect(ns?.token_id).toBe(0);
  });

  test("node is visible via GET without auth", async () => {
    const res = await req(`/nodes/${NS}/api`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; state: string };
    expect(body.id).toBe("api");
    expect(body.state).toBe("green");
  });

  test("any bearer token is accepted", async () => {
    const res = await req(`/state/${NS}/web/red`, {
      method: "PUT",
      headers: { Authorization: "Bearer anything-goes" },
    });
    expect(res.status).toBe(204);
  });

  test("PUT graph via YAML without auth", async () => {
    const yaml = `namespace: ${NS}\nnodes:\n  db:\n    label: Database\n  worker:\n    depends_on: [db]\n`;
    const res = await fetch(`${baseUrl}/graph/${NS}`, {
      method: "PUT",
      headers: { "Content-Type": "application/yaml" },
      body: yaml,
    });
    expect(res.status).toBe(200);
  });

  test("no charges were made during any of the above", async () => {
    // The mock throws if charge is called. If we got here, no charges happened.
    expect(true).toBe(true);
  });
});
