import { Database } from "bun:sqlite";
import { computeEffectiveState, getUpstreamNodes, getDownstreamNodes } from "../graph/effective";
import { importYaml, exportYaml, parseYaml } from "../graph/yaml";

export function handleGetGraph(
  db: Database,
  nsId: number,
  namespace: string,
  url: URL
): Response {
  const format = url.searchParams.get("format");
  const stateFilter = url.searchParams.get("state");

  if (format === "yaml") {
    return new Response(exportYaml(db, nsId, namespace), {
      headers: { "Content-Type": "application/yaml" },
    });
  }

  return Response.json(buildGraph(db, nsId, namespace, stateFilter));
}

export function handleGetSubgraph(
  db: Database,
  nsId: number,
  namespace: string,
  nodeId: string
): Response {
  const node = db.query("SELECT id FROM nodes WHERE ns_id = ? AND id = ?").get(nsId, nodeId);
  if (!node) {
    return Response.json({ error: "Node not found." }, { status: 404 });
  }

  const upstream = getUpstreamNodes(db, nsId, nodeId);
  const downstream = getDownstreamNodes(db, nsId, nodeId);
  const nodeIds = new Set([nodeId, ...upstream, ...downstream]);

  return Response.json(buildGraphForNodes(db, nsId, namespace, nodeIds));
}

export function handleGetUpstream(
  db: Database,
  nsId: number,
  namespace: string,
  nodeId: string
): Response {
  const node = db.query("SELECT id FROM nodes WHERE ns_id = ? AND id = ?").get(nsId, nodeId);
  if (!node) {
    return Response.json({ error: "Node not found." }, { status: 404 });
  }

  const upstream = getUpstreamNodes(db, nsId, nodeId);
  const nodeIds = new Set([nodeId, ...upstream]);
  return Response.json(buildGraphForNodes(db, nsId, namespace, nodeIds));
}

export function handleGetDownstream(
  db: Database,
  nsId: number,
  namespace: string,
  nodeId: string
): Response {
  const node = db.query("SELECT id FROM nodes WHERE ns_id = ? AND id = ?").get(nsId, nodeId);
  if (!node) {
    return Response.json({ error: "Node not found." }, { status: 404 });
  }

  const downstream = getDownstreamNodes(db, nsId, nodeId);
  const nodeIds = new Set([nodeId, ...downstream]);
  return Response.json(buildGraphForNodes(db, nsId, namespace, nodeIds));
}

export async function handlePutGraph(
  db: Database,
  nsId: number,
  namespace: string,
  req: Request,
  tokenId: number,
  legendumToken: string | null
): Promise<Response> {
  const url = new URL(req.url);
  const prune = url.searchParams.get("prune") === "true";

  const yamlContent = await req.text();

  try {
    const spec = parseYaml(yamlContent);

    if (spec.namespace !== namespace) {
      return Response.json(
        { error: `YAML namespace "${spec.namespace}" doesn't match URL namespace "${namespace}".` },
        { status: 400 }
      );
    }

    await importYaml(db, nsId, spec, prune, tokenId, legendumToken);
    return Response.json({ ok: true });
  } catch (e: any) {
    if (e.code === "insufficient_funds") {
      return Response.json(
        { error: "Insufficient credits. Buy more at legendum.co.uk/account" },
        { status: 402 }
      );
    }
    const message = e instanceof Error ? e.message : "Invalid YAML";
    const status = message.includes("Cycle") ? 409 : 400;
    return Response.json({ error: message }, { status });
  }
}

function buildGraph(
  db: Database,
  nsId: number,
  namespace: string,
  stateFilter: string | null
) {
  const allNodes = db
    .query("SELECT * FROM nodes WHERE ns_id = ? ORDER BY id")
    .all(nsId) as { id: string; state: string; label?: string | null; reason?: string | null; solution?: string | null }[];

  const nodes = allNodes.map((n) => ({
    id: n.id,
    state: n.state,
    effective_state: computeEffectiveState(db, nsId, n.id),
    label: n.label ?? null,
    reason: n.reason ?? null,
    solution: n.solution ?? null,
  }));

  const filteredNodes = stateFilter
    ? nodes.filter((n) => n.effective_state === stateFilter)
    : nodes;

  const nodeIds = new Set(filteredNodes.map((n) => n.id));

  const edges = db
    .query("SELECT from_node, to_node FROM edges WHERE ns_id = ? ORDER BY from_node, to_node")
    .all(nsId) as { from_node: string; to_node: string }[];

  const filteredEdges = stateFilter
    ? edges.filter((e) => nodeIds.has(e.from_node) && nodeIds.has(e.to_node))
    : edges;

  return {
    namespace,
    nodes: filteredNodes,
    edges: filteredEdges.map((e) => ({ from: e.from_node, to: e.to_node })),
  };
}

function buildGraphForNodes(
  db: Database,
  nsId: number,
  namespace: string,
  nodeIds: Set<string>
) {
  const nodes = [];
  for (const id of nodeIds) {
    const node = db
      .query("SELECT state, label, reason, solution FROM nodes WHERE ns_id = ? AND id = ?")
      .get(nsId, id) as { state: string; label?: string | null; reason?: string | null; solution?: string | null } | null;
    if (node) {
      nodes.push({
        id,
        state: node.state,
        effective_state: computeEffectiveState(db, nsId, id),
        label: node.label ?? null,
        reason: node.reason ?? null,
        solution: node.solution ?? null,
      });
    }
  }

  const edges = db
    .query("SELECT from_node, to_node FROM edges WHERE ns_id = ? ORDER BY from_node, to_node")
    .all(nsId) as { from_node: string; to_node: string }[];

  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.from_node) && nodeIds.has(e.to_node)
  );

  return {
    namespace,
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: filteredEdges.map((e) => ({ from: e.from_node, to: e.to_node })),
  };
}
