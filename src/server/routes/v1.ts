import type { Database } from "bun:sqlite";
import type { Elysia } from "elysia";
import { LOCAL_TOKEN, verifyToken } from "../../auth";
import { render } from "../../render";
import { handleGetEvents } from "../../routes/events";
import {
  handleGetDownstream,
  handleGetGraph,
  handleGetSubgraph,
  handleGetUpstream,
  handlePutGraph,
} from "../../routes/graph";
import {
  handleCreateNamespace,
  handleDeleteNamespace,
  handleSignup,
} from "../../routes/namespaces";
import {
  handleDeleteNode,
  handleGetNode,
  handleListNodes,
  handlePutNode,
} from "../../routes/nodes";
import {
  handleAckNotification,
  handleDeleteNotification,
  handleListNotifications,
  handlePutNotification,
} from "../../routes/notifications";
import { handlePutState } from "../../routes/state";
import { handleGetUsage } from "../../routes/usage";
import {
  auth,
  extractBearer,
  isLocalRequest,
  isSelfHosted,
} from "../middleware";

export function registerV1Routes<T extends Elysia>(app: T, db: Database): T {
  return (
    app
      // Unauthenticated: signup
      .post("/v1/signup", ({ request }) => handleSignup(db, request))

      // Unauthenticated: ack via token link
      .get("/v1/ack/:token", ({ params }) => {
        const rule = db
          .query("SELECT ns_id, id FROM notification_rules WHERE ack_token = ?")
          .get(params.token) as { ns_id: number; id: string } | null;
        if (!rule) {
          return render("ack", {
            title: "Acknowledge — depends.cc",
            success: false,
          });
        }
        db.query(
          "UPDATE notification_rules SET suppressed = 0 WHERE ns_id = ? AND id = ?",
        ).run(rule.ns_id, rule.id);
        const ns = db
          .query("SELECT id FROM namespaces WHERE ns_id = ?")
          .get(rule.ns_id) as { id: string } | null;
        return render("ack", {
          title: "Acknowledge — depends.cc",
          success: true,
          rule_id: rule.id,
          namespace: ns?.id ?? "",
        });
      })

      // Token-only auth: create namespace
      .post("/v1/namespaces", async ({ request, server }) => {
        const bearer = extractBearer(request);
        if (bearer instanceof Response) return bearer;
        const local = isLocalRequest(request, server);
        const a = await verifyToken(db, bearer, { isLocal: local });
        if (!a)
          return Response.json({ error: "Invalid token." }, { status: 401 });
        return handleCreateNamespace(db, request, a.tokenId);
      })

      // Namespace-scoped auth: all other routes
      .guard(
        {
          async beforeHandle({ request, params, store, server }) {
            const ns = (params as Record<string, string>).namespace;
            const bearer = extractBearer(request);
            if (bearer instanceof Response) return bearer;
            const local = isLocalRequest(request, server);
            // In self-hosted mode, any token is accepted as the local token
            // and the namespace is auto-created on first access.
            const selfHosted = isSelfHosted();
            const effectiveBearer = selfHosted ? LOCAL_TOKEN : bearer;
            if (selfHosted || (local && bearer === LOCAL_TOKEN)) {
              db.query(
                "INSERT OR IGNORE INTO namespaces (id, token_id) VALUES (?, 0)",
              ).run(ns);
            }
            const a = await verifyToken(db, effectiveBearer, {
              namespace: ns,
              isLocal: local,
            });
            if (!a)
              return Response.json(
                { error: "Invalid token." },
                { status: 401 },
              );
            (store as Record<string, unknown>).auth = a;
            (store as Record<string, unknown>).ns = ns;
          },
        },
        (guarded) =>
          guarded
            // Namespaces
            .delete("/v1/namespaces/:namespace", ({ store }) =>
              handleDeleteNamespace(db, auth(store).nsId),
            )

            // Nodes
            .get("/v1/nodes/:namespace", ({ params, store }) =>
              handleListNodes(db, auth(store).nsId, params.namespace),
            )
            .get("/v1/nodes/:namespace/:nodeId", ({ params, store }) =>
              handleGetNode(
                db,
                auth(store).nsId,
                params.namespace,
                params.nodeId,
              ),
            )
            .put("/v1/nodes/:namespace/:nodeId", ({ params, request, store }) =>
              handlePutNode(
                db,
                auth(store).nsId,
                params.namespace,
                params.nodeId,
                request,
                auth(store).legendumToken,
              ),
            )
            .delete("/v1/nodes/:namespace/:nodeId", ({ params, store }) =>
              handleDeleteNode(db, auth(store).nsId, params.nodeId),
            )

            // State shorthand
            .put(
              "/v1/state/:namespace/:nodeId/:state",
              ({ params, request, store }) =>
                handlePutState(
                  db,
                  auth(store).nsId,
                  params.namespace,
                  params.nodeId,
                  params.state,
                  request,
                  auth(store).legendumToken,
                ),
            )

            // Events
            .get("/v1/events/:namespace", ({ request, store }) =>
              handleGetEvents(db, auth(store).nsId, null, new URL(request.url)),
            )
            .get(
              "/v1/events/:namespace/:nodeId",
              ({ params, request, store }) =>
                handleGetEvents(
                  db,
                  auth(store).nsId,
                  params.nodeId,
                  new URL(request.url),
                ),
            )

            // Graph
            .get("/v1/graph/:namespace", ({ params, request, store }) =>
              handleGetGraph(
                db,
                auth(store).nsId,
                params.namespace,
                new URL(request.url),
              ),
            )
            .put("/v1/graph/:namespace", ({ params, request, store }) =>
              handlePutGraph(
                db,
                auth(store).nsId,
                params.namespace,
                request,
                auth(store).tokenId,
                auth(store).legendumToken,
              ),
            )
            .get("/v1/graph/:namespace/:nodeId", ({ params, store }) =>
              handleGetSubgraph(
                db,
                auth(store).nsId,
                params.namespace,
                params.nodeId,
              ),
            )
            .get("/v1/graph/:namespace/:nodeId/upstream", ({ params, store }) =>
              handleGetUpstream(
                db,
                auth(store).nsId,
                params.namespace,
                params.nodeId,
              ),
            )
            .get(
              "/v1/graph/:namespace/:nodeId/downstream",
              ({ params, store }) =>
                handleGetDownstream(
                  db,
                  auth(store).nsId,
                  params.namespace,
                  params.nodeId,
                ),
            )

            // Notifications
            .get("/v1/notifications/:namespace", ({ params, store }) =>
              handleListNotifications(db, auth(store).nsId, params.namespace),
            )
            .put("/v1/notifications/:namespace", ({ request, store }) =>
              handlePutNotification(
                db,
                auth(store).nsId,
                request,
                auth(store).tokenId,
              ),
            )
            .delete(
              "/v1/notifications/:namespace/:ruleId",
              ({ params, store }) =>
                handleDeleteNotification(db, auth(store).nsId, params.ruleId),
            )
            .post(
              "/v1/notifications/:namespace/:ruleId/ack",
              ({ params, store }) =>
                handleAckNotification(db, auth(store).nsId, params.ruleId),
            )

            // Usage
            .get("/v1/usage/:namespace", ({ params, store }) =>
              handleGetUsage(
                db,
                auth(store).nsId,
                params.namespace,
                auth(store).tokenId,
              ),
            ),
      ) as T
  );
}
