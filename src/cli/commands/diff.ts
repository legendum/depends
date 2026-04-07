import { existsSync } from "node:fs";
import yaml from "js-yaml";
import { api } from "../lib/api";
import { COLORS } from "../lib/colors";
import { type Config, getNamespace } from "../lib/config";
import { readDependsYml } from "../lib/yaml";

export async function cmdDiff(config: Config, args: string[]) {
  const ns = getNamespace(config, args);

  if (!existsSync("depends.yml")) {
    console.error("Error: No depends.yml found in current directory.");
    process.exit(1);
  }

  const localContent = readDependsYml();
  const localSpec = yaml.load(localContent) as {
    nodes?: Record<string, { label?: string; depends_on?: string[] }>;
  };
  const localNodes = localSpec?.nodes ?? {};

  // Fetch remote
  const res = await api(config, `/graph/${ns}?format=yaml`);
  if (
    res.status === 404 ||
    (res.ok && (await res.clone().text()).trim() === "")
  ) {
    console.log(
      "Remote namespace is empty — everything in depends.yml would be new.",
    );
    return;
  }

  if (!res.ok) {
    // Namespace might not exist yet
    console.log(
      "Remote namespace not found — everything in depends.yml would be new.",
    );
    return;
  }

  const remoteYaml = await res.text();
  const remoteSpec = yaml.load(remoteYaml) as {
    nodes?: Record<string, { label?: string; depends_on?: string[] }>;
  };
  const remoteNodes = remoteSpec?.nodes ?? {};

  const localIds = new Set(Object.keys(localNodes));
  const remoteIds = new Set(Object.keys(remoteNodes));

  let changes = 0;

  // New nodes
  for (const id of localIds) {
    if (!remoteIds.has(id)) {
      console.log(`${COLORS.green}+ ${id}${COLORS.reset} (new)`);
      changes++;
    }
  }

  // Removed nodes (only if --prune would be used)
  for (const id of remoteIds) {
    if (!localIds.has(id)) {
      console.log(
        `${COLORS.red}- ${id}${COLORS.reset} (not in local YAML, would be removed with --prune)`,
      );
      changes++;
    }
  }

  // Changed nodes
  for (const id of localIds) {
    if (!remoteIds.has(id)) continue;
    const local = localNodes[id];
    const remote = remoteNodes[id];

    const diffs: string[] = [];
    if ((local.label ?? null) !== (remote.label ?? null)) {
      diffs.push(
        `label: ${remote.label ?? "(none)"} → ${local.label ?? "(none)"}`,
      );
    }
    const localDeps = (local.depends_on ?? []).sort().join(",");
    const remoteDeps = (remote.depends_on ?? []).sort().join(",");
    if (localDeps !== remoteDeps) {
      diffs.push(
        `depends_on: [${remoteDeps || "none"}] → [${localDeps || "none"}]`,
      );
    }

    if (diffs.length > 0) {
      console.log(`${COLORS.yellow}~ ${id}${COLORS.reset}`);
      for (const d of diffs) {
        console.log(`    ${d}`);
      }
      changes++;
    }
  }

  if (changes === 0) {
    console.log("No structural changes between local depends.yml and remote.");
  }
}
