import { Database } from "bun:sqlite";
import yaml from "js-yaml";
import { wouldCreateCycle } from "./cycle";

interface YamlNode {
  label?: string;
  depends_on?: string[];
  meta?: Record<string, unknown>;
}

interface YamlNotification {
  watch?: string;
  on?: string | string[];
  url?: string;
  email?: boolean;
  secret?: string;
  ack?: boolean;
}

interface YamlSpec {
  namespace: string;
  nodes?: Record<string, YamlNode>;
  notifications?: Record<string, YamlNotification>;
}

export function parseYaml(content: string): YamlSpec {
  const spec = yaml.load(content) as YamlSpec;
  if (!spec || !spec.namespace) {
    throw new Error("YAML must contain a 'namespace' field");
  }
  return spec;
}

export function importYaml(
  db: Database,
  spec: YamlSpec,
  prune: boolean = false,
  tokenId?: string
): void {
  const ns = spec.namespace;

  db.exec("BEGIN TRANSACTION");
  try {
    const nodeIds = new Set<string>();

    if (spec.nodes) {
      // First pass: create/update all nodes
      for (const [id, node] of Object.entries(spec.nodes)) {
        nodeIds.add(id);

        // Also collect depends_on references
        if (node.depends_on) {
          for (const dep of node.depends_on) {
            nodeIds.add(dep);
          }
        }
      }

      // Create/update nodes
      for (const id of nodeIds) {
        const existing = db
          .query("SELECT id FROM nodes WHERE namespace = ? AND id = ?")
          .get(ns, id);

        const node = spec.nodes[id];

        if (existing) {
          // Update structure only (preserve state)
          if (node) {
            db.query(
              `UPDATE nodes SET
                label = COALESCE(?, label),
                meta = COALESCE(?, meta),
                updated_at = datetime('now')
              WHERE namespace = ? AND id = ?`
            ).run(
              node.label ?? null,
              node.meta ? JSON.stringify(node.meta) : null,
              ns,
              id
            );
          }
        } else {
          // Create new node with default state yellow
          const nodeSpec = node || {};
          db.query(
            `INSERT INTO nodes (namespace, id, label, state, meta)
             VALUES (?, ?, ?, 'yellow', ?)`
          ).run(
            ns,
            id,
            nodeSpec.label ?? null,
            nodeSpec.meta ? JSON.stringify(nodeSpec.meta) : null
          );
        }
      }

      // Remove all existing edges for nodes defined in YAML
      for (const id of Object.keys(spec.nodes)) {
        db.query(
          "DELETE FROM edges WHERE namespace = ? AND from_node = ?"
        ).run(ns, id);
      }

      // Second pass: create edges with cycle detection
      for (const [id, node] of Object.entries(spec.nodes)) {
        if (node.depends_on) {
          for (const dep of node.depends_on) {
            if (wouldCreateCycle(db, ns, id, dep)) {
              throw new Error(
                `Cycle detected: ${id} -> ${dep} would create a cycle`
              );
            }
            db.query(
              "INSERT OR IGNORE INTO edges (namespace, from_node, to_node) VALUES (?, ?, ?)"
            ).run(ns, id, dep);
          }
        }
      }
    }

    // Handle notifications
    if (spec.notifications) {
      // Resolve email: true to token owner's email
      let ownerEmail: string | null = null;
      const hasEmailRule = Object.values(spec.notifications).some((r) => r.email);
      if (hasEmailRule && tokenId) {
        const owner = db.query("SELECT email FROM tokens WHERE id = ?").get(tokenId) as { email: string | null } | null;
        ownerEmail = owner?.email ?? null;
      }

      for (const [id, rule] of Object.entries(spec.notifications)) {
        if (rule.email && !ownerEmail) {
          throw new Error(`Notification "${id}" has email: true but no email address is on file for this token.`);
        }

        const onState = Array.isArray(rule.on)
          ? rule.on.join(",")
          : rule.on ?? "red";

        db.query(
          `INSERT OR REPLACE INTO notification_rules
           (namespace, id, watch, on_state, url, email, secret, ack)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ns,
          id,
          rule.watch ?? "*",
          onState,
          rule.url ?? null,
          rule.email ? ownerEmail : null,
          rule.secret ?? null,
          rule.ack ? 1 : 0
        );
      }
    }

    // Prune nodes not in YAML
    if (prune && spec.nodes) {
      const allNodes = db
        .query("SELECT id FROM nodes WHERE namespace = ?")
        .all(ns) as { id: string }[];

      for (const row of allNodes) {
        if (!nodeIds.has(row.id)) {
          db.query(
            "DELETE FROM nodes WHERE namespace = ? AND id = ?"
          ).run(ns, row.id);
        }
      }
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function exportYaml(db: Database, namespace: string): string {
  const nodes = db
    .query("SELECT * FROM nodes WHERE namespace = ? ORDER BY id")
    .all(namespace) as {
    id: string;
    label: string | null;
    meta: string | null;
  }[];

  const edges = db
    .query("SELECT * FROM edges WHERE namespace = ? ORDER BY from_node, to_node")
    .all(namespace) as {
    from_node: string;
    to_node: string;
  }[];

  const rules = db
    .query(
      "SELECT * FROM notification_rules WHERE namespace = ? ORDER BY id"
    )
    .all(namespace) as {
    id: string;
    watch: string;
    on_state: string;
    url: string | null;
    email: string | null;
    secret: string | null;
    ack: number;
  }[];

  // Build edge map
  const edgeMap = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edgeMap.has(edge.from_node)) edgeMap.set(edge.from_node, []);
    edgeMap.get(edge.from_node)!.push(edge.to_node);
  }

  // Build nodes object
  const nodesObj: Record<string, Record<string, unknown>> = {};
  for (const node of nodes) {
    const entry: Record<string, unknown> = {};
    if (node.label) entry.label = node.label;
    const deps = edgeMap.get(node.id);
    if (deps && deps.length > 0) entry.depends_on = deps;
    if (node.meta) entry.meta = JSON.parse(node.meta);
    nodesObj[node.id] = entry;
  }

  // Build notifications object
  const notificationsObj: Record<string, Record<string, unknown>> = {};
  for (const rule of rules) {
    const entry: Record<string, unknown> = {};
    if (rule.watch !== "*") entry.watch = rule.watch;
    else entry.watch = "*";

    const onParts = rule.on_state.split(",");
    entry.on = onParts.length === 1 ? onParts[0] : onParts;

    if (rule.url) entry.url = rule.url;
    if (rule.email) entry.email = true;
    if (rule.secret) entry.secret = rule.secret;
    if (rule.ack) entry.ack = true;

    notificationsObj[rule.id] = entry;
  }

  const spec: Record<string, unknown> = { namespace };
  if (Object.keys(nodesObj).length > 0) spec.nodes = nodesObj;
  if (Object.keys(notificationsObj).length > 0)
    spec.notifications = notificationsObj;

  return yaml.dump(spec, { lineWidth: -1 });
}
