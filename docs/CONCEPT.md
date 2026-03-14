# depends.cc — Concept

A lightweight, API-first dependency state service. Track the status of things and what they depend on.

depends.cc is a **passive receiver** — a "female plug" for the internet of intelligent services. It never proactively checks, polls, or crawls. Services push their state in; depends.cc computes the graph and fires webhooks out. That's it.

## Core Model

A **depends tree** is a directed acyclic graph (DAG). Each node represents a "thing" — a service, a task, a deploy step, a build artifact, whatever you need to track.

Each node has a **state**, modeled as a traffic light:

| State    | Meaning                              | Examples                        |
|----------|--------------------------------------|---------------------------------|
| `green`  | Good / passing / done / ready        | Service healthy, task complete  |
| `yellow` | In progress / not ready, no errors   | Deploying, task running         |
| `red`    | Error / failure / blocked            | Service down, build failed      |

Nodes can **depend on** other nodes. A node's **effective state** is the worst of its own state and the states of everything it depends on (red > yellow > green). This means: if a database goes red, every service that depends on it is effectively red too — without anyone needing to update each one.

## Key Concepts

- **Namespace**: A top-level grouping (e.g., `acme-corp`, `my-project`). Isolates trees from each other.
- **Node**: A named thing with a state. Identified by `namespace/node-id`.
- **Edge**: A dependency relationship. "A depends on B" means A's effective state is affected by B.
- **Effective state**: A node's state considering all transitive dependencies. Computed on read, not stored.
- **Webhook / notification**: Fire when a node's effective state changes.

## API Design

Base URL: `https://api.depends.cc/v1`

Authentication: Bearer token per namespace.

### Namespaces

```
POST   /namespaces                            — Create a namespace, returns token
DELETE /namespaces/{namespace}                 — Delete a namespace and all its data
```

#### POST /namespaces

```json
{ "id": "acme" }
```

Returns:

```json
{
  "id": "acme",
  "token": "dps_a1b2c3..."
}
```

The token is shown **once**. It's stored as a hash — depends.cc cannot recover it. Treat it like a password.

### Nodes

```
PUT    /nodes/{namespace}/{node-id}          — Create or update a node
GET    /nodes/{namespace}/{node-id}          — Get a node (includes effective state)
DELETE /nodes/{namespace}/{node-id}          — Delete a node
GET    /nodes/{namespace}                    — List all nodes in a namespace
```

#### PUT /nodes/{namespace}/{node-id}

```json
{
  "state": "green",
  "label": "Payment Service",
  "depends_on": ["database", "auth-service"],
  "ttl": "10m",
  "meta": {
    "url": "https://pay.example.com",
    "owner": "backend-team"
  }
}
```

All fields optional on update (patch semantics). `depends_on` references other node IDs within the same namespace.

- `ttl`: Optional. If set, the node automatically transitions to `yellow` if no state write is received within this duration (e.g., `"5m"`, `"1h"`, `"30s"`). TTL expiry never sets a node to red — yellow means "we haven't heard from it", red means "it told us something is wrong". Each state write resets the TTL clock.

#### GET /nodes/{namespace}/{node-id}

```json
{
  "id": "payment-service",
  "namespace": "acme",
  "state": "green",
  "effective_state": "red",
  "label": "Payment Service",
  "depends_on": ["database", "auth-service"],
  "depended_on_by": ["checkout-flow"],
  "meta": {
    "url": "https://pay.example.com",
    "owner": "backend-team"
  },
  "state_changed_at": "2026-03-14T10:30:00Z",
  "updated_at": "2026-03-14T10:30:00Z"
}
```

Note: `effective_state` is `red` here because a dependency (e.g., `database`) is red, even though this node's own `state` is `green`.

### State (shorthand)

For quick fire-and-forget state updates, put the state in the path — no body:

```
PUT /state/{namespace}/{node-id}/{state}
```

`{state}` is one of `green`, `yellow`, or `red`. Returns `204 No Content`. Auto-creates the node if it doesn't exist (with no dependencies). One curl call:

