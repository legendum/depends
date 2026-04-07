import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb } from "../src/db";
import { createServer, setByLegendum } from "../src/server";

let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeAll(() => {
  setByLegendum(true);
  const db = createTestDb();
  server = createServer(db, 0);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  setByLegendum(null);
});

describe("public routes", () => {
  test("GET /docs returns JSON when Accept: application/json", async () => {
    const res = await fetch(`${baseUrl}/docs`, {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const data = (await res.json()) as {
      cli: { install: string; commands: Record<string, string> };
      api: { base: string; endpoints: unknown[] };
    };
    expect(data.cli.install).toContain("install.sh");
    expect(Object.keys(data.cli.commands).length).toBeGreaterThan(0);
    expect(data.api.base).toBe("/v1");
    expect(Array.isArray(data.api.endpoints)).toBe(true);
    expect(data.api.endpoints.length).toBeGreaterThan(0);
  });

  test("GET /docs returns HTML by default", async () => {
    const res = await fetch(`${baseUrl}/docs`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<");
  });

  test("GET /llms.txt serves plain text", async () => {
    const res = await fetch(`${baseUrl}/llms.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  test("GET /install.sh serves plain text", async () => {
    const res = await fetch(`${baseUrl}/install.sh`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  test("GET /example.svg serves SVG", async () => {
    const res = await fetch(`${baseUrl}/example.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
  });
});
