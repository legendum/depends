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

Base URL: `https://depends.cc/v1` (hosted), or `http://localhost:3000/v1` (self-hosted default).

### Modes

depends.cc runs in one of two modes, auto-detected at startup from the environment:

- **Self-hosted** (default, when `LEGENDUM_API_KEY` is *not* set): no authentication, no billing, no signup. Any request is accepted as the well-known local token. Namespaces are auto-created on first access. The `Authorization` header is optional and ignored.
- **Hosted** (when `LEGENDUM_API_KEY` *is* set): full bearer-token authentication, per-account billing via Legendum, signup flow.

The API surface is identical in both modes; the difference is only in auth and billing.

### Authentication (hosted mode)

Bearer token per account: `Authorization: Bearer dep_...`. A single token grants access to all namespaces owned by that account. Tokens are obtained via `POST /v1/signup` and stored as hashes — depends.cc cannot recover a lost token.

### Signup (hosted mode only)

```
POST /v1/signup     — Create an account and receive an API token by email
```

```json
{
  "email": "you@example.com",
  "account_key": "lak_..."
}
```

The `account_key` is a Legendum account key (`lak_...`) obtained from [legendum.co.uk](https://legendum.co.uk/account). depends.cc links the key to the service, generates a `dep_...` token, and emails it to the address on file. The response confirms the account was created but does not include the token.

In self-hosted mode this endpoint is unused — there is no signup, and any request is already authorised.

### Namespaces

```
POST   /namespaces                            — Create a namespace (auth required in hosted mode)
DELETE /namespaces/{namespace}                — Delete a namespace and all its data
```

#### POST /namespaces

```json
{ "id": "acme" }
```

Returns `201 Created` on success, `409 Conflict` if the namespace already exists on this account. Unlike earlier drafts, the response does **not** include a token — the token is the one you already hold from signup, and it covers every namespace you create.

In self-hosted mode, namespaces are also auto-created on first access, so calling this endpoint is optional.

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
  "reason": "disk full on /var/data",
  "solution": "Check disk usage (df -h), clear logs, expand volume.",
  "state_changed_at": "2026-03-14T10:30:00Z",
  "updated_at": "2026-03-14T10:30:00Z"
}
```

Note: `effective_state` is `red` here because a dependency (e.g., `database`) is red, even though this node's own `state` is `green`. `reason` and `solution` are optional values set via the `X-Reason` and `X-Solution` headers on state updates.

### State (shorthand)

For quick fire-and-forget state updates, put the state in the path — no body:

```
PUT /state/{namespace}/{node-id}/{state}
```

`{state}` is one of `green`, `yellow`, or `red`. Returns `204 No Content`. Auto-creates the node if it doesn't exist (with no dependencies). One curl call:

```bash
curl -X PUT https://depends.cc/v1/state/acme/api-server/green \
  -H "Authorization: Bearer $DEPENDS_TOKEN"
```

Optionally include a reason and a recommended solution via headers (the caller knows both):

```bash
curl -X PUT https://depends.cc/v1/state/acme/api-server/red \
  -H "Authorization: Bearer $DEPENDS_TOKEN" \
  -H "X-Reason: disk full on /var/data" \
  -H "X-Solution: Check disk usage (df -h), clear logs, expand volume."
```

`reason` and `solution` are stored on the node and included in webhook payloads and event history. They answer "why is this red?" and "what should I do?"

### Events (history)

```
GET /events/{namespace}                    — All events in a namespace
GET /events/{namespace}/{node-id}          — Events for a specific node
```

Query params:
- `?since=2026-03-14T00:00:00Z` — Events after this timestamp
- `?limit=100` — Max events to return (default 100, max 1000)
- `?order=desc` — Newest first (default is oldest first)

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
      "reason": "disk full on /var/data",
      "solution": "Check disk usage (df -h), clear logs, expand volume.",
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
    { "id": "database", "state": "red", "effective_state": "red", "label": "PostgreSQL Primary", "reason": "disk full on /var/data", "solution": "Check disk usage (df -h), clear logs, expand volume." },
    { "id": "auth-service", "state": "green", "effective_state": "green", "label": "Auth Service", "reason": null, "solution": null },
    { "id": "payment-service", "state": "green", "effective_state": "red", "label": "Payment Service", "reason": null, "solution": null },
    { "id": "checkout-flow", "state": "green", "effective_state": "red", "label": "Checkout Flow", "reason": null, "solution": null }
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
  "solution": "Check disk usage (df -h), clear logs, expand volume.",
  "triggered_rule": "alert-on-red",
  "timestamp": "2026-03-14T10:30:00Z"
}
```

