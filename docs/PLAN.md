# depends.cc — Plan

## Done

### Spec
- [x] CONCEPT.md — full API design, YAML format, CLI spec, billing, schema
- [x] Fitpass example — `fitpass.depends.yml` with real service topology
- [x] Migration guide — MIGRATION.md for moving from polling to push model

### Server (Bun + SQLite)
- [x] Database layer — schema, WAL mode, foreign keys, cascades
- [x] Auth — token generation, hashing, verification
- [x] Namespace CRUD — create (returns one-time token), delete (cascades)
- [x] Node CRUD — create/update (patch semantics), get (with effective state), delete, list
- [x] State shorthand — `PUT /state/{ns}/{id}/{state}` (state in path, no body), auto-creates nodes
- [x] Dependency edges — `depends_on` on nodes, auto-creates referenced nodes
- [x] Cycle detection — rejects edges that would create cycles in the DAG
- [x] Effective state — computed on read via BFS, worst-of-tree propagation
- [x] TTL — nodes degrade green → yellow if no state write within TTL window
- [x] Graph endpoints — full graph, subgraph, upstream, downstream, state filter
- [x] YAML import/export — reconciles structure without resetting state, optional prune
- [x] Notification rules — CRUD, webhook + email (syntactic sugar), ack/suppress
- [x] Notification dispatch — fires on effective state transitions, cascades to downstream
- [x] Webhook sender — HMAC-SHA256 signing, retry with exponential backoff
- [x] Event log — every state transition recorded, queryable with since/limit
- [x] Usage endpoint — active nodes, total events, plan info
- [x] Plan limits — free tier enforced (10 nodes, 100 events/month), 402 on exceed
- [x] Tests — 99 tests across 8 files (db, auth, cycle, effective, TTL, webhook, dispatcher, full integration)

## To Do

### Before launch
- [ ] Email sending — wire up a provider (Resend) for `email://` notification rules
- [ ] CORS headers — allow browser-based API calls
- [ ] Rate limiting — per-token throttle to prevent free-tier abuse
- [ ] `bun build --compile` — build standalone binaries for linux-x64 and linux-arm64
- [ ] Deploy to depends.cc — server process, SQLite file on disk, HTTPS via reverse proxy

### CLI tool
- [ ] `depends init` — scaffold `depends.yml`
- [ ] `depends push` — upload YAML to API
- [ ] `depends pull` — download graph as YAML
- [ ] `depends status` — show node states with effective states (color-coded)
- [ ] `depends set <node> <state>` — shorthand for PUT /state
- [ ] `depends graph` — ASCII tree rendering
- [ ] `depends validate` — check for cycles, missing refs
- [ ] `depends diff` — show what would change on push
- [ ] Build binaries — macOS ARM/x86, Linux ARM/x86

### MCP server
- [ ] `depends_get_state` — get node state + effective state
- [ ] `depends_set_state` — update a node's state
- [ ] `depends_add_node` — create node with dependencies
- [ ] `depends_get_graph` — get dependency graph
- [ ] `depends_what_is_blocked` — list nodes with effective state != green

### Cross-namespace bridging
- [ ] **Webhook headers** — optional `headers` field on notification rules (a map: header name → value). You can pass multiple headers, e.g. `Authorization: Bearer <token>` and any custom headers, so the webhook request to the target includes them. This lets a webhook in namespace A call `PUT /state` on namespace B directly, no intermediary needed.
- [ ] **Webhook → PUT /state** — Optional `url` template so a webhook can set state in another namespace. Combined with `headers` for auth, a notification rule becomes a full bridge:
  ```yaml
  # In "fitpass" namespace — reports roll-up state to "boss" namespace
  report-to-boss:
    watch: "*"
    on: [red, green]
    url: https://api.depends.cc/v1/state/boss/fitpass/{{effective_state}}
    headers:
      Authorization: "Bearer dps_boss_token_here"
      X-Custom-Header: "optional"
  ```
  The `{{effective_state}}` template variable is resolved at fire time. This makes depends.cc its own webhook target — no glue code, no intermediary.

### Before real users
- [ ] Token rotation — `POST /namespaces/{ns}/rotate-token`
- [ ] Pagination — on list endpoints (nodes, events, notifications)
- [ ] Event retention — auto-cleanup of events older than 30 days
- [ ] Landing page at depends.cc
- [ ] Stripe integration for paid plans
