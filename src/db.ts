import { Database } from "bun:sqlite";

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS namespaces (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nodes (
  namespace   TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  label       TEXT,
  state       TEXT NOT NULL DEFAULT 'yellow' CHECK (state IN ('green', 'yellow', 'red')),
  meta        TEXT,
  ttl         INTEGER,  -- seconds; null = no TTL
  last_state_write TEXT,  -- timestamp of last PUT /state, for TTL expiry
  state_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (namespace, id)
);

CREATE TABLE IF NOT EXISTS edges (
  namespace   TEXT NOT NULL,
  from_node   TEXT NOT NULL,
  to_node     TEXT NOT NULL,
  PRIMARY KEY (namespace, from_node, to_node),
  FOREIGN KEY (namespace, from_node) REFERENCES nodes(namespace, id) ON DELETE CASCADE,
  FOREIGN KEY (namespace, to_node) REFERENCES nodes(namespace, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_rules (
  namespace   TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  watch       TEXT NOT NULL DEFAULT '*',
  on_state    TEXT NOT NULL DEFAULT 'red',
  url         TEXT,
  email       TEXT,
  secret      TEXT,
  ack         INTEGER NOT NULL DEFAULT 0,
  suppressed  INTEGER NOT NULL DEFAULT 0,
  last_fired_at TEXT,
  CHECK (url IS NOT NULL OR email IS NOT NULL),
  CHECK (url IS NULL OR email IS NULL),
  PRIMARY KEY (namespace, id)
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace   TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  previous_state TEXT,
  new_state   TEXT NOT NULL,
  previous_effective_state TEXT,
  new_effective_state TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_namespace ON events(namespace, created_at);
CREATE INDEX IF NOT EXISTS idx_events_node ON events(namespace, node_id, created_at);
`;

export const PLAN_LIMITS: Record<string, { nodes: number; events: number }> = {
  free: { nodes: 10, events: 100 },
  pro: { nodes: 500, events: 50_000 },
  team: { nodes: 5_000, events: 500_000 },
  enterprise: { nodes: Infinity, events: Infinity },
};

/**
 * Parse a TTL duration string like "10m", "1h", "30s" into seconds.
 */
export function parseTtl(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}. Use e.g. "30s", "10m", "1h", "7d".`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s": return value;
    case "m": return value * 60;
    case "h": return value * 3600;
    case "d": return value * 86400;
    default: return value;
  }
}

export function createDb(path: string = "depends.db"): Database {
  const db = new Database(path);
  db.exec(SCHEMA);
  return db;
}

export function createTestDb(): Database {
  return createDb(":memory:");
}