Headers:
- `X-Signature`: HMAC-SHA256 of the body using the `secret`, for authenticity verification.

On non-2xx response or network error: retries 3 times with exponential backoff (1s, then 4s between attempts), then logs a `webhook_failed` entry to `log/YYYY-MM-DD.log` and stops. Notification dispatch never blocks on webhook delivery — state writes succeed even if the webhook is unreachable.

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

A rule has either `"url"` (webhook) or `"email"`, never both. Webhooks are delivered via HTTP POST with HMAC signing; emails are delivered via SMTP using `nodemailer` (configured via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Both carry the same payload shape — the email just renders it as a human-readable message with a link to the graph.

Webhook retries: 3 attempts with exponential backoff (1s, then 4s). Failures after the last attempt are logged as `webhook_failed` entries in `log/YYYY-MM-DD.log` and the notification is dropped — depends.cc never queues failed deliveries for later retry. Email failures are logged as `email_failed` entries in the same file.

`depends.yml` values for `url` (and `secret`) support `${VAR}` and `${VAR:-default}` expansion from the environment on push. An unset variable with no default fails the push, so a literal `${ALERTING_WEBHOOK_URL}` can never be silently stored as a rule URL.

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
depends serve [-p <port>]               — Run the server locally (self-hosted)
depends signup <email> <lak_...>        — Create a hosted account (emails you a token)
depends init                            — Create a depends.yml in the current directory
depends push [--prune]                  — Upload depends.yml (auto-creates namespace)
depends pull                            — Download the current graph as depends.yml
depends show                            — Print the current spec (YAML) without saving
depends status [<node-id>]              — Show node states (color-coded)
depends set [<ns>/]<node-id> <state>    — Set a node's state (green/yellow/red)
depends graph                           — Print the dependency tree (ASCII)
depends events [<ns/node>]              — Show recent state changes
depends validate                        — Check depends.yml for errors
depends delete                          — Delete a namespace and all its data
depends usage                           — Show usage stats for current billing period
depends check [--dry-run]               — Run meta.checks and update state
depends diff                            — Show what would change on push
depends update                          — Update to the latest version
depends admin tokens                    — List all tokens (server admin)
depends admin plan <email> [plan]       — Show or set plan for an email
```

Install via the install script:

```bash
curl -fsSL https://depends.cc/install.sh | sh
```

This clones the repo to `~/.config/depends/src` and links the CLI globally via `bun link`. Update with `depends update`.

Configuration in `~/.config/depends/config.yml`:

```yaml
default_namespace: myproject
token: dep_...                    # omit in self-hosted mode
api_url: https://depends.cc/v1    # override to e.g. http://localhost:3000/v1 for self-hosted
```

Or via environment variables: `DEPENDS_TOKEN`, `DEPENDS_NAMESPACE`, `DEPENDS_API_URL`, `DEPENDS_CONFIG` (path to a non-default config file).

`depends.yml` itself supports environment variable expansion on push — `${VAR}` and `${VAR:-default}` references are substituted from `process.env` when the CLI reads the file (see `src/cli/lib/yaml.ts`). An unset variable with no default causes `depends push` (and `validate`, `diff`, `check`) to exit with an error, so you can safely reference secrets like `${ALERTING_WEBHOOK_URL}` in committed YAML.

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
# Sign up (hosted mode) — the token is emailed to the address Legendum has on file.
# You only do this once per account. In self-hosted mode, skip this step entirely.
curl -s -X POST https://depends.cc/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "account_key": "lak_..."}'

export DEPENDS_TOKEN=dep_...    # from the email

# Create a namespace under your account
curl -s -X POST https://depends.cc/v1/namespaces \
  -H "Authorization: Bearer $DEPENDS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": "myproject"}'

# Define the graph structure (or use `depends push` with a YAML file)
curl -X PUT https://depends.cc/v1/nodes/myproject/api-server \
  -H "Authorization: Bearer $DEPENDS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "API Server"}'

curl -X PUT https://depends.cc/v1/nodes/myproject/worker \
  -H "Authorization: Bearer $DEPENDS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "Background Worker", "depends_on": ["api-server"]}'

# Set up notifications
curl -X PUT https://depends.cc/v1/notifications/myproject \
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
  await fetch(`https://depends.cc/v1/state/myproject/api-server/${state}`, {
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

The canonical schema lives in [`src/db.ts`](../src/db.ts). Reproduced here for reference — if the two ever disagree, trust the source.

```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

-- Accounts. In self-hosted mode a single row with id=0 represents the
-- local token; in hosted mode each signup creates a row.
CREATE TABLE tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash      TEXT NOT NULL UNIQUE,
  email           TEXT,
  legendum_token  TEXT,          -- opaque Legendum service token (hosted mode)
  meta            TEXT DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Namespaces are owned by a token. The same namespace id can exist under
-- different tokens without colliding.
CREATE TABLE namespaces (
  ns_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL,
  token_id    INTEGER NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(token_id, id)
);

CREATE TABLE nodes (
  ns_id            INTEGER NOT NULL REFERENCES namespaces(ns_id) ON DELETE CASCADE,
  id               TEXT NOT NULL,
  label            TEXT,
  state            TEXT NOT NULL DEFAULT 'yellow' CHECK (state IN ('green', 'yellow', 'red')),
  default_state    TEXT CHECK (default_state IN ('green', 'yellow', 'red')),
  meta             TEXT,
  reason           TEXT,
  solution         TEXT,
  ttl              INTEGER,       -- seconds; null = no TTL
  last_state_write TEXT,          -- last successful state PUT (used for TTL/usage)
  state_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ns_id, id)
);

CREATE TABLE edges (
  ns_id     INTEGER NOT NULL,
  from_node TEXT NOT NULL,
  to_node   TEXT NOT NULL,
  PRIMARY KEY (ns_id, from_node, to_node),
  FOREIGN KEY (ns_id, from_node) REFERENCES nodes(ns_id, id) ON DELETE CASCADE,
  FOREIGN KEY (ns_id, to_node)   REFERENCES nodes(ns_id, id) ON DELETE CASCADE
);

CREATE TABLE notification_rules (
  ns_id         INTEGER NOT NULL REFERENCES namespaces(ns_id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  watch         TEXT NOT NULL DEFAULT '*',
  on_state      TEXT NOT NULL DEFAULT 'red',  -- "red", "green", "yellow", "red,green", or "*"
  url           TEXT,
  email         TEXT,
  secret        TEXT,                          -- HMAC secret (webhooks)
  ack           INTEGER NOT NULL DEFAULT 0,    -- when true, auto-suppresses after firing
  ack_token     TEXT,                          -- opaque token used in the unauthenticated ack URL
  suppressed    INTEGER NOT NULL DEFAULT 0,    -- set to 1 after firing (if ack=1), reset via /v1/ack/:token
  last_fired_at TEXT,
  CHECK (url IS NOT NULL OR email IS NOT NULL),
  PRIMARY KEY (ns_id, id)
);

-- Every state transition is logged. Foundation for usage counters and history.
CREATE TABLE events (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  ns_id                    INTEGER NOT NULL REFERENCES namespaces(ns_id) ON DELETE CASCADE,
  node_id                  TEXT NOT NULL,
  previous_state           TEXT,            -- null on first write
  new_state                TEXT NOT NULL,
  previous_effective_state TEXT,
  new_effective_state      TEXT NOT NULL,
  reason                   TEXT,
  solution                 TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_ns      ON events(ns_id, created_at);
CREATE INDEX idx_events_node    ON events(ns_id, node_id, created_at);
CREATE INDEX idx_events_node_id ON events(ns_id, node_id, id);
CREATE INDEX idx_edges_to_node  ON edges(ns_id, to_node);
```

### Project Structure

```
depends/
├── src/
│   ├── server.ts             — Bun HTTP server entry point
│   ├── db.ts                 — SQLite connection, schema, WAL setup
│   ├── auth.ts               — Token generation, hashing, verification
│   ├── ratelimit.ts          — Per-IP rate limiting (hosted mode)
│   ├── server/
│   │   ├── middleware.ts     — Mode detection, auth, local-request helpers
│   │   └── routes/           — Route registration (v1, public, namespaces)
│   ├── routes/               — Route handlers (nodes, state, graph, events,
│   │                           notifications, namespaces, usage)
│   ├── graph/
│   │   ├── effective.ts      — Effective state computation (DAG traversal)
│   │   ├── cycle.ts          — Cycle detection
│   │   └── yaml.ts           — YAML import/export, reconciliation
│   ├── notify/
│   │   ├── dispatcher.ts     — Notification evaluation and dispatch
│   │   ├── webhook.ts        — Webhook sender (HMAC, retries, failure logging)
│   │   └── email.ts          — SMTP sender via nodemailer
│   ├── lib/
│   │   ├── charge.ts         — Legendum billing wrapper (local credit tab)
│   │   ├── legendum.js       — Legendum SDK (vendored; excluded from lint)
│   │   └── log.ts            — Shared JSON-line logger (writes log/YYYY-MM-DD.log)
│   └── cli/
│       ├── main.ts           — CLI entry point (`depends` command)
│       ├── commands/         — Subcommands: push, pull, check, diff, …
│       └── lib/              — Config loading, YAML env-var expansion, API helper
├── views/                    — Eta templates (HTML pages + email templates)
├── data/
│   └── depends.db            — SQLite database (gitignored)
├── log/                      — Daily JSON-line access and error logs (gitignored)
├── tests/                    — Bun test suite
├── biome.json                — Linter/formatter config
├── package.json
└── docs/
    ├── CONCEPT.md            — This file
    ├── DEPLOY.md             — Deployment guide
    └── UPDATES.md            — Upgrade and migration guide
```

### Why Bun + SQLite

- **Zero infra** — clone, `bun install`, run. No build step needed.
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

depends.cc bills per action, in whole Legendum credits. Billing is applied only in **hosted mode** (when `LEGENDUM_API_KEY` is set). Self-hosted deployments skip all charges — every `chargeCredits` / `chargeStateWrite` short-circuits when the account's `legendum_token` is null.

| Action | Cost | When it's charged |
|---|---|---|
| Node create | 1 credit | Immediately, on the request that creates the node (`POST /nodes` or the auto-create path of `PUT /state`) |
| State write | 0.1 credit | Accumulated on a local tab; flushed to Legendum as an integer charge once the tab reaches the flush threshold |
| Webhook delivery | 2 credits | Best-effort, immediately, per successful dispatch attempt (charge failures don't block the webhook) |
| Email delivery | 2 credits | Best-effort, immediately, per successful send |
| Graph import | 1 credit per new node | One aggregated charge on `PUT /graph` before the transaction runs |

Insufficient funds for a node create or a state-write flush returns `402 Payment Required` with a body pointing at `legendum.co.uk/account`. Reads, graph queries, and event history continue to work regardless of balance — we never break visibility.

### How the state-write tab works

Legendum's `/api/charge` endpoint only accepts positive integer amounts, so depends.cc keeps a per-token in-memory tab (`src/lib/charge.ts`) that adds `0.1` per state write. Once `tab.total` reaches the flush threshold (currently `2`), depends.cc POSTs `Math.floor(tab.total)` to Legendum as a single integer charge and carries the fractional remainder forward. In steady state this means roughly **one Legendum API call per 20 state writes**. On graceful shutdown, `flushAllTabs()` charges `Math.round(tab.total)` (dropping anything below 0.5). If a charge fails for a reason other than `insufficient_funds`, the failed amount is rolled back onto the tab so no credits are silently lost.

The events table is still the source of truth for usage counters (it is not used to compute charges — it's an audit trail).

### Usage endpoint

```
GET /usage/{namespace}
```

```json
{
  "email": "ops@example.com",
  "namespace": "acme",
  "period": "2026-04",
  "nodes": 28,
  "active_nodes": 14,
  "total_events": 1423,
  "webhook_deliveries": 47,
  "emails_sent": 3
}
```

`active_nodes` counts distinct `node_id`s that received a state write this calendar month; `nodes` is the total row count in the `nodes` table regardless of activity; `email` is the account email from the `tokens` row (null in self-hosted mode).
