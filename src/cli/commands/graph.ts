import { api, errorMsg } from "../lib/api";
import { COLORS } from "../lib/colors";
import { type Config, getNamespace } from "../lib/config";

interface GraphData {
  namespace: string;
  nodes: {
    id: string;
    state: string;
    effective_state: string;
    label: string | null;
    reason: string | null;
    solution: string | null;
  }[];
  edges: { from: string; to: string }[];
}

export async function cmdGraph(config: Config, args: string[]) {
  const ns = getNamespace(config, args);

  const res = await api(config, `/graph/${ns}`);
  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  const graph: GraphData = await res.json();

  if (graph.nodes.length === 0) {
    console.log("No nodes in this namespace.");
    return;
  }

  // Build adjacency: who depends on whom
  const dependsOn = new Map<string, string[]>();
  const dependedOnBy = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!dependsOn.has(edge.from)) dependsOn.set(edge.from, []);
    dependsOn.get(edge.from)!.push(edge.to);
    if (!dependedOnBy.has(edge.to)) dependedOnBy.set(edge.to, []);
    dependedOnBy.get(edge.to)!.push(edge.from);
  }

  // Find root nodes (no dependencies)
  const roots = graph.nodes
    .filter((n) => !dependsOn.has(n.id) || dependsOn.get(n.id)!.length === 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const printed = new Set<string>();

  function printTree(
    nodeId: string,
    prefix: string,
    isLast: boolean,
    isRoot: boolean,
  ) {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    const stateColor =
      COLORS[node.effective_state as keyof typeof COLORS] ?? "";
    const symbol = "●";
    const label = node.label ? ` (${node.label})` : "";
    const reason = node.reason ? ` — ${node.reason}` : "";

    console.log(
      `${prefix}${connector}${stateColor}${symbol}${COLORS.reset} ${node.id}${label}${reason}`,
    );

    if (printed.has(nodeId)) return;
    printed.add(nodeId);

    // Children = nodes that depend on this node
    const children = (dependedOnBy.get(nodeId) ?? []).sort();
    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
    for (let i = 0; i < children.length; i++) {
      printTree(children[i], childPrefix, i === children.length - 1, false);
    }
  }

  for (let i = 0; i < roots.length; i++) {
    printTree(roots[i].id, "", i === roots.length - 1, true);
  }
}
