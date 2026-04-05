import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { generateToken, hashToken } from "../src/auth";
import { createTestDb } from "../src/db";
import { createServer } from "../src/server";

const legendum = require("../src/lib/legendum.js");
legendum.mock({
  charge: () => ({ transaction_id: 1, balance: 50 }),
  linkAccount: () => ({ token: "lt_mock_token" }),
});

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let token: string;
const NS = "cli-test";

// Temp directory for test files
const tmpDir = join(import.meta.dir, ".cli-test-tmp");

beforeAll(async () => {
  const db = createTestDb();
  server = createServer(db, 0);
  baseUrl = `http://localhost:${server.port}/v1`;

  // Seed a test token directly
  token = generateToken();
  const hash = await hashToken(token);
  db.query("INSERT INTO tokens (token_hash, email) VALUES (?, ?)").run(
    hash,
    "cli-test@example.com",
  );

  // Create namespace
  await fetch(`${baseUrl}/namespaces`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: NS }),
  });

  // Create some nodes for testing
  await fetch(`${baseUrl}/nodes/${NS}/database`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ label: "PostgreSQL", state: "green" }),
  });
  await fetch(`${baseUrl}/nodes/${NS}/api-server`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      label: "API Server",
      state: "green",
      depends_on: ["database"],
    }),
  });
  await fetch(`${baseUrl}/nodes/${NS}/worker`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      label: "Worker",
      state: "green",
      depends_on: ["api-server"],
    }),
  });

  // Create tmp dir
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  server.stop(true);
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