```bash
curl -X PUT https://api.depends.cc/v1/state/acme/api-server/green \
  -H "Authorization: Bearer $DEPENDS_TOKEN"
```

Optionally include a reason via the `X-Depends-Reason` header:

```bash
curl -X PUT https://api.depends.cc/v1/state/acme/api-server/red \
  -H "Authorization: Bearer $DEPENDS_TOKEN" \
  -H "X-Depends-Reason: disk full on /var/data"
```

The reason is stored on the node and included in webhook payloads and event history. It answers "why is this red?" without digging through logs.

### Events (history)

```
GET /events/{namespace}                    — All events in a namespace
GET /events/{namespace}/{node-id}          — Events for a specific node
```

Query params:
- `?since=2026-03-14T00:00:00Z` — Events after this timestamp
- `?limit=100` — Max events to return (default 100, max 1000)

```json
{
  "events": [
    {
      "id": 42,
      "node_id": "api-server",
      "previous_state": "green",
      "new_state": "red",
      "previous_effective_state": "green",
      "new_effective_state": "red",
      "created_at": "2026-03-14T10:30:00Z"
    }
  ]
}
```

Every state transition is recorded. This is the audit trail — useful for debugging, postmortems, and billing metering.

### Graph

```
GET /graph/{namespace}                     — Full dependency graph
GET /graph/{namespace}/{node-id}           — Subgraph rooted at a node
GET /graph/{namespace}/{node-id}/upstream  — What does this node depend on? (transitive)
GET /graph/{namespace}/{node-id}/downstream — What depends on this node? (transitive)
```

#### GET /graph/{namespace}

```json
{
  "namespace": "acme",
  "nodes": [
    { "id": "database", "state": "red", "effective_state": "red" },
    { "id": "auth-service", "state": "green", "effective_state": "green" },
    { "id": "payment-service", "state": "green", "effective_state": "red" },
    { "id": "checkout-flow", "state": "green", "effective_state": "red" }
  ],
  "edges": [
    { "from": "payment-service", "to": "database" },
    { "from": "payment-service", "to": "auth-service" },
    { "from": "checkout-flow", "to": "payment-service" }
  ]
}
```

Optional query params:
- `?format=yaml` — Return as YAML (see YAML Spec Format below)
- `?state=red` — Filter to only nodes with this effective state

### Notifications

depends.cc notifies via **webhooks**, with **email** as built-in syntactic sugar. Under the hood, everything is a webhook.

```
PUT    /notifications/{namespace}              — Create/update a notification rule
GET    /notifications/{namespace}              — List notification rules
DELETE /notifications/{namespace}/{rule-id}    — Delete a rule
POST   /notifications/{namespace}/{rule-id}/ack — Re-arm a suppressed rule
```

#### PUT /notifications/{namespace}

```json
{
  "id": "alert-on-red",
  "watch": "*",
  "on": "red",
  "url": "https://your-service.com/hooks/depends",
  "secret": "whsec_..."
}
```

- `watch`: `"*"` for all nodes, or a specific node ID.
- `on`: Which effective state transition(s) trigger the notification. A single value (`"red"`), a list (`["red", "green"]`), or `"*"` for any change.
- `url`: The webhook endpoint.
- `secret`: Shared secret for HMAC-SHA256 signature verification.
- `ack`: Optional, default `false`. When `true`, the rule fires once then auto-suppresses until you `POST .../ack` to re-arm it. When `false` (default), the rule fires on every matching state transition with no suppression.

#### Webhook Payload

depends.cc sends a `POST` to the URL with:

```json
{
  "event": "effective_state_changed",
  "namespace": "acme",
  "node_id": "database",
  "state": "red",
  "effective_state": "red",
  "previous_effective_state": "green",
  "reason": "disk full on /var/data",
  "triggered_rule": "alert-on-red",
  "timestamp": "2026-03-14T10:30:00Z"
}
```

Headers:
- `X-Depends-Signature`: HMAC-SHA256 of the body using the `secret`, for authenticity verification.

On non-2xx response: retries 3 times with exponential backoff (~5 minutes total), then logs failure and stops.

#### Email (built-in convenience)

