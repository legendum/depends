import { Database } from "bun:sqlite";

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT,
  plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
  meta        TEXT DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS namespaces (
  ns_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL,
  token_id    INTEGER NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(token_id, id)
);

CREATE TABLE IF NOT EXISTS nodes (
  ns_id       INTEGER NOT NULL REFERENCES namespaces(ns_id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  label       TEXT,
  state       TEXT NOT NULL DEFAULT 'yellow' CHECK (state IN ('green', 'yellow', 'red')),
  meta        TEXT,
  reason      TEXT,
  solution    TEXT,
  ttl         INTEGER,
  last_state_write TEXT,
  state_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ns_id, id)
);

CREATE TABLE IF NOT EXISTS edges (
  ns_id       INTEGER NOT NULL,
  from_node   TEXT NOT NULL,
  to_node     TEXT NOT NULL,
  PRIMARY KEY (ns_id, from_node, to_node),
  FOREIGN KEY (ns_id, from_node) REFERENCES nodes(ns_id, id) ON DELETE CASCADE,
  FOREIGN KEY (ns_id, to_node) REFERENCES nodes(ns_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_rules (
  ns_id       INTEGER NOT NULL REFERENCES namespaces(ns_id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  watch       TEXT NOT NULL DEFAULT '*',
  on_state    TEXT NOT NULL DEFAULT 'red',
  url         TEXT,
  email       TEXT,
  secret      TEXT,
  ack         INTEGER NOT NULL DEFAULT 0,
  ack_token   TEXT,
  suppressed  INTEGER NOT NULL DEFAULT 0,
  last_fired_at TEXT,
  CHECK (url IS NOT NULL OR email IS NOT NULL),
  PRIMARY KEY (ns_id, id)
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ns_id       INTEGER NOT NULL REFERENCES namespaces(ns_id) ON DELETE CASCADE,
  node_id     TEXT NOT NULL,
  previous_state TEXT,
  new_state   TEXT NOT NULL,
  previous_effective_state TEXT,
  new_effective_state TEXT NOT NULL,
  reason      TEXT,
  solution    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_ns ON events(ns_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_node ON events(ns_id, node_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_node_id ON events(ns_id, node_id, id);

CREATE INDEX IF NOT EXISTS idx_edges_to_node ON edges(ns_id, to_node);
`;

export const PLAN_LIMITS: Record<string, { nodes: number; events: number; namespaces: number; eventRetentionDays: number }> = {
  free: { nodes: 10, events: 100, namespaces: 1, eventRetentionDays: 7 },
  pro: { nodes: 500, events: 5_000, namespaces: 5, eventRetentionDays: 30 },
  team: { nodes: 2_000, events: 20_000, namespaces: 20, eventRetentionDays: 30 },
  enterprise: { nodes: 100_000, events: 1_000_000, namespaces: 500, eventRetentionDays: 30 },
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

export function createDb(path: string = "data/depends.db"): Database {
  const db = new Database(path);
  db.exec(SCHEMA);
  return db;
}

export function createTestDb(): Database {
  return createDb(":memory:");
}
