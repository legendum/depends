import { Database } from "bun:sqlite";
import yaml from "js-yaml";
import { wouldCreateCycle } from "./cycle";

const legendum = require("../lib/legendum.js");

interface YamlNode {
  label?: string;
  depends_on?: string[];
  default_state?: string;
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

export async function importYaml(
  db: Database,
  nsId: number,
  spec: YamlSpec,
  prune: boolean = false,
  tokenId?: number,
  legendumToken?: string | null
): Promise<void> {
  // Count new nodes before starting the transaction so we can charge up front
  if (legendumToken && spec.nodes) {
    const nodeIds = new Set<string>();
    for (const [id, node] of Object.entries(spec.nodes)) {
      nodeIds.add(id);
      if (node.depends_on) {
        for (const dep of node.depends_on) nodeIds.add(dep);
      }
    }
    let newCount = 0;
    for (const id of nodeIds) {
      const existing = db.query("SELECT id FROM nodes WHERE ns_id = ? AND id = ?").get(nsId, id);
      if (!existing) newCount++;
    }
    if (newCount > 0) {
      await legendum.charge(legendumToken, newCount * 1, `graph import: ${newCount} new node${newCount > 1 ? "s" : ""}`);
    }
  }

  db.exec("BEGIN TRANSACTION");
  try {
    const nodeIds = new Set<string>();

    if (spec.nodes) {
      for (const [id, node] of Object.entries(spec.nodes)) {
        nodeIds.add(id);
        if (node.depends_on) {
          for (const dep of node.depends_on) {
            nodeIds.add(dep);
          }
        }
      }

      for (const id of nodeIds) {
        const existing = db
          .query("SELECT id FROM nodes WHERE ns_id = ? AND id = ?")
          .get(nsId, id);

        const node = spec.nodes[id];

        if (existing) {
          if (node) {
            db.query(
              `UPDATE nodes SET
                label = COALESCE(?, label),
                meta = COALESCE(?, meta),
                default_state = COALESCE(?, default_state),
                updated_at = datetime('now')
              WHERE ns_id = ? AND id = ?`
            ).run(
              node.label ?? null,
              node.meta ? JSON.stringify(node.meta) : null,
              node.default_state ?? null,
              nsId,
              id
            );
          }
        } else {
          const nodeSpec = node || {};
          const initState = nodeSpec.default_state ?? "yellow";
          db.query(
            `INSERT INTO nodes (ns_id, id, label, state, default_state, meta)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            nsId,
            id,
            nodeSpec.label ?? null,
            initState,
            nodeSpec.default_state ?? null,
            nodeSpec.meta ? JSON.stringify(nodeSpec.meta) : null
          );
        }
      }

      for (const id of Object.keys(spec.nodes)) {
        db.query("DELETE FROM edges WHERE ns_id = ? AND from_node = ?").run(nsId, id);
      }

      for (const [id, node] of Object.entries(spec.nodes)) {
        if (node.depends_on) {
          for (const dep of node.depends_on) {
            if (wouldCreateCycle(db, nsId, id, dep)) {
              throw new Error(`Cycle detected: ${id} -> ${dep} would create a cycle`);
            }
            db.query(
              "INSERT OR IGNORE INTO edges (ns_id, from_node, to_node) VALUES (?, ?, ?)"
            ).run(nsId, id, dep);
          }
        }
      }
    }

    if (spec.notifications) {
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
           (ns_id, id, watch, on_state, url, email, secret, ack)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          nsId,
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

    if (prune && spec.nodes) {
      const allNodes = db
        .query("SELECT id FROM nodes WHERE ns_id = ?")
        .all(nsId) as { id: string }[];

      for (const row of allNodes) {
        if (!nodeIds.has(row.id)) {
          db.query("DELETE FROM nodes WHERE ns_id = ? AND id = ?").run(nsId, row.id);
        }
      }
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function exportYaml(db: Database, nsId: number, namespace: string): string {
  const nodes = db
    .query("SELECT * FROM nodes WHERE ns_id = ? ORDER BY id")
    .all(nsId) as { id: string; label: string | null; default_state: string | null; meta: string | null }[];

  const edges = db
    .query("SELECT * FROM edges WHERE ns_id = ? ORDER BY from_node, to_node")
    .all(nsId) as { from_node: string; to_node: string }[];

  const rules = db
    .query("SELECT * FROM notification_rules WHERE ns_id = ? ORDER BY id")
    .all(nsId) as {
    id: string; watch: string; on_state: string;
    url: string | null; email: string | null; secret: string | null; ack: number;
  }[];

  const edgeMap = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edgeMap.has(edge.from_node)) edgeMap.set(edge.from_node, []);
    edgeMap.get(edge.from_node)!.push(edge.to_node);
  }

  const nodesObj: Record<string, Record<string, unknown>> = {};
  for (const node of nodes) {
    const entry: Record<string, unknown> = {};
    if (node.label) entry.label = node.label;
    if (node.default_state) entry.default_state = node.default_state;
    const deps = edgeMap.get(node.id);
    if (deps && deps.length > 0) entry.depends_on = deps;
    if (node.meta) entry.meta = JSON.parse(node.meta);
    nodesObj[node.id] = entry;
  }

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
  if (Object.keys(notificationsObj).length > 0) spec.notifications = notificationsObj;

  return yaml.dump(spec, { lineWidth: -1 });
}