depends.cc also supports email notifications as syntactic sugar. Just use `"email"` instead of `"url"`:

```json
{
  "id": "email-on-outage",
  "watch": "*",
  "on": "red",
  "email": "ops@example.com",
  "ack": true
}
```

A rule has either `"url"` (webhook) or `"email"` (built-in), never both. Under the hood, email is implemented as an internal webhook — the notification system is always webhooks. The email contains the same payload a webhook would receive, formatted as a human-readable message with a link to the graph.

## YAML Spec Format

A depends graph can be defined as a `depends.yml` file, committed to source control as the declarative source of truth for your project's dependency structure.

```yaml
namespace: myproject

nodes:
  database:
    label: PostgreSQL Primary
    meta:
      host: db.example.com
      owner: platform-team

  auth-service:
    label: Auth Service
    depends_on:
      - database
    meta:
      url: https://auth.example.com

  api-server:
    label: API Server
    depends_on:
      - database
      - auth-service
    ttl: 10m
    meta:
      url: https://api.example.com

  worker:
    label: Background Worker
    depends_on:
      - api-server
    meta:
      queue: jobs

notifications:
  email-on-outage:
    watch: "*"
    on: red
    email: ops@example.com
    ack: true

  webhook-on-change:
    watch: "*"
    on: [red, green]
    url: https://your-service.com/hooks/depends
    secret: whsec_...
```

Notes:
- `state` is intentionally **not** in the YAML. The spec defines structure; state is set at runtime via the API.
- Nodes listed in `depends_on` that aren't defined in the file are created automatically with no dependencies (useful for shared/external dependencies).
- The YAML format is a superset of what the API accepts — anything you can PUT, you can declare here.

### API: Import/Export YAML

```
PUT  /graph/{namespace}        — Upload a YAML spec (Content-Type: application/yaml)
GET  /graph/{namespace}?format=yaml  — Download the current graph as YAML
```

On import, depends.cc reconciles the YAML against the current state:
- New nodes are created (state defaults to `yellow`)
- Existing nodes have their structure updated (dependencies, labels, meta)
- **State is preserved** — importing a YAML never resets node states
- Nodes present in the service but absent from the YAML are left untouched (use `?prune=true` to remove them)

## CLI: `depends`

A command-line tool for working with `depends.yml` files and the depends.cc service.

```
depends init                      — Create a depends.yml in the current directory
depends push                      — Deploy depends.yml to depends.cc
depends pull                      — Download the current graph as depends.yml
depends status                    — Show all node states (with effective states)
depends status <node-id>          — Show a single node and its upstream/downstream
depends set <node-id> <state>     — Set a node's state (green/yellow/red)
depends graph                     — Print the dependency graph (ASCII tree)
depends validate                  — Check depends.yml for cycles, missing refs, etc.
depends diff                      — Show what would change on push
```

Built with `bun build --compile` for standalone executables:

| Platform       | Target                   |
|----------------|--------------------------|
| macOS ARM      | `bun build --compile --target=bun-darwin-arm64`  |
| macOS x86      | `bun build --compile --target=bun-darwin-x64`    |
| Linux ARM      | `bun build --compile --target=bun-linux-arm64`   |
| Linux x86      | `bun build --compile --target=bun-linux-x64`     |

No runtime dependencies — download the binary, run it.

Configuration in `~/.depends/config.yml`:

```yaml
default_namespace: myproject
token: dps_...
api_url: https://api.depends.cc/v1   # default, overridable for self-hosted
```

Or via environment variables: `DEPENDS_TOKEN`, `DEPENDS_NAMESPACE`.

### Workflow

A typical git-integrated workflow:

1. Define your graph in `depends.yml`, commit it
2. CI runs `depends validate` to catch cycles or errors
3. On merge to main, CI runs `depends push` to sync structure to depends.cc
4. Services and agents push their state via the API
5. Notifications fire when things go red

## Example: Service Monitoring with Alerts

Services push their own state to depends.cc. When something goes red, a webhook fires.

### Setup

