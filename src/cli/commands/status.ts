import { api, errorMsg } from "../lib/api";
import { COLORS, colorState } from "../lib/colors";
import { type Config, getNamespace, parseCliArgs } from "../lib/config";

interface StatusNode {
  id: string;
  state: string;
  effective_state: string;
  label: string | null;
  reason: string | null;
  solution: string | null;
  depends_on: string[];
  depended_on_by: string[];
}

export async function cmdStatus(config: Config, args: string[]) {
  const { values, positionals } = parseCliArgs(args);
  const target = positionals.find((a) => a !== "status");
  const jsonOutput = !!values.json;

  // Support namespace/node syntax
  let ns: string;
  let nodeId: string | undefined;
  if (target?.includes("/")) {
    const slashIdx = target.indexOf("/");
    ns = target.slice(0, slashIdx);
    nodeId = target.slice(slashIdx + 1);
  } else {
    ns = getNamespace(config, args);
    nodeId = target;
  }

  if (nodeId) {
    // Single node detail
    const res = await api(config, `/nodes/${ns}/${nodeId}`);
    if (!res.ok) {
      console.error(`Error: ${await errorMsg(res)}`);
      process.exit(1);
    }
    const node: StatusNode = await res.json();
    if (jsonOutput) {
      console.log(JSON.stringify(node, null, 2));
      return;
    }
    console.log(
      `${COLORS.bold}${node.id}${COLORS.reset}${node.label ? ` (${node.label})` : ""}`,
    );
    console.log(`  state:     ${colorState(node.state)}`);
    console.log(`  effective: ${colorState(node.effective_state)}`);
    if (node.reason) console.log(`  reason:    ${node.reason}`);
    if (node.solution) console.log(`  solution:  ${node.solution}`);
    if (node.depends_on.length > 0)
      console.log(`  depends_on: ${node.depends_on.join(", ")}`);
    if (node.depended_on_by.length > 0)
      console.log(`  depended_on_by: ${node.depended_on_by.join(", ")}`);
    return;
  }

  // All nodes
  const res = await api(config, `/nodes/${ns}`);
  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }
  const nodes: StatusNode[] = await res.json();

  if (jsonOutput) {
    console.log(JSON.stringify(nodes, null, 2));
    return;
  }

  if (nodes.length === 0) {
    console.log("No nodes in this namespace.");
    return;
  }

  // Find widest ID for alignment
  const maxId = Math.max(...nodes.map((n) => n.id.length));

  for (const node of nodes) {
    const id = node.id.padEnd(maxId);
    const own = colorState(node.state);
    const eff =
      node.state !== node.effective_state
        ? ` ${COLORS.dim}(effective: ${colorState(node.effective_state)}${COLORS.dim})${COLORS.reset}`
        : "";
    const label = node.label
      ? ` ${COLORS.dim}${node.label}${COLORS.reset}`
      : "";
    const reason = node.reason ? ` — ${node.reason}` : "";
    console.log(`  ${id}  ${own}${eff}${label}${reason}`);
  }
}
