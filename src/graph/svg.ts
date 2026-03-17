import dagre from "@dagrejs/dagre";

interface GraphNode {
  id: string;
  state: string;
  effective_state: string;
  label: string | null;
  reason: string | null;
}

interface GraphEdge {
  from: string;
  to: string;
}

interface GraphData {
  namespace: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const STATE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  green:  { fill: "#64d177", stroke: "#4caf50", text: "#1b5e20" },
  yellow: { fill: "#ff9800", stroke: "#f57c00", text: "#4e2c00" },
  red:    { fill: "#f44336", stroke: "#d32f2f", text: "#fff" },
};

const NODE_PADDING_X = 16;
const NODE_PADDING_Y = 10;
const CHAR_WIDTH = 7.5;  // approximate for 13px sans-serif
const LINE_HEIGHT = 16;
const MIN_NODE_WIDTH = 80;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function measureNode(node: GraphNode): { width: number; height: number; lines: string[] } {
  const lines: string[] = [node.id];
  if (node.label) lines.push(node.label);
  if (node.state !== node.effective_state) lines.push(`effective: ${node.effective_state}`);

  const maxLen = Math.max(...lines.map((l) => l.length));
  const width = Math.max(MIN_NODE_WIDTH, maxLen * CHAR_WIDTH + NODE_PADDING_X * 2);
  const height = lines.length * LINE_HEIGHT + NODE_PADDING_Y * 2;

  return { width, height, lines };
}

function edgePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (const p of rest) {
    d += ` L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return d;
}

function arrowMarker(): string {
  return `<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#666"/></marker></defs>`;
}

export function renderSvg(graph: GraphData): string {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "BT", nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeMeta = new Map<string, { width: number; height: number; lines: string[] }>();

  for (const node of graph.nodes) {
    const m = measureNode(node);
    nodeMeta.set(node.id, m);
    g.setNode(node.id, { width: m.width, height: m.height });
  }

  for (const edge of graph.edges) {
    // Reverse direction: arrows show how state propagates (dependency → dependent)
    g.setEdge(edge.to, edge.from);
  }

  dagre.layout(g);

  const graphLabel = g.graph();
  const svgWidth = graphLabel.width ?? 400;
  const svgHeight = graphLabel.height ?? 300;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // Render edges
  const edgeSvgs: string[] = [];
  for (const e of g.edges()) {
    const edgeData = g.edge(e) as { points: Array<{ x: number; y: number }> };
    if (edgeData?.points) {
      edgeSvgs.push(
        `<path d="${edgePath(edgeData.points)}" fill="none" stroke="#666" stroke-width="1.5" marker-end="url(#arrow)"/>`
      );
    }
  }

  // Render nodes
  const nodeSvgs: string[] = [];
  for (const nodeId of g.nodes()) {
    const pos = g.node(nodeId) as { x: number; y: number; width: number; height: number };
    const meta = nodeMeta.get(nodeId);
    const node = nodeById.get(nodeId);
    if (!pos || !meta || !node) continue;

    const colors = STATE_COLORS[node.effective_state] ?? STATE_COLORS.green;
    const x = pos.x - pos.width / 2;
    const y = pos.y - pos.height / 2;
    const rx = 6;

    let nodeContent = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${pos.width}" height="${pos.height}" rx="${rx}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"/>`;

    const textX = pos.x;
    const textStartY = y + NODE_PADDING_Y + LINE_HEIGHT * 0.75;
    for (let i = 0; i < meta.lines.length; i++) {
      const weight = i === 0 ? ' font-weight="bold"' : "";
      const fontSize = i === 0 ? 13 : 11;
      nodeContent += `<text x="${textX.toFixed(1)}" y="${(textStartY + i * LINE_HEIGHT).toFixed(1)}" text-anchor="middle" fill="${colors.text}" font-family="system-ui,sans-serif" font-size="${fontSize}"${weight}>${escapeXml(meta.lines[i])}</text>`;
    }

    nodeSvgs.push(`<g>${nodeContent}</g>`);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`,
    `<style>svg { background: #fff; }</style>`,
    arrowMarker(),
    ...edgeSvgs,
    ...nodeSvgs,
    `</svg>`,
  ].join("\n");
}