```bash
# Create a namespace
DEPENDS_TOKEN=$(curl -s -X POST https://api.depends.cc/v1/namespaces \
  -H "Content-Type: application/json" \
  -d '{"id": "myproject"}' | jq -r '.token')

# Define the graph structure (or use `depends push` with a YAML file)
curl -X PUT https://api.depends.cc/v1/nodes/myproject/api-server \
  -H "Authorization: Bearer $DEPENDS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "API Server"}'

curl -X PUT https://api.depends.cc/v1/nodes/myproject/worker \
  -H "Authorization: Bearer $DEPENDS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "Background Worker", "depends_on": ["api-server"]}'

# Set up notifications
curl -X PUT https://api.depends.cc/v1/notifications/myproject \
  -H "Authorization: Bearer $DEPENDS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "outage-hook",
    "watch": "*",
    "on": ["red", "green"],
    "url": "https://my-service.com/hooks/depends",
    "secret": "whsec_abc123"
  }'
```

### Services push their own state

Each service reports its own health to depends.cc — no external poller needed:

```typescript
// Inside your API server
const DEPENDS_TOKEN = process.env.DEPENDS_TOKEN;

async function reportState(state: "green" | "yellow" | "red") {
  await fetch(`https://api.depends.cc/v1/state/myproject/api-server/${state}`, {
    method: "PUT",
    headers: { "Authorization": `Bearer ${DEPENDS_TOKEN}` },
  });
}

// On startup
reportState("green");

// On error
process.on("uncaughtException", () => reportState("red"));

// Or on a health check interval
setInterval(async () => {
  const healthy = await selfCheck();
  reportState(healthy ? "green" : "red");
}, 60_000);
```

When `api-server` pushes `red`:
1. Its effective state becomes `red`
2. `worker` (which depends on it) also becomes effectively `red`
3. The webhook fires to `https://my-service.com/hooks/depends`
4. Your receiver sends an email, pages someone, updates a dashboard — whatever you wire up

## MCP Server

depends.cc will provide an MCP (Model Context Protocol) server so AI agents can:

- Query dependency state as context for decision-making
- Update node states as they complete tasks
- Check what's blocked before starting work
- Register task dependencies dynamically

Tools exposed:
- `depends_get_state` — Get a node's state and effective state
- `depends_set_state` — Update a node's state
- `depends_add_node` — Create a node with dependencies
- `depends_get_graph` — Get the dependency graph
- `depends_what_is_blocked` — List all nodes with effective state != green

## Implementation

**Runtime:** Bun (TypeScript)
**Database:** SQLite in WAL (Write-Ahead Logging) mode

WAL mode allows multiple Bun processes to read the database concurrently while one writes, making it safe to run multiple server processes against the same `depends.db` file. This keeps the deployment model dead simple — no Postgres, no Redis, just a single file on disk.

### Schema

```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE namespaces (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE nodes (
  namespace   TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  label       TEXT,
  state       TEXT NOT NULL DEFAULT 'yellow' CHECK (state IN ('green', 'yellow', 'red')),
  meta        TEXT,  -- JSON
  ttl         INTEGER,  -- seconds; null = no TTL
  state_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (namespace, id)
);

CREATE TABLE edges (
  namespace   TEXT NOT NULL,
  from_node   TEXT NOT NULL,
  to_node     TEXT NOT NULL,
  PRIMARY KEY (namespace, from_node, to_node),
  FOREIGN KEY (namespace, from_node) REFERENCES nodes(namespace, id) ON DELETE CASCADE,
  FOREIGN KEY (namespace, to_node) REFERENCES nodes(namespace, id) ON DELETE CASCADE
);

CREATE TABLE notification_rules (
  namespace   TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  watch       TEXT NOT NULL DEFAULT '*',
  on_state    TEXT NOT NULL DEFAULT 'red',  -- "red", "green", "yellow", "red,green", or "*"
  url         TEXT,            -- webhook URL (mutually exclusive with email)
  email       TEXT,            -- email address (mutually exclusive with url)
  secret      TEXT,            -- HMAC secret (webhooks only)
  ack         INTEGER NOT NULL DEFAULT 0,  -- when true, auto-suppresses after firing
  suppressed  INTEGER NOT NULL DEFAULT 0,  -- set to 1 after firing (if ack=1), reset by POST .../ack
  last_fired_at TEXT,
  CHECK (url IS NOT NULL OR email IS NOT NULL),
  CHECK (url IS NULL OR email IS NULL),
  PRIMARY KEY (namespace, id)
);

-- Every state transition is logged. Foundation for billing, debugging, and history.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace   TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  previous_state TEXT,          -- null on first write
  new_state   TEXT NOT NULL,
  previous_effective_state TEXT,
  new_effective_state TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_namespace ON events(namespace, created_at);
CREATE INDEX idx_events_node ON events(namespace, node_id, created_at);
```

