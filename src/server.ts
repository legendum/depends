import { Database } from "bun:sqlite";
import { createDb } from "./db";
import { verifyToken } from "./auth";
import { handleCreateNamespace, handleDeleteNamespace } from "./routes/namespaces";
import { handlePutNode, handleGetNode, handleDeleteNode, handleListNodes } from "./routes/nodes";
import { handlePutState } from "./routes/state";
import { handleGetEvents } from "./routes/events";
import { handleGetGraph, handleGetSubgraph, handleGetUpstream, handleGetDownstream, handlePutGraph } from "./routes/graph";
import { handlePutNotification, handleListNotifications, handleDeleteNotification, handleAckNotification } from "./routes/notifications";
import { handleGetUsage } from "./routes/usage";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

export function createServer(db: Database, port: number = PORT) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // Route: POST /v1/namespaces (unauthenticated)
      if (path === "/v1/namespaces" && method === "POST") {
        return handleCreateNamespace(db, req);
      }

      // All other routes require auth
      const segments = path.split("/").filter(Boolean);
      // segments[0] = "v1", segments[1] = resource, segments[2] = namespace, ...

      if (segments[0] !== "v1" || segments.length < 3) {
        return Response.json({ error: "Not found." }, { status: 404 });
      }

      const resource = segments[1];
      const namespace = segments[2];

      // Verify auth
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return Response.json({ error: "Missing authorization." }, { status: 401 });
      }
      const token = authHeader.slice(7);
      const valid = await verifyToken(db, namespace, token);
      if (!valid) {
        return Response.json({ error: "Invalid token." }, { status: 401 });
      }

      // Route dispatch
      switch (resource) {
        case "namespaces": {
          if (method === "DELETE" && segments.length === 3) {
            return handleDeleteNamespace(db, namespace);
          }
          break;
        }

        case "nodes": {
          const nodeId = segments[3];
          if (method === "GET" && !nodeId) return handleListNodes(db, namespace);
          if (method === "GET" && nodeId) return handleGetNode(db, namespace, nodeId);
          if (method === "PUT" && nodeId) return handlePutNode(db, namespace, nodeId, req);
          if (method === "DELETE" && nodeId) return handleDeleteNode(db, namespace, nodeId);
          break;
        }

        case "state": {
          const nodeId = segments[3];
          if (method === "PUT" && nodeId) return handlePutState(db, namespace, nodeId, req);
          break;
        }

        case "events": {
          const nodeId = segments[3] ?? null;
          if (method === "GET") return handleGetEvents(db, namespace, nodeId, url);
          break;
        }

        case "graph": {
          const nodeId = segments[3];
          const sub = segments[4];
          if (method === "PUT" && !nodeId) return handlePutGraph(db, namespace, req);
          if (method === "GET" && !nodeId) return handleGetGraph(db, namespace, url);
          if (method === "GET" && nodeId && sub === "upstream") return handleGetUpstream(db, namespace, nodeId);
          if (method === "GET" && nodeId && sub === "downstream") return handleGetDownstream(db, namespace, nodeId);
          if (method === "GET" && nodeId) return handleGetSubgraph(db, namespace, nodeId);
          break;
        }

        case "notifications": {
          const ruleId = segments[3];
          const action = segments[4];
          if (method === "PUT" && !ruleId) return handlePutNotification(db, namespace, req);
          if (method === "GET" && !ruleId) return handleListNotifications(db, namespace);
          if (method === "DELETE" && ruleId && !action) return handleDeleteNotification(db, namespace, ruleId);
          if (method === "POST" && ruleId && action === "ack") return handleAckNotification(db, namespace, ruleId);
          break;
        }

        case "usage": {
          if (method === "GET") return handleGetUsage(db, namespace);
          break;
        }
      }

      return Response.json({ error: "Not found." }, { status: 404 });
    },
  });
}

// Start server if run directly
if (import.meta.main) {
  const db = createDb();
  const server = createServer(db, PORT);
  console.log(`depends.cc listening on http://localhost:${server.port}`);
}