// Helper to run CLI command
async function cli(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(
    ["bun", "run", join(import.meta.dir, "../src/cli.ts"), ...args],
    {
      cwd: opts.cwd ?? tmpDir,
      env: {
        ...process.env,
        DEPENDS_TOKEN: token,
        DEPENDS_NAMESPACE: NS,
        DEPENDS_API_URL: baseUrl,
        DEPENDS_CONFIG: join(tmpDir, "config.yml"),
        ...opts.env,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

describe("depends CLI", () => {
  describe("help", () => {
    test("--help shows usage", async () => {
      const { stdout, exitCode } = await cli(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("depends");
      expect(stdout).toContain("signup");
      expect(stdout).toContain("init");
      expect(stdout).toContain("push");
      expect(stdout).toContain("status");
    });

    test("no args shows usage", async () => {
      const { stdout, exitCode } = await cli([]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("depends");
    });

    test("unknown command exits with error", async () => {
      const { stderr, exitCode } = await cli(["foobar"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Unknown command");
    });
  });

  describe("signup", () => {
    test("signup with email and account key shows confirmation", async () => {
      const { stdout, exitCode } = await cli([
        "signup",
        "newsignup@example.com",
        "lak_testkey123",
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("emailed");
    });
  });

  describe("init", () => {
    const initDir = join(tmpDir, "init-test");

    beforeEach(() => {
      if (!existsSync(initDir)) mkdirSync(initDir, { recursive: true });
    });

    afterEach(() => {
      const f = join(initDir, "depends.yml");
      if (existsSync(f)) unlinkSync(f);
    });

    test("creates depends.yml", async () => {
      const { stdout, exitCode } = await cli(["init"], { cwd: initDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Created depends.yml");
      expect(existsSync(join(initDir, "depends.yml"))).toBe(true);

      const content = readFileSync(join(initDir, "depends.yml"), "utf-8");
      expect(content).toContain("namespace:");
      expect(content).toContain("nodes:");
    });

    test("refuses if depends.yml already exists", async () => {
      writeFileSync(join(initDir, "depends.yml"), "namespace: foo\n");
      const { stderr, exitCode } = await cli(["init"], { cwd: initDir });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("already exists");
    });
  });

  describe("status", () => {
    test("lists all nodes with states", async () => {
      const { stdout, exitCode } = await cli(["status"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("database");
      expect(stdout).toContain("api-server");
      expect(stdout).toContain("worker");
      expect(stdout).toContain("green");
    });

    test("shows single node detail", async () => {
      const { stdout, exitCode } = await cli(["status", "api-server"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("api-server");
      expect(stdout).toContain("API Server");
      expect(stdout).toContain("depends_on:");
      expect(stdout).toContain("database");
    });

    test("single node with reason and solution", async () => {
      // Set database to red with reason and solution
      await fetch(`${baseUrl}/state/${NS}/database/red`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Reason": "disk full",
          "X-Solution": "Clear /var/log",
        },
      });

      const { stdout, exitCode } = await cli(["status", "database"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("red");
      expect(stdout).toContain("disk full");
      expect(stdout).toContain("Clear /var/log");

      // Reset
      await fetch(`${baseUrl}/state/${NS}/database/green`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
    });

    test("shows effective state when different from own", async () => {
      // Set database to red
      await fetch(`${baseUrl}/state/${NS}/database/red`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });

      const { stdout, exitCode } = await cli(["status"]);
      expect(exitCode).toBe(0);
      // api-server should show own=green, effective=red
      expect(stdout).toContain("effective");

      // Reset
      await fetch(`${baseUrl}/state/${NS}/database/green`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
    });

    test("nonexistent node returns error", async () => {
      const { stderr, exitCode } = await cli(["status", "nonexistent"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Error");
    });

    test("-n flag overrides namespace", async () => {
      const { stderr: _stderr, exitCode } = await cli(
        ["status", "-n", "nonexistent-ns"],
        {
          env: { DEPENDS_NAMESPACE: "" },
        },
      );
      // Should fail auth since namespace doesn't exist under this token
      expect(exitCode).toBe(1);
    });
  });

  describe("set", () => {
    test("sets node state", async () => {
      const { stdout, exitCode } = await cli(["set", "database", "yellow"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("database");
      expect(stdout).toContain("yellow");

      // Verify
      const res = await fetch(`${baseUrl}/nodes/${NS}/database`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(data.state).toBe("yellow");

      // Reset
      await fetch(`${baseUrl}/state/${NS}/database/green`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
    });

    test("set with namespace/node syntax", async () => {
      const { stdout, exitCode } = await cli([
        "set",
        `${NS}/database`,
        "yellow",
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("database");
      expect(stdout).toContain("yellow");

      // Reset
      await fetch(`${baseUrl}/state/${NS}/database/green`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
    });

    test("set with --reason and --solution", async () => {
      const { stdout: _stdout, exitCode } = await cli([
        "set",
        "database",
        "red",
        "--reason",
        "connection pool exhausted",
        "--solution",
        "Restart the connection pool",
      ]);
      expect(exitCode).toBe(0);

      const res = await fetch(`${baseUrl}/nodes/${NS}/database`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      expect(data.state).toBe("red");
      expect(data.reason).toBe("connection pool exhausted");
      expect(data.solution).toBe("Restart the connection pool");

      // Reset
      await fetch(`${baseUrl}/state/${NS}/database/green`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
    });

    test("invalid state returns error", async () => {
      const { stderr, exitCode } = await cli(["set", "database", "purple"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Invalid state");
    });

    test("missing args returns error", async () => {
      const { stderr, exitCode } = await cli(["set", "database"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Usage");
    });
  });

  describe("graph", () => {
    test("prints dependency tree", async () => {
      const { stdout, exitCode } = await cli(["graph"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("database");
      expect(stdout).toContain("api-server");
      expect(stdout).toContain("worker");
      // Should have tree connectors
      expect(stdout).toMatch(/[├└│]/);
    });
  });

  describe("validate", () => {
    const validateDir = join(tmpDir, "validate-test");

    beforeEach(() => {
      if (!existsSync(validateDir)) mkdirSync(validateDir, { recursive: true });
    });

    afterEach(() => {
      const f = join(validateDir, "depends.yml");
      if (existsSync(f)) unlinkSync(f);
    });

    test("valid YAML passes", async () => {
      writeFileSync(
        join(validateDir, "depends.yml"),
        `namespace: test\nnodes:\n  a:\n    depends_on: [b]\n  b: {}\n`,
      );
      const { stdout, exitCode } = await cli(["validate"], {
        cwd: validateDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("valid");
      expect(stdout).toContain("2 nodes");
    });

    test("detects cycles", async () => {
      writeFileSync(
        join(validateDir, "depends.yml"),
        `namespace: test\nnodes:\n  a:\n    depends_on: [b]\n  b:\n    depends_on: [a]\n`,
      );
      const { stderr, exitCode } = await cli(["validate"], {
        cwd: validateDir,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Cycle");
    });

    test("warns on missing refs", async () => {
      writeFileSync(
        join(validateDir, "depends.yml"),
        `namespace: test\nnodes:\n  a:\n    depends_on: [external]\n`,
      );
      const { stdout, exitCode } = await cli(["validate"], {
        cwd: validateDir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Warning");
      expect(stdout).toContain("external");
    });

    test("missing namespace is an error", async () => {
      writeFileSync(join(validateDir, "depends.yml"), `nodes:\n  a: {}\n`);
      const { stderr, exitCode } = await cli(["validate"], {
        cwd: validateDir,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("namespace");
    });

    test("no depends.yml is an error", async () => {
      const emptyDir = join(tmpDir, "empty-validate");
      if (!existsSync(emptyDir)) mkdirSync(emptyDir, { recursive: true });
      const { stderr, exitCode } = await cli(["validate"], { cwd: emptyDir });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("No depends.yml");
    });
  });

  describe("push", () => {
    const pushDir = join(tmpDir, "push-test");

    beforeEach(() => {
      if (!existsSync(pushDir)) mkdirSync(pushDir, { recursive: true });
    });

    afterEach(() => {
      const f = join(pushDir, "depends.yml");
      if (existsSync(f)) unlinkSync(f);
    });

    test("pushes depends.yml to server (auto-creates namespace)", async () => {
      writeFileSync(
        join(pushDir, "depends.yml"),
        `namespace: ${NS}\nnodes:\n  push-test-node:\n    label: Push Test\n`,
      );

      const { stdout, exitCode } = await cli(["push"], { cwd: pushDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Pushed");

      // Verify node exists
      const res = await fetch(`${baseUrl}/nodes/${NS}/push-test-node`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.label).toBe("Push Test");
    });

    test("no depends.yml returns error", async () => {
      const emptyDir = join(tmpDir, "empty-push");
      if (!existsSync(emptyDir)) mkdirSync(emptyDir, { recursive: true });
      const { stderr, exitCode } = await cli(["push"], { cwd: emptyDir });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("No depends.yml");
    });
  });

  describe("pull", () => {
    const pullDir = join(tmpDir, "pull-test");

    beforeEach(() => {
      if (!existsSync(pullDir)) mkdirSync(pullDir, { recursive: true });
    });

    afterEach(() => {
      const f = join(pullDir, "depends.yml");
      if (existsSync(f)) unlinkSync(f);
    });

    test("pulls graph into depends.yml", async () => {
      const { stdout, exitCode } = await cli(["pull"], { cwd: pullDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Pulled");

      const content = readFileSync(join(pullDir, "depends.yml"), "utf-8");
      expect(content).toContain("namespace:");
      expect(content).toContain("database");
    });
  });

  describe("diff", () => {
    const diffDir = join(tmpDir, "diff-test");

    beforeEach(() => {
      if (!existsSync(diffDir)) mkdirSync(diffDir, { recursive: true });
    });

    afterEach(() => {
      const f = join(diffDir, "depends.yml");
      if (existsSync(f)) unlinkSync(f);
    });

    test("shows new nodes", async () => {
      writeFileSync(
        join(diffDir, "depends.yml"),
        `namespace: ${NS}\nnodes:\n  database:\n    label: PostgreSQL\n  brand-new-node:\n    label: New\n    depends_on:\n      - database\n`,
      );

      const { stdout, exitCode } = await cli(["diff"], { cwd: diffDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("brand-new-node");
      expect(stdout).toContain("new");
    });

    test("no changes shows clean message", async () => {
      // First pull to get exact remote state
      await cli(["pull"], { cwd: diffDir });
      const { stdout, exitCode } = await cli(["diff"], { cwd: diffDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("No structural changes");
    });
  });

  describe("config", () => {
    test("missing token falls back to local mode", async () => {
      const { stderr, exitCode } = await cli(["status"], {
        env: { DEPENDS_TOKEN: "", DEPENDS_NAMESPACE: NS },
      });
      expect(exitCode).toBe(0);
      expect(stderr).toContain("local mode");
    });

    test("missing namespace shows helpful error", async () => {
      const noNsDir = join(tmpDir, "no-ns");
      if (!existsSync(noNsDir)) mkdirSync(noNsDir, { recursive: true });
      const { stderr, exitCode } = await cli(["status"], {
        cwd: noNsDir,
        env: { DEPENDS_NAMESPACE: "" },
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("No namespace");
    });
  });
});
