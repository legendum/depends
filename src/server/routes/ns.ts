import type { Database } from "bun:sqlite";
import type { Elysia } from "elysia";
import { handleGetGraph } from "../../routes/graph";
import { handleGetNode, handleListNodes } from "../../routes/nodes";
import { formatNodeAsText, formatNodesAsText } from "../format";
import { authenticateBasic, isLocalRequest } from "../middleware";

export function registerNsRoutes<T extends Elysia>(app: T, db: Database): T {
  return app.get("/ns/*", async ({ params, request, server }) => {
    const parts = params["*"].split("/");
    if (parts.length < 1 || !parts[0])
      return new Response("Not Found", { status: 404 });
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

    // All nodes: /ns/:namespace[.json|.yaml|.svg]
    const ns = parts[0];
    const format = ns.endsWith(".json")
      ? "json"
      : ns.endsWith(".yaml")
        ? "yaml"
        : ns.endsWith(".svg")
          ? "svg"
          : "text";
    const namespace = format !== "text" ? ns.slice(0, ns.lastIndexOf(".")) : ns;
    const a = await authenticateBasic(db, namespace, request, isLocal);
    if (a instanceof Response) return a;
    if (format === "json") return handleListNodes(db, a.nsId, namespace);
    if (format === "yaml") {
      const { exportYaml } = await import("../../graph/yaml");
      return new Response(exportYaml(db, a.nsId, namespace), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (format === "svg") {
      const { renderSvg } = await import("../../graph/svg");
      const graph = await handleGetGraph(
        db,
        a.nsId,
        namespace,
        new URL(request.url),
      ).json();
      return new Response(renderSvg(graph), {
        headers: { "Content-Type": "image/svg+xml" },
      });
    }
    return formatNodesAsText(handleListNodes(db, a.nsId, namespace));
  }) as T;
}