### Project Structure

```
depends/
├── src/
│   ├── server.ts            — Bun HTTP server, route dispatch
│   ├── db.ts                — SQLite connection, migrations, WAL setup
│   ├── routes/
│   │   ├── nodes.ts         — /nodes endpoints
│   │   ├── state.ts         — /state shorthand endpoint
│   │   ├── graph.ts         — /graph endpoints, YAML export
│   │   └── notifications.ts — /notifications endpoints
│   ├── graph/
│   │   ├── effective.ts     — Effective state computation (DAG traversal)
│   │   ├── cycle.ts         — Cycle detection on edge insert
│   │   └── yaml.ts          — YAML import/export, reconciliation
│   ├── notify/
│   │   ├── dispatcher.ts    — Notification evaluation and dispatch
│   │   └── webhook.ts       — Webhook sender with HMAC signing & retries
│   ├── auth.ts              — Bearer token verification
│   └── mcp/
│       └── server.ts        — MCP server tool definitions
├── cli/
│   └── depends.ts           — CLI entry point (depends push/pull/status/etc.)
├── depends.db               — SQLite database (gitignored)
├── package.json
├── tsconfig.json
└── docs/
    └── CONCEPT.md
```

### Why Bun + SQLite

- **Single binary, zero infra** — `bun build` compiles to a standalone executable. Deploy is copying one file.
- **Native SQLite** — Bun has built-in `bun:sqlite`, no native addon compilation needed.
- **WAL mode** — Multiple readers, single writer. For a state-tracking service with many reads and infrequent writes, this is ideal. No need for a database server.
- **Scaling** — A single SQLite file handles thousands of namespaces and millions of nodes easily. If you outgrow it, the SQL schema maps directly to Postgres with minimal changes.
- **Self-hostable** — `depends.db` is just a file. Back it up with `cp`. Move it with `scp`. No database admin.

## Design Principles

1. **Dead simple** — Setting state is one PUT to `/state/{ns}/{id}/{state}` with no body. No SDK required.
2. **State propagation, not orchestration** — depends.cc tells you what's affected. It doesn't run your tasks.
3. **AI-native** — MCP support, structured data, designed for agents to read and write.
4. **Transparent** — The graph is always queryable. No hidden state.
5. **Acyclic** — The API rejects edges that would create cycles in the DAG.

## Billing

Billing is based on **monthly active nodes** — a node counts as active if it received at least one state write that month. This is predictable for users ("I have 30 nodes, I know what I'll pay") and scales naturally.

| Tier       | Nodes  | Events/month | Price        |
|------------|--------|-------------|--------------|
| Free       | 10     | 100         | $0           |
| Pro        | 500    | 50,000      | $19/mo       |
| Team       | 5,000  | 500,000     | $49/mo       |
| Enterprise | Custom | Custom      | Contact us   |

Limits are enforced on write. When a namespace exceeds its plan:
- Creating a node beyond the limit returns `402 Payment Required`
- State writes beyond the event limit return `402 Payment Required`
- Reads, graph queries, and existing webhooks continue to work — we never break visibility

The `events` table is the source of truth for metering — count rows and distinct `(namespace, node_id)` pairs within the billing period.

Usage is queryable:

```
GET /usage/{namespace}
```

```json
{
  "namespace": "acme",
  "period": "2026-03",
  "active_nodes": 28,
  "total_events": 1423,
  "webhook_deliveries": 47,
  "emails_sent": 3
}
```
