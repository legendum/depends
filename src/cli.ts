#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";

// --- Config ---

interface Config {
  default_namespace?: string;
  token?: string;
  api_url?: string;
}

function loadConfig(): Config {
  const envToken = process.env.DEPENDS_TOKEN;
  const envNs = process.env.DEPENDS_NAMESPACE;
  const envUrl = process.env.DEPENDS_API_URL;

  const configPath = process.env.DEPENDS_CONFIG ?? join(homedir(), ".config", "depends", "config.yml");
  let fileConfig: Config = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = (yaml.load(readFileSync(configPath, "utf-8")) as Config) ?? {};
    } catch {}
  }

  const token = envToken ?? fileConfig.token;
  const apiUrl = envUrl ?? fileConfig.api_url;

  // No token configured anywhere → local mode
  if (!token) {
    const localUrl = apiUrl ?? "http://localhost:3000/v1";
    console.error(`${COLORS.dim}Using local mode (dep_local → ${localUrl}). Set DEPENDS_TOKEN for production.${COLORS.reset}`);
    return {
      token: "dep_local",
      default_namespace: envNs ?? fileConfig.default_namespace,
      api_url: localUrl,
    };
  }

  return {
    token,
    default_namespace: envNs ?? fileConfig.default_namespace,
    api_url: apiUrl ?? "https://depends.cc/v1",
  };
}

function getToken(config: Config): string {
  if (!config.token) {
    console.error("Error: No token configured.");
    console.error("Set DEPENDS_TOKEN or add token to ~/.config/depends/config.yml");
    process.exit(1);
  }
  return config.token;
}

function getNamespace(config: Config, args: string[]): string {
  // Check for --namespace or -n flag
  const nsIdx = args.indexOf("--namespace");
  const nIdx = args.indexOf("-n");
  const flagIdx = nsIdx !== -1 ? nsIdx : nIdx;
  if (flagIdx !== -1 && args[flagIdx + 1]) {
    return args[flagIdx + 1];
  }

  // Try depends.yml in current directory
  if (existsSync("depends.yml")) {
    try {
      const spec = yaml.load(readFileSync("depends.yml", "utf-8")) as { namespace?: string };
      if (spec?.namespace) return spec.namespace;
    } catch {}
  }

  if (config.default_namespace) return config.default_namespace;

  console.error("Error: No namespace specified.");
  console.error("Use -n <namespace>, set DEPENDS_NAMESPACE, add default_namespace to ~/.config/depends/config.yml, or have a depends.yml in the current directory.");
  process.exit(1);
}

// --- API helpers ---

async function api(
  config: Config,
  path: string,
  opts: {
    method?: string;
    body?: string;
    contentType?: string;
    headers?: Record<string, string>;
    auth?: boolean;
  } = {}
): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.auth !== false) {
    headers["Authorization"] = `Bearer ${getToken(config)}`;
  }
  if (opts.contentType) {
    headers["Content-Type"] = opts.contentType;
  }

  return fetch(`${config.api_url}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body,
  });
}

async function errorMsg(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return JSON.parse(text).error || text;
  } catch {
    return text;
  }
}

// --- Color helpers ---

const COLORS = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
};

function colorState(state: string): string {
  const color = COLORS[state as keyof typeof COLORS] ?? "";
  const symbol = state === "green" ? "●" : state === "yellow" ? "●" : "●";
  return `${color}${symbol} ${state}${COLORS.reset}`;
}

// --- Commands ---

async function cmdSignup(config: Config, args: string[]) {
  // Get email and account key from args or prompt
  let email = args.find((a) => a.includes("@"));
  let accountKey = args.find((a) => a.startsWith("lak_"));

  if (!email) {
    process.stdout.write("Email: ");
    email = (await new Promise<string>((resolve) => {
      let input = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk) => {
        input += chunk;
        if (input.includes("\n")) {
          process.stdin.pause();
          resolve(input.trim());
        }
      });
      process.stdin.resume();
    }));
  }

  if (!accountKey) {
    process.stdout.write("Legendum account key (lak_...): ");
    accountKey = (await new Promise<string>((resolve) => {
      let input = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk) => {
        input += chunk;
        if (input.includes("\n")) {
          process.stdin.pause();
          resolve(input.trim());
        }
      });
      process.stdin.resume();
    }));
  }

  const res = await api(config, "/signup", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, account_key: accountKey }),
    contentType: "application/json",
  });
  const text = await res.text();
  let data: Record<string, string>;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`Error: Unexpected response from server (${res.status}):`);
    console.error(text.slice(0, 200));
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Error: ${data.error}`);
    process.exit(1);
  }
  console.log(data.message);
  console.log(`\nOnce you receive your token, save it:`);
  console.log(`  export DEPENDS_TOKEN=<your-token>`);
  console.log(`Or add it to ~/.config/depends/config.yml`);
}

