import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { join } from "path";
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

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

/** Extract bearer token from request, returning 401 response on failure */
function extractBearer(request: Request): string | Response {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Missing authorization." }, { status: 401 });
  }
  return authHeader.slice(7);
}

const LOCALHOST_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

/** Check if request comes from localhost (supports X-Forwarded-For behind reverse proxy) */
function isLocalRequest(request: Request, server: unknown): boolean {
  // Check X-Forwarded-For first (reverse proxy)
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) {
    const clientIp = forwarded.split(",")[0].trim();
    return LOCALHOST_ADDRS.has(clientIp);
  }
  // Fall back to direct connection IP
  if (!server || typeof (server as Record<string, unknown>).requestIP !== "function") return false;
  const ip = (server as { requestIP(req: Request): { address: string } | null }).requestIP(request);
  return ip ? LOCALHOST_ADDRS.has(ip.address) : false;
}

/** Ensure the well-known local token and namespace exist for dep_local auth. */
function ensureLocalToken(db: Database) {
  db.query(
    "INSERT OR IGNORE INTO tokens (id, token_hash, plan) VALUES ('local', 'local', 'enterprise')"
  ).run();
}

export function createApp(db: Database) {
  ensureLocalToken(db);

  const app = new Elysia()
    // Static files
    .get("/favicon.png", () => Bun.file(join(PUBLIC_DIR, "favicon.png")))
    .get("/logo.png", () => Bun.file(join(PUBLIC_DIR, "logo.png")))

    // Homepage
    .get("/", () => render("index", { title: "depends.cc — dependency state tracking" }))

    // Unauthenticated: signup (creates a token)
    .post("/v1/signup", ({ request }) => handleSignup(db, request))

    // Token-only auth: create namespace (namespace doesn't exist yet)
    .post("/v1/namespaces", async ({ request, server }) => {
      const bearer = extractBearer(request);
      if (bearer instanceof Response) return bearer;
      const local = isLocalRequest(request, server);
      const auth = await verifyTokenOnly(db, bearer, local);
      if (!auth) return Response.json({ error: "Invalid token." }, { status: 401 });
      return handleCreateNamespace(db, request, auth.tokenId, auth.plan);
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
            // Auto-create namespace for local dev
            db.query("INSERT OR IGNORE INTO namespaces (id, token_id) VALUES (?, 'local')").run(ns);
          }
          const auth = await verifyToken(db, ns, bearer, local);
          if (!auth) return Response.json({ error: "Invalid token." }, { status: 401 });
          (store as Record<string, unknown>).auth = auth;
        },
      },
      (app) =>
        app
          // Namespaces
          .delete("/v1/namespaces/:namespace", ({ params }) =>
            handleDeleteNamespace(db, params.namespace)
          )

          // Nodes
          .get("/v1/nodes/:namespace", ({ params }) =>
            handleListNodes(db, params.namespace)
          )
          .get("/v1/nodes/:namespace/:nodeId", ({ params }) =>
            handleGetNode(db, params.namespace, params.nodeId)
          )
          .put("/v1/nodes/:namespace/:nodeId", ({ params, request, store }) =>
            handlePutNode(db, params.namespace, params.nodeId, request, (store as { auth: AuthResult }).auth.plan)
          )
          .delete("/v1/nodes/:namespace/:nodeId", ({ params }) =>
            handleDeleteNode(db, params.namespace, params.nodeId)
          )

          // State shorthand
          .put("/v1/state/:namespace/:nodeId/:state", ({ params, request, store }) =>
            handlePutState(db, params.namespace, params.nodeId, params.state, request, (store as { auth: AuthResult }).auth.plan)
          )

          // Events
          .get("/v1/events/:namespace", ({ params, request }) =>
            handleGetEvents(db, params.namespace, null, new URL(request.url))
          )
          .get("/v1/events/:namespace/:nodeId", ({ params, request }) =>
            handleGetEvents(db, params.namespace, params.nodeId, new URL(request.url))
          )

          // Graph
          .get("/v1/graph/:namespace", ({ params, request }) =>
            handleGetGraph(db, params.namespace, new URL(request.url))
          )
          .put("/v1/graph/:namespace", ({ params, request }) =>
            handlePutGraph(db, params.namespace, request)
          )
          .get("/v1/graph/:namespace/:nodeId", ({ params }) =>
            handleGetSubgraph(db, params.namespace, params.nodeId)
          )
          .get("/v1/graph/:namespace/:nodeId/upstream", ({ params }) =>
            handleGetUpstream(db, params.namespace, params.nodeId)
          )
          .get("/v1/graph/:namespace/:nodeId/downstream", ({ params }) =>
            handleGetDownstream(db, params.namespace, params.nodeId)
          )

          // Notifications
          .get("/v1/notifications/:namespace", ({ params }) =>
            handleListNotifications(db, params.namespace)
          )
          .put("/v1/notifications/:namespace", ({ params, request }) =>
            handlePutNotification(db, params.namespace, request)
          )
          .delete("/v1/notifications/:namespace/:ruleId", ({ params }) =>
            handleDeleteNotification(db, params.namespace, params.ruleId)
          )
          .post("/v1/notifications/:namespace/:ruleId/ack", ({ params }) =>
            handleAckNotification(db, params.namespace, params.ruleId)
          )

          // Usage
          .get("/v1/usage/:namespace", ({ params, store }) =>
            handleGetUsage(db, params.namespace, (store as { auth: AuthResult }).auth.plan)
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
  const db = createDb(join(import.meta.dir, "..", "data", "depends.db"));
  const server = createServer(db, PORT);
  console.log(`depends.cc listening on http://localhost:${server.port}`);
}
