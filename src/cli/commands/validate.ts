import { existsSync } from "node:fs";
import yaml from "js-yaml";
import { COLORS } from "../lib/colors";
import { readDependsYml } from "../lib/yaml";

export async function cmdValidate() {
  if (!existsSync("depends.yml")) {
    console.error("Error: No depends.yml found in current directory.");
    process.exit(1);
  }

  const content = readDependsYml();
  let spec: {
    namespace?: string;
    nodes?: Record<string, { depends_on?: string[] }>;
  };
  try {
    spec = yaml.load(content) as typeof spec;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`Error: Invalid YAML — ${msg}`);
    process.exit(1);
  }

  if (!spec?.namespace) {
    console.error("Error: depends.yml must contain a 'namespace' field.");
    process.exit(1);
  }

  const errors: string[] = [];
  const nodeIds = new Set(Object.keys(spec.nodes ?? {}));

  if (spec.nodes) {
    // Check for missing refs (warning, not error — auto-created by server)
    const allRefs = new Set<string>();
    for (const [id, node] of Object.entries(spec.nodes)) {
      if (node.depends_on) {
        for (const dep of node.depends_on) {
          allRefs.add(dep);
          if (!nodeIds.has(dep)) {
            console.log(
              `${COLORS.yellow}Warning:${COLORS.reset} "${id}" depends on "${dep}" which is not defined in this file (will be auto-created).`,
            );
          }
        }
      }
    }

    // Cycle detection (local, no server needed)
    const adjList = new Map<string, string[]>();
    for (const [id, node] of Object.entries(spec.nodes)) {
      adjList.set(id, node.depends_on ?? []);
    }

    // Kahn's algorithm for topological sort
    const inDegree = new Map<string, number>();
    const allNodes = new Set([...nodeIds, ...allRefs]);
    for (const id of allNodes) inDegree.set(id, 0);
    for (const [, deps] of adjList) {
      for (const dep of deps) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let sorted = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted++;
      for (const dep of adjList.get(node) ?? []) {
        const newDeg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) queue.push(dep);
      }
    }

    if (sorted < allNodes.size) {
      errors.push("Cycle detected in dependency graph.");
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`${COLORS.red}Error:${COLORS.reset} ${err}`);
    }
    process.exit(1);
  }

  console.log(
    `${COLORS.green}✓${COLORS.reset} depends.yml is valid. (${nodeIds.size} nodes, namespace: ${spec.namespace})`,
  );
}