async function cmdInit() {
  if (existsSync("depends.yml")) {
    console.error("depends.yml already exists in this directory.");
    process.exit(1);
  }

  // Derive namespace from current directory name, sanitized to valid ID
  const dirName = process.cwd().split("/").pop() ?? "my-project";
  const namespace = dirName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "") || "my-project";

  const scaffold = `namespace: ${namespace}

nodes:
  database:
    label: Database

  api-server:
    label: API Server
    depends_on:
      - database
`;

  writeFileSync("depends.yml", scaffold);
  console.log("Created depends.yml — edit it to define your dependency graph.");
}

async function cmdPush(config: Config, args: string[]) {
  const ns = getNamespace(config, args);
  const filePath = existsSync("depends.yml") ? "depends.yml" : null;

  if (!filePath) {
    console.error("Error: No depends.yml found in current directory.");
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf-8");
  const spec = yaml.load(content) as { namespace?: string };

  if (spec?.namespace && spec.namespace !== ns) {
    console.error(`Error: depends.yml namespace "${spec.namespace}" doesn't match target namespace "${ns}".`);
    process.exit(1);
  }

  // Override namespace in YAML to match target
  const yamlToSend = content.replace(/^namespace:.*$/m, `namespace: ${ns}`);

  // Auto-create namespace if it doesn't exist (ignore 409 conflict)
  const createRes = await api(config, "/namespaces", {
    method: "POST",
    body: JSON.stringify({ id: ns }),
    contentType: "application/json",
  });
  if (!createRes.ok && createRes.status !== 409) {
    console.error(`Error creating namespace: ${await errorMsg(createRes)}`);
    process.exit(1);
  }
  if (createRes.status === 201) {
    console.log(`Created namespace "${ns}".`);
  }

  const prune = args.includes("--prune");
  const url = `/graph/${ns}${prune ? "?prune=true" : ""}`;

  const res = await api(config, url, {
    method: "PUT",
    body: yamlToSend,
    contentType: "application/yaml",
  });

  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  console.log(`Pushed depends.yml to namespace "${ns}".${prune ? " (pruned)" : ""}`);
}

async function cmdPull(config: Config, args: string[]) {
  const ns = getNamespace(config, args);

  const res = await api(config, `/graph/${ns}?format=yaml`);
  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  const yamlContent = await res.text();
  writeFileSync("depends.yml", yamlContent);
  console.log(`Pulled graph from namespace "${ns}" into depends.yml.`);
}

async function cmdShow(config: Config, args: string[]) {
  const ns = getNamespace(config, args);

  const res = await api(config, `/graph/${ns}?format=yaml`);
  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  const yamlContent = await res.text();
  process.stdout.write(yamlContent);
}

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

async function cmdStatus(config: Config, args: string[]) {
  const target = args.find((a) => !a.startsWith("-") && a !== "status");
  const jsonOutput = args.includes("--json");

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
    console.log(`${COLORS.bold}${node.id}${COLORS.reset}${node.label ? ` (${node.label})` : ""}`);
    console.log(`  state:     ${colorState(node.state)}`);
    console.log(`  effective: ${colorState(node.effective_state)}`);
    if (node.reason) console.log(`  reason:    ${node.reason}`);
    if (node.solution) console.log(`  solution:  ${node.solution}`);
    if (node.depends_on.length > 0) console.log(`  depends_on: ${node.depends_on.join(", ")}`);
    if (node.depended_on_by.length > 0) console.log(`  depended_on_by: ${node.depended_on_by.join(", ")}`);
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
    const eff = node.state !== node.effective_state ? ` ${COLORS.dim}(effective: ${colorState(node.effective_state)}${COLORS.dim})${COLORS.reset}` : "";
    const label = node.label ? ` ${COLORS.dim}${node.label}${COLORS.reset}` : "";
    const reason = node.reason ? ` — ${node.reason}` : "";
    console.log(`  ${id}  ${own}${eff}${label}${reason}`);
  }
}

