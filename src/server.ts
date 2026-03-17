import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { join } from "path";
import { appendFileSync, mkdirSync } from "fs";
import { createDb } from "./db";
import { verifyToken, verifyTokenOnly, LOCAL_TOKEN, type AuthResult } from "./auth";
import { render } from "./render";
import { handleSignup, handleCreateNamespace, handleDeleteNamespace } from "./routes/namespaces";
import { handlePutNode, handleGetNode, handleDeleteNode, handleListNodes } from "./routes/nodes";
import { handlePutState } from "./routes/state";
import { handleGetEvents } from "./routes/events";
import { handleGetGraph, handleGetSubgraph, handleGetUpstream, handleGetDownstream, handlePutGraph } from "./routes/graph";
import { handlePutNotification, handleListNotifications, handleDeleteNotification, handleAckNotification } from "./routes/notifications";
import { handleGetUsage } from "./routes/usage";
import { rateLimit } from "./ratelimit";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const LOG_DIR = join(import.meta.dir, "..", "log");
mkdirSync(LOG_DIR, { recursive: true });

function logRequest(entry: Record<string, unknown>) {
  const date = new Date().toISOString().slice(0, 10);
  appendFileSync(join(LOG_DIR, `${date}.log`), JSON.stringify(entry) + "\n");
}

/** Extract bearer token from request, returning 401 response on failure */
function extractBearer(request: Request): string | Response {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Missing authorization." }, { status: 401 });
  }
  return authHeader.slice(7);
}

const LOCALHOST_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function isLocalRequest(request: Request, server: unknown): boolean {
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) {
    const clientIp = forwarded.split(",")[0].trim();
    return LOCALHOST_ADDRS.has(clientIp);
  }
  if (!server || typeof (server as Record<string, unknown>).requestIP !== "function") return false;
  const ip = (server as { requestIP(req: Request): { address: string } | null }).requestIP(request);
  return ip ? LOCALHOST_ADDRS.has(ip.address) : false;
}

function ensureLocalToken(db: Database) {
  db.query(
    "INSERT OR IGNORE INTO tokens (id, token_hash, plan) VALUES (0, 'local', 'enterprise')"
  ).run();
}

function basicAuthChallenge(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="depends.cc"' },
  });
}

async function authenticateBasic(
  db: Database,
  namespace: string,
  request: Request,
  isLocal: boolean
): Promise<AuthResult | Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Basic ")) return basicAuthChallenge();

  const decoded = atob(authHeader.slice(6));
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return basicAuthChallenge();

  const token = decoded.slice(colonIdx + 1);

  const auth = await verifyToken(db, namespace, token, isLocal);
  if (!auth) return basicAuthChallenge();
  return auth;
}