async function cmdSet(config: Config, args: string[]) {
  const positional = args.filter((a) => !a.startsWith("-") && a !== "set");

  if (positional.length < 2) {
    console.error("Usage: depends set [<namespace>/]<node-id> <state> [--reason <reason>] [--solution <solution>]");
    process.exit(1);
  }

  const [target, state] = positional;

  // Support namespace/node syntax
  let ns: string;
  let nodeId: string;
  if (target.includes("/")) {
    const slashIdx = target.indexOf("/");
    ns = target.slice(0, slashIdx);
    nodeId = target.slice(slashIdx + 1);
  } else {
    ns = getNamespace(config, args);
    nodeId = target;
  }
  if (!["green", "yellow", "red"].includes(state)) {
    console.error(`Error: Invalid state "${state}". Must be green, yellow, or red.`);
    process.exit(1);
  }

  const headers: Record<string, string> = {};
  const reasonIdx = args.indexOf("--reason");
  if (reasonIdx !== -1 && args[reasonIdx + 1]) {
    headers["X-Reason"] = args[reasonIdx + 1];
  }
  const solutionIdx = args.indexOf("--solution");
  if (solutionIdx !== -1 && args[solutionIdx + 1]) {
    headers["X-Solution"] = args[solutionIdx + 1];
  }

  const res = await api(config, `/state/${ns}/${nodeId}/${state}`, {
    method: "PUT",
    headers,
  });

  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  console.log(`${nodeId} → ${colorState(state)}`);
}

interface GraphData {
  namespace: string;
  nodes: { id: string; state: string; effective_state: string; label: string | null; reason: string | null; solution: string | null }[];
  edges: { from: string; to: string }[];
}