async function formatNodesAsText(jsonRes: Response): Promise<Response> {
  const nodes = await jsonRes.json() as Array<{ id: string; state: string; effective_state: string; label: string | null; reason: string | null }>;
  if (nodes.length === 0) return new Response("No nodes in this namespace.\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const maxId = Math.max(...nodes.map((n) => n.id.length));
  const lines = nodes.map((n) => {
    const id = n.id.padEnd(maxId);
    const eff = n.state !== n.effective_state ? ` (effective: ${n.effective_state})` : "";
    const label = n.label ? ` ${n.label}` : "";
    const reason = n.reason ? ` — ${n.reason}` : "";
    return `  ${id}  ${n.state}${eff}${label}${reason}`;
  });
  return new Response(lines.join("\n") + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function formatNodeAsText(jsonRes: Response): Promise<Response> {
  if (jsonRes.status === 404) return new Response("Node not found.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const n = await jsonRes.json() as { id: string; state: string; effective_state: string; label: string | null; reason: string | null; solution: string | null; depends_on: string[]; depended_on_by: string[] };
  const lines: string[] = [];
  lines.push(`${n.id}  ${n.state}${n.state !== n.effective_state ? ` (effective: ${n.effective_state})` : ""}`);
  if (n.label) lines.push(`  label: ${n.label}`);
  if (n.reason) lines.push(`  reason: ${n.reason}`);
  if (n.solution) lines.push(`  solution: ${n.solution}`);
  if (n.depends_on.length > 0) lines.push(`  depends_on: ${n.depends_on.join(", ")}`);
  if (n.depended_on_by.length > 0) lines.push(`  depended_on_by: ${n.depended_on_by.join(", ")}`);
  return new Response(lines.join("\n") + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Helper to extract auth from store */
function auth(store: unknown): AuthResult {
  return (store as { auth: AuthResult }).auth;
}

export function createApp(db: Database) {
  ensureLocalToken(db);

  const app = new Elysia()
    // Request logging
    .derive(({ request }) => {
      return { requestStart: Date.now(), requestUrl: new URL(request.url) };
    })
    .onAfterResponse(({ request, requestStart, requestUrl, set }) => {
      const url = requestUrl ?? new URL(request.url);
      if (url.pathname === "/favicon.png" || url.pathname === "/logo.png") return;
      logRequest({
        ts: new Date().toISOString(),
        method: request.method,
        path: url.pathname,
        query: url.search || undefined,
        status: set.status ?? 200,
        ms: Date.now() - (requestStart ?? Date.now()),
      });
    })

    // Rate limiting (skip for local requests)
    .onBeforeHandle(({ request, server }) => {
      if (isLocalRequest(request, server)) return;
      const forwarded = request.headers.get("X-Forwarded-For");
      const ip = forwarded
        ? forwarded.split(",")[0].trim()
        : ((server as { requestIP?(req: Request): { address: string } | null })?.requestIP?.(request)?.address ?? "unknown");
      return rateLimit(ip) ?? undefined;
    })

    // Static files
    .get("/favicon.png", () => Bun.file(join(PUBLIC_DIR, "favicon.png")))
    .get("/logo.png", () => Bun.file(join(PUBLIC_DIR, "logo.png")))
    .get("/llms.txt", () => new Response(Bun.file(join(PUBLIC_DIR, "llms.txt")), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }))
    .get("/install.sh", () => new Response(Bun.file(join(PUBLIC_DIR, "install.sh")), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }))

    // Homepage
    .get("/", () => render("index", { title: "depends.cc — dependency state tracking" }))
    .get("/pricing", () => render("pricing", { title: "Pricing — depends.cc" }))
    .get("/signup", () => render("signup", { title: "Sign up — depends.cc" }))
    .get("/license", () => render("license", { title: "License — depends.cc" }))
    .get("/privacy", () => render("privacy", { title: "Privacy — depends.cc" }))
    .get("/terms", () => render("terms", { title: "Terms — depends.cc" }))
    .get("/mcp", () => render("mcp", { title: "MCP Server — depends.cc" }))

    // Docs
    .get("/docs", ({ request }) => {
      const accept = request.headers.get("Accept") ?? "";
      if (accept.includes("application/json")) {
        return Response.json({
          cli: {
            install: "curl -fsSL https://depends.cc/install.sh | sh",
            commands: {
              "serve [-p <port>]": "Run the server locally (default: 3000)",
              "signup": "Create account, get token (auto-saved)",
              "init": "Scaffold depends.yml from current directory name",
              "push [--prune]": "Upload depends.yml (auto-creates namespace)",
              "pull": "Download remote graph into depends.yml",
              "status [<ns/node>] [--json]": "Show node states",
              "set [<ns/>]<node> <state> [--reason] [--solution]": "Set state (green/yellow/red)",
              "graph": "Print dependency tree",
              "validate": "Check depends.yml for errors and cycles",
              "diff": "Show what would change on push",
              "delete": "Delete namespace and all its data",
            },
            config: {
              env: ["DEPENDS_TOKEN", "DEPENDS_NAMESPACE", "DEPENDS_API_URL"],
              file: "~/.depends/config.yml (token, default_namespace, api_url)",
              local_mode: "No token → uses dep_local against localhost:3000",
            },
          },
          api: {
            base: "/v1",
            auth: "Bearer token in Authorization header",
            endpoints: [
              { method: "POST", path: "/v1/signup", auth: false, description: "Create account, returns token" },
              { method: "POST", path: "/v1/namespaces", auth: "token", description: "Create namespace", body: { id: "string" } },
              { method: "DELETE", path: "/v1/namespaces/:namespace", auth: "namespace", description: "Delete namespace and all data" },
              { method: "GET", path: "/v1/nodes/:namespace", auth: "namespace", description: "List all nodes" },
              { method: "GET", path: "/v1/nodes/:namespace/:nodeId", auth: "namespace", description: "Get single node detail" },
              { method: "PUT", path: "/v1/nodes/:namespace/:nodeId", auth: "namespace", description: "Create/update node", body: { label: "string?", depends_on: "string[]?", default_state: "string?", meta: "string?", ttl: "string?" } },
              { method: "DELETE", path: "/v1/nodes/:namespace/:nodeId", auth: "namespace", description: "Delete node" },
              { method: "PUT", path: "/v1/state/:namespace/:nodeId/:state", auth: "namespace", description: "Set node state (green/yellow/red)", headers: { "X-Depends-Reason": "string?", "X-Depends-Solution": "string?" } },
              { method: "GET", path: "/v1/events/:namespace[/:nodeId]", auth: "namespace", description: "List state change events", query: { limit: "number?", since: "ISO date?", until: "ISO date?" } },
              { method: "GET", path: "/v1/graph/:namespace", auth: "namespace", description: "Get full graph (add ?format=yaml for YAML)" },
              { method: "PUT", path: "/v1/graph/:namespace", auth: "namespace", description: "Upload YAML graph (?prune=true to remove unlisted nodes)", content_type: "application/yaml" },
              { method: "GET", path: "/v1/graph/:namespace/:nodeId", auth: "namespace", description: "Get subgraph for node" },
              { method: "GET", path: "/v1/graph/:namespace/:nodeId/upstream", auth: "namespace", description: "Get transitive dependencies" },
              { method: "GET", path: "/v1/graph/:namespace/:nodeId/downstream", auth: "namespace", description: "Get transitive dependents" },
              { method: "GET", path: "/v1/notifications/:namespace", auth: "namespace", description: "List notification rules" },
              { method: "PUT", path: "/v1/notifications/:namespace", auth: "namespace", description: "Create/update notification rule", body: { id: "string", url: "string", watch: "string? (default: *)", on: "string? (default: red)", secret: "string?", ack: "boolean?" } },
              { method: "DELETE", path: "/v1/notifications/:namespace/:ruleId", auth: "namespace", description: "Delete notification rule" },
              { method: "POST", path: "/v1/notifications/:namespace/:ruleId/ack", auth: "namespace", description: "Acknowledge/un-suppress rule" },
              { method: "GET", path: "/v1/usage/:namespace", auth: "namespace", description: "Get usage stats and plan limits" },
            ],
          },
        });
      }
      return render("docs", { title: "Docs — depends.cc" });
    })

    // Namespace status via Basic Auth
    .get("/ns/*", async ({ params, request, server }) => {
      const parts = params["*"].split("/");
      if (parts.length < 1 || !parts[0]) return new Response("Not Found", { status: 404 });
      const isLocal = isLocalRequest(request, server);

      // Single node: /ns/:namespace/:node[.json]
      if (parts.length >= 2 && parts[1]) {
        const nd = parts[1];
        const json = nd.endsWith(".json");
        const nodeId = json ? nd.slice(0, -5) : nd;
        const a = await authenticateBasic(db, parts[0], request, isLocal);
        if (a instanceof Response) return a;
        const res = handleGetNode(db, a.nsId, parts[0], nodeId);
        if (json) return res;
        return formatNodeAsText(res);
      }

      // All nodes: /ns/:namespace[.json|.yaml]
      const ns = parts[0];
      const format = ns.endsWith(".json") ? "json" : ns.endsWith(".yaml") ? "yaml" : "text";
      const namespace = format !== "text" ? ns.slice(0, ns.lastIndexOf(".")) : ns;
      const a = await authenticateBasic(db, namespace, request, isLocal);
      if (a instanceof Response) return a;
      if (format === "json") return handleListNodes(db, a.nsId, namespace);
      if (format === "yaml") {
        const { exportYaml } = await import("./graph/yaml");
        return new Response(exportYaml(db, a.nsId, namespace), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      return formatNodesAsText(handleListNodes(db, a.nsId, namespace));
    })

    // Unauthenticated: signup
    .post("/v1/signup", ({ request }) => handleSignup(db, request))

    // Unauthenticated: ack via token link
    .get("/v1/ack/:token", ({ params }) => {
      const rule = db.query(
        "SELECT ns_id, id FROM notification_rules WHERE ack_token = ?"
      ).get(params.token) as { ns_id: number; id: string } | null;
      if (!rule) {
        return render("ack", { title: "Acknowledge — depends.cc", success: false });
      }
      db.query(
        "UPDATE notification_rules SET suppressed = 0 WHERE ns_id = ? AND id = ?"
      ).run(rule.ns_id, rule.id);
      // Look up namespace name for display
      const ns = db.query("SELECT id FROM namespaces WHERE ns_id = ?").get(rule.ns_id) as { id: string } | null;
      return render("ack", { title: "Acknowledge — depends.cc", success: true, rule_id: rule.id, namespace: ns?.id ?? "" });
    })

    // Token-only auth: create namespace
    .post("/v1/namespaces", async ({ request, server }) => {
      const bearer = extractBearer(request);
      if (bearer instanceof Response) return bearer;
      const local = isLocalRequest(request, server);
      const a = await verifyTokenOnly(db, bearer, local);
      if (!a) return Response.json({ error: "Invalid token." }, { status: 401 });
      return handleCreateNamespace(db, request, a.tokenId, a.plan);
    })

    // Namespace-scoped auth: all other routes
    .guard(
      {
        async beforeHandle({ request, params, store, server }) {
          const ns = (params as Record<string, string>).namespace;
          const bearer = extractBearer(request);
          if (bearer instanceof Response) return bearer;
          const local = isLocalRequest(request, server);
          if (local && bearer === LOCAL_TOKEN) {
            db.query("INSERT OR IGNORE INTO namespaces (id, token_id) VALUES (?, 0)").run(ns);
          }
          const a = await verifyToken(db, ns, bearer, local);
          if (!a) return Response.json({ error: "Invalid token." }, { status: 401 });
          (store as Record<string, unknown>).auth = a;
          (store as Record<string, unknown>).ns = ns;
        },
      },
      (app) =>
        app
          // Namespaces
          .delete("/v1/namespaces/:namespace", ({ store }) =>
            handleDeleteNamespace(db, auth(store).nsId)
          )

          // Nodes
          .get("/v1/nodes/:namespace", ({ params, store }) =>
            handleListNodes(db, auth(store).nsId, params.namespace)
          )
          .get("/v1/nodes/:namespace/:nodeId", ({ params, store }) =>
            handleGetNode(db, auth(store).nsId, params.namespace, params.nodeId)
          )
          .put("/v1/nodes/:namespace/:nodeId", ({ params, request, store }) =>
            handlePutNode(db, auth(store).nsId, params.namespace, params.nodeId, request, auth(store).plan)
          )
          .delete("/v1/nodes/:namespace/:nodeId", ({ params, store }) =>
            handleDeleteNode(db, auth(store).nsId, params.nodeId)
          )

          // State shorthand
          .put("/v1/state/:namespace/:nodeId/:state", ({ params, request, store }) =>
            handlePutState(db, auth(store).nsId, params.namespace, params.nodeId, params.state, request, auth(store).plan)
          )

          // Events
          .get("/v1/events/:namespace", ({ request, store }) =>
            handleGetEvents(db, auth(store).nsId, null, new URL(request.url))
          )
          .get("/v1/events/:namespace/:nodeId", ({ params, request, store }) =>
            handleGetEvents(db, auth(store).nsId, params.nodeId, new URL(request.url))
          )

          // Graph
          .get("/v1/graph/:namespace", ({ params, request, store }) =>
            handleGetGraph(db, auth(store).nsId, params.namespace, new URL(request.url))
          )
          .put("/v1/graph/:namespace", ({ params, request, store }) =>
            handlePutGraph(db, auth(store).nsId, params.namespace, request, auth(store).tokenId)
          )
          .get("/v1/graph/:namespace/:nodeId", ({ params, store }) =>
            handleGetSubgraph(db, auth(store).nsId, params.namespace, params.nodeId)
          )
          .get("/v1/graph/:namespace/:nodeId/upstream", ({ params, store }) =>
            handleGetUpstream(db, auth(store).nsId, params.namespace, params.nodeId)
          )
          .get("/v1/graph/:namespace/:nodeId/downstream", ({ params, store }) =>
            handleGetDownstream(db, auth(store).nsId, params.namespace, params.nodeId)
          )

          // Notifications
          .get("/v1/notifications/:namespace", ({ params, store }) =>
            handleListNotifications(db, auth(store).nsId, params.namespace)
          )
          .put("/v1/notifications/:namespace", ({ request, store }) =>
            handlePutNotification(db, auth(store).nsId, request, auth(store).tokenId)
          )
          .delete("/v1/notifications/:namespace/:ruleId", ({ params, store }) =>
            handleDeleteNotification(db, auth(store).nsId, params.ruleId)
          )
          .post("/v1/notifications/:namespace/:ruleId/ack", ({ params, store }) =>
            handleAckNotification(db, auth(store).nsId, params.ruleId)
          )

          // Usage
          .get("/v1/usage/:namespace", ({ params, store }) =>
            handleGetUsage(db, auth(store).nsId, params.namespace, auth(store).tokenId, auth(store).plan)
          )
    );

  return app;
}

export function createServer(db: Database, port: number = PORT) {
  const app = createApp(db);
  const instance = app.listen(port);

  return {
    port: instance.server!.port,
    stop(closeActiveConnections?: boolean) {
      instance.stop(closeActiveConnections);
    },
    app: instance,
  };
}

// Start server if run directly
if (import.meta.main) {
  const { purgeExpiredEvents } = await import("./purge");

  const db = createDb(join(import.meta.dir, "..", "data", "depends.db"));
  const server = createServer(db, PORT);
  console.log(`depends.cc listening on http://localhost:${server.port}`);

  setInterval(() => purgeExpiredEvents(db), 60 * 60 * 1000);
}