async function cmdGraph(config: Config, args: string[]) {
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

  function printTree(nodeId: string, prefix: string, isLast: boolean, isRoot: boolean) {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    const stateColor = COLORS[node.effective_state as keyof typeof COLORS] ?? "";
    const symbol = "●";
    const label = node.label ? ` (${node.label})` : "";
    const reason = node.reason ? ` — ${node.reason}` : "";

    console.log(`${prefix}${connector}${stateColor}${symbol}${COLORS.reset} ${node.id}${label}${reason}`);

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

async function cmdValidate() {
  if (!existsSync("depends.yml")) {
    console.error("Error: No depends.yml found in current directory.");
    process.exit(1);
  }

  const content = readFileSync("depends.yml", "utf-8");
  let spec: { namespace?: string; nodes?: Record<string, { depends_on?: string[] }> };
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
            console.log(`${COLORS.yellow}Warning:${COLORS.reset} "${id}" depends on "${dep}" which is not defined in this file (will be auto-created).`);
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

  console.log(`${COLORS.green}✓${COLORS.reset} depends.yml is valid. (${nodeIds.size} nodes, namespace: ${spec.namespace})`);
}

async function cmdDelete(config: Config, args: string[]) {
  const ns = getNamespace(config, args);

  const res = await api(config, `/namespaces/${ns}`, { method: "DELETE" });

  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  console.log(`Deleted namespace "${ns}" and all its data.`);
}

async function cmdDiff(config: Config, args: string[]) {
  const ns = getNamespace(config, args);

  if (!existsSync("depends.yml")) {
    console.error("Error: No depends.yml found in current directory.");
    process.exit(1);
  }

  const localContent = readFileSync("depends.yml", "utf-8");
  const localSpec = yaml.load(localContent) as { nodes?: Record<string, { label?: string; depends_on?: string[] }> };
  const localNodes = localSpec?.nodes ?? {};

  // Fetch remote
  const res = await api(config, `/graph/${ns}?format=yaml`);
  if (res.status === 404 || (res.ok && (await res.clone().text()).trim() === "")) {
    console.log("Remote namespace is empty — everything in depends.yml would be new.");
    return;
  }

  let remoteYaml: string;
  if (!res.ok) {
    // Namespace might not exist yet
    console.log("Remote namespace not found — everything in depends.yml would be new.");
    return;
  }

  remoteYaml = await res.text();
  const remoteSpec = yaml.load(remoteYaml) as { nodes?: Record<string, { label?: string; depends_on?: string[] }> };
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
      console.log(`${COLORS.red}- ${id}${COLORS.reset} (not in local YAML, would be removed with --prune)`);
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
      diffs.push(`label: ${remote.label ?? "(none)"} → ${local.label ?? "(none)"}`);
    }
    const localDeps = (local.depends_on ?? []).sort().join(",");
    const remoteDeps = (remote.depends_on ?? []).sort().join(",");
    if (localDeps !== remoteDeps) {
      diffs.push(`depends_on: [${remoteDeps || "none"}] → [${localDeps || "none"}]`);
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

async function cmdUpdate() {
  const srcDir = join(homedir(), ".config", "depends", "src");
  if (!existsSync(srcDir)) {
    console.error("Error: depends not installed via install.sh. Run:");
    console.error("  curl -fsSL https://depends.cc/install.sh | sh");
    process.exit(1);
  }

  console.log("Updating depends...");
  try {
    execSync("git pull --quiet", { cwd: srcDir, stdio: "inherit" });
    execSync("bun install --silent", { cwd: srcDir, stdio: "inherit" });
    console.log("Updated to latest version.");
  } catch {
    console.error("Error: update failed.");
    process.exit(1);
  }
}

async function cmdUsage(config: Config, args: string[]) {
  const ns = getNamespace(config, args);
  const jsonOutput = args.includes("--json");

  const res = await api(config, `/usage/${ns}`);
  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  const data = await res.json();

  if (jsonOutput) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`${COLORS.bold}${ns}${COLORS.reset} — ${data.period}`);
  console.log();
  console.log(`  Nodes          ${data.nodes} total, ${data.active_nodes} active this month`);
  console.log(`  Events         ${data.total_events} this month`);
  if (data.webhook_deliveries > 0) console.log(`  Webhooks       ${data.webhook_deliveries} fired this month`);
  if (data.emails_sent > 0) console.log(`  Emails         ${data.emails_sent} sent this month`);
}

interface Event {
  node_id: string;
  previous_state: string | null;
  new_state: string;
  previous_effective_state: string | null;
  new_effective_state: string;
  reason: string | null;
  solution: string | null;
  created_at: string;
}

async function cmdEvents(config: Config, args: string[]) {
  const target = args.find((a) => !a.startsWith("-") && a !== "events");
  const jsonOutput = args.includes("--json");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 && args[limitIdx + 1] ? args[limitIdx + 1] : "20";

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

  const path = nodeId
    ? `/events/${ns}/${nodeId}?limit=${limit}&order=desc`
    : `/events/${ns}?limit=${limit}&order=desc`;

  const res = await api(config, path);
  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  const data = await res.json();
  const events: Event[] = Array.isArray(data) ? data : data.events;

  if (jsonOutput) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log("No events.");
    return;
  }

  for (const e of events) {
    const prev = e.previous_state ? colorState(e.previous_state) : `${COLORS.dim}(new)${COLORS.reset}`;
    const arrow = `${COLORS.dim}→${COLORS.reset}`;
    let context = "";
    if (e.reason || e.solution) {
      const parts = [];
      if (e.reason) parts.push(e.reason);
      if (e.solution) parts.push(`solution: ${e.solution}`);
      context = ` ${COLORS.dim}— ${parts.join("; ")}${COLORS.reset}`;
    }
    const time = `${COLORS.dim}${e.created_at}${COLORS.reset}`;
    console.log(`  ${time}  ${e.node_id}  ${prev} ${arrow} ${colorState(e.new_state)}${context}`);
  }
}

async function cmdAdmin(args: string[]) {
  const sub = args[1];

  // Admin commands operate directly on the local database
  const dbPath = join(process.cwd(), "data", "depends.db");
  if (!existsSync(dbPath)) {
    console.error("Error: No database found at data/depends.db. Run from the server directory.");
    process.exit(1);
  }

  const { createDb } = await import("./db");
  const db = createDb(dbPath);

  if (sub === "tokens") {
    const tokens = db.query("SELECT id, email, legendum_token, created_at FROM tokens ORDER BY created_at").all() as {
      id: string; email: string | null; legendum_token: string | null; created_at: string;
    }[];

    if (tokens.length === 0) {
      console.log("No tokens.");
      return;
    }

    const maxEmail = Math.max(5, ...tokens.map((t) => (t.email ?? "-").length));

    for (const t of tokens) {
      const email = (t.email ?? "-").padEnd(maxEmail);
      const linked = t.legendum_token ? "linked" : "unlinked";
      console.log(`  ${email}  ${linked}  ${COLORS.dim}${t.id}  ${t.created_at}${COLORS.reset}`);
    }
  } else {
    console.error(`Usage:
  depends admin tokens              List all tokens`);
    process.exit(1);
  }
}

async function cmdServe(args: string[]) {
  const portIdx = args.indexOf("-p");
  const port = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : 3000;

  const { createDb } = await import("./db");
  const { createServer } = await import("./server");

  const dbPath = join(process.cwd(), "data", "depends.db");
  if (!existsSync(join(process.cwd(), "data"))) {
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
  }

  const db = createDb(dbPath);
  const server = createServer(db, port);

  console.log(`depends.cc listening on http://localhost:${server.port}`);
  console.log(`Use token "dep_local" — no signup needed.`);
  console.log(`\nSet your CLI to use this server:`);
  console.log(`  export DEPENDS_API_URL=http://localhost:${server.port}/v1`);
}

// --- Main ---

function printUsage() {
  console.log(`${COLORS.bold}depends${COLORS.reset} — CLI for depends.cc

${COLORS.bold}Usage:${COLORS.reset}
  depends serve [-p <port>]                   Run the server locally (default: 3000)
  depends signup <email> <lak_...>             Sign up (token emailed to you)
  depends init                                Create a depends.yml in the current directory
  depends push [--prune]                      Upload depends.yml (auto-creates namespace)
  depends pull                                Download graph as depends.yml
  depends show                                Print the current spec (YAML) without saving
  depends status [<node-id>]                  Show node states (color-coded)
  depends set [<namespace>/]<node-id> <state> Set a node's state (green/yellow/red)
  depends graph                               Print dependency tree
  depends events [<ns/node>]                   Show recent state changes
  depends validate                            Check depends.yml for errors
  depends delete                              Delete a namespace and all its data
  depends usage                               Show usage stats for current billing period
  depends diff                                Show what would change on push
  depends update                              Update to the latest version
  depends admin tokens                        List all tokens (server admin)
  depends admin plan <email> [plan]            Show or set plan for an email

${COLORS.bold}Options:${COLORS.reset}
  -n, --namespace <ns>    Override namespace
  -p <port>               Port for serve (default: 3000)
  --json                  Output as JSON (with status, events)
  --limit <n>             Number of events to show (default: 20)
  --reason <text>         Reason for state change (with set)
  --solution <text>       Recommended fix (with set)

${COLORS.bold}Config:${COLORS.reset}
  ~/.config/depends/config.yml   token, default_namespace, api_url
  DEPENDS_TOKEN           Environment variable for auth token
  DEPENDS_NAMESPACE       Environment variable for namespace`);
}

async function main() {
  const args = process.argv.slice(2);

  // Strip out -n/--namespace flags from args for command parsing
  const cleanArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-n" || args[i] === "--namespace") && args[i + 1]) {
      i++; // skip value
    } else if ((args[i] === "--reason" || args[i] === "--solution") && args[i + 1]) {
      cleanArgs.push(args[i], args[i + 1]);
      i++;
    } else {
      cleanArgs.push(args[i]);
    }
  }

  const command = cleanArgs[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  // Commands that don't need a config/token
  switch (command) {
    case "serve":
      await cmdServe(args);
      return;
    case "update":
      await cmdUpdate();
      return;
    case "signup":
      // Always use production API for signup — never local mode
      await cmdSignup({ api_url: process.env.DEPENDS_API_URL ?? "https://depends.cc/v1" }, args);
      return;
  }

  const config = loadConfig();

  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "push":
      await cmdPush(config, args);
      break;
    case "pull":
      await cmdPull(config, args);
      break;
    case "show":
      await cmdShow(config, args);
      break;
    case "status":
      await cmdStatus(config, args);
      break;
    case "set":
      await cmdSet(config, args);
      break;
    case "graph":
      await cmdGraph(config, args);
      break;
    case "events":
      await cmdEvents(config, args);
      break;
    case "validate":
      await cmdValidate();
      break;
    case "delete":
      await cmdDelete(config, args);
      break;
    case "usage":
      await cmdUsage(config, args);
      break;
    case "diff":
      await cmdDiff(config, args);
      break;
    case "admin":
      await cmdAdmin(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main();
