# depends.cc

A lightweight, API-first dependency state service. Track the status of things and what they depend on.

**depends.cc** is a passive receiver — services push their state in; depends.cc computes the dependency graph and fires webhooks out. No polling, no crawlers.

> **For LLM agents reading this for the first time:** depends.cc is a SQLite-backed service that stores a DAG of named "nodes" (each `green`/`yellow`/`red`) and fires webhooks when the effective state of a node — defined as the worst state along its dependency closure — changes. Structure (nodes, edges, notification rules) lives in `depends.yml`; runtime state is set via the API. The server never reaches out on its own. Before changing behavior, read the [Repo map](#repo-map) and the [Invariants](#invariants--things-that-are-not-true) section so you don't make assumptions that the codebase deliberately rejects.

## Core model

- **Nodes** are things (services, tasks, deploy steps) with a **state**: `green` (good), `yellow` (in progress / unknown), or `red` (error).
- **Edges** are dependencies. A node's **effective state** is the worst of its own state and everything it depends on — so if a database goes red, every service that depends on it is effectively red too.
- **Namespaces** isolate graphs (e.g. per project or org).
- **Webhooks** fire when effective state changes; email notifications are supported alongside webhooks.

## Two modes

depends.cc runs in one of two modes, auto-detected at startup:

- **Self-hosted (default)** — no authentication, no billing, no signup. Any request is accepted as the well-known local token and namespaces are auto-created on first use. Perfect for running `depends serve` on your laptop or inside a private network.
- **Hosted (depends.cc)** — enabled automatically when `LEGENDUM_API_KEY` is set in the environment. Bearer-token auth, per-account Legendum billing, signup flow, email delivery of tokens.

You don't configure the mode explicitly; setting (or not setting) `LEGENDUM_API_KEY` is the switch.

## Quick start

```bash
# Install
curl -fsSL https://depends.cc/install.sh | sh

# Run locally (self-hosted, no signup needed)
depends serve

# In another terminal
depends init       # scaffold depends.yml
depends push       # sync to server
depends status     # see what's green, yellow, red
```

Or use the API directly against the local server (no auth):

```bash
curl -X PUT http://localhost:3000/v1/state/myproject/api-server/green
```

To use the hosted service, sign up first (you'll need a Legendum account key, `lak_...`):

```bash
depends signup you@example.com lak_...
# token is emailed to the address Legendum has verified for your account
```

## API overview

| Area | Endpoints |
|------|-----------|
| **Signup** (hosted only) | `POST /v1/signup` |
| **Namespaces** | `POST /namespaces`, `DELETE /namespaces/{id}` |
| **Nodes** | `PUT/GET/DELETE /nodes/{ns}/{id}`, `GET /nodes/{ns}` |
| **State shorthand** | `PUT /state/{ns}/{id}/{state}` — state in path (no body). Optional headers: `X-Reason`, `X-Solution` |
| **Graph** | `GET /graph/{ns}`, subgraph, upstream, downstream, `?format=yaml`; `PUT /graph/{ns}` for YAML import |
| **Events** | `GET /events/{ns}` — state transition history |
| **Notifications** | `PUT/GET/DELETE /notifications/{ns}`, `POST /notifications/{ns}/{rule}/ack` |
| **Usage** | `GET /usage/{ns}` — counters for the current billing period |

Base path: `/v1`. Auth in hosted mode: `Authorization: Bearer dep_...` token (per-account, not per-namespace). In self-hosted mode the header is optional and ignored.

Define structure in a **`depends.yml`** file (nodes, `depends_on`, notifications); state is set at runtime via the API. Import/export: `PUT/GET /graph/{ns}` with `Content-Type: application/yaml`. `${VAR}` and `${VAR:-default}` references in `depends.yml` are expanded from the environment on push; an unset variable with no default fails the push loudly.

### Health checks

Nodes can declare HTTP health checks under `meta.checks`. Run `depends check` (typically from cron) to fetch each URL and update the node's state to `green` or `red` based on whether the response body contains the expected string(s).

```yaml
nodes:
  api-server:
    label: API
    meta:
      checks:
        # Single string — body must contain it
        - url: https://api.example.com/health
          grep: '"status":"ok"'

        # Array of strings — all must be present, fetched once
        - url: https://api.example.com/version
          grep:
            - '"build"'
            - '"commit"'
```

`grep` accepts either a single string or an array. With an array, the URL is fetched once and every term must appear in the body. Listing the same URL in two separate check entries will fetch it twice — use the array form to share one fetch.

### `depends.yml` schema

Minimal-but-complete example showing every supported field:

```yaml
namespace: myproject

nodes:
  database:
    label: Postgres primary
    default_state: green        # state used when the node is first created
    meta:
      owner: platform-team

  api-server:
    label: API
    depends_on:
      - database
    meta:
      url: https://api.example.com
      checks:
        - url: https://api.example.com/health
          grep: '"status":"ok"'

notifications:
  oncall:
    watch: api-server           # node id, or "*" for all nodes (default "*")
    on: [red, yellow]           # state(s) that trigger; string or array; default "red"
    url: https://hooks.slack.com/services/...
    secret: shhh                # optional HMAC secret (see X-Signature below)
    ack: true                   # if true, rule self-suppresses after firing until acked
  email-team:
    watch: "*"
    on: red
    email: true                 # sends to the email on file for this account's token
```

Notes on what is and isn't in the YAML:
- `ttl` is **not** set via YAML import — set it per-node via the API (`PUT /v1/nodes/{ns}/{id}` with `{"ttl": "10m"}`, accepting `s`/`m`/`h`/`d`).
- `state` is never in the YAML — state is runtime data, set via the API. Importing a YAML never resets node states.
- Cycles are rejected on import (`Cycle detected: a -> b would create a cycle`).
- `${VAR}` and `${VAR:-default}` in the YAML are expanded from the environment on push; missing required vars fail loudly.

### Notification rules

| Field | Type | Default | Meaning |
|---|---|---|---|
| `watch` | string | `"*"` | Node id to watch, or `"*"` for any node in the namespace |
| `on` | string \| string[] | `"red"` | State(s) that trigger the rule. `"*"` matches any |
| `url` | string | — | Webhook URL (POST JSON) |
| `email` | boolean | `false` | Send email to the account's verified address |
| `secret` | string | — | HMAC-SHA256 secret for `X-Signature` |
| `ack` | boolean | `false` | If true, rule self-suppresses after firing once and stays silent until acked |

The rule fires when a node's **effective state** transitions and the new effective state matches `on` for a node matching `watch`. With `ack: true`, the firing dispatches the webhook/email and then sets `suppressed = 1` on the rule — further state changes do nothing until someone visits the `ack_url` from the payload, which clears the suppression and re-arms the rule.

### Effective state

The effective state of a node is the **worst** of its own resolved state and every node it transitively depends on, with priority `red > yellow > green`. Resolved state is normally just the node's stored state, with one exception: if the node has a `ttl` set, is currently `green`, and `now - last_state_write > ttl`, it resolves to `yellow` (a stale heartbeat). TTL never escalates a non-green state. Cycles are rejected at import time, so the traversal terminates.

### TTL semantics

- Set per-node via the API with strings like `30s`, `10m`, `2h`, `7d`.
- TTL is a **liveness check** on green nodes: if no state write arrives within the TTL window, the node's effective state degrades to `yellow`. The next state write resets the clock.
- A node sitting at `yellow` or `red` is unaffected by TTL — it stays where it is until something writes to it.
- TTL expiry is computed lazily on read; there's no background sweeper, so a TTL flip only triggers webhooks when something else causes a graph evaluation. (Run `depends check` from cron, or write any state, to force evaluation.)

### Auth & tokens

- **Hosted mode** uses `Authorization: Bearer dep_...` tokens. One token per account, not per namespace — the token grants access to every namespace owned by that account. Tokens are issued at signup (emailed) and can be listed/managed by server admins via `depends admin tokens`. There is no end-user rotation flow yet — contact the server admin if you need a new token.
- **Self-hosted mode** uses a well-known token, `dep_local`. Any bearer (or no bearer) is accepted and silently mapped to this token, so curl-against-localhost just works.

### Ack flow

When a webhook payload includes `ack_url`, that URL is a single GET that clears the rule's `suppressed` flag and re-arms it. There is no payload, no auth, and no expiry — the security is the unguessability of the token in the path. Acking does not change any node state; it only unsilences the notification rule. If `ack: true` is not set on the rule, no `ack_url` is included and the rule fires on every matching transition.

### Verifying `X-Signature`

When a rule has a `secret`, the webhook request includes:

```
X-Signature: <hex hmac-sha256 of the raw request body>
```

Verification recipe:

```python
import hmac, hashlib
expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(expected, request.headers["X-Signature"])
```

Compare against the **raw body bytes**, not a re-serialized JSON.

### Error responses

All API errors return JSON with a single `error` field and an appropriate HTTP status:

```json
{ "error": "Invalid state. Use green, yellow, or red." }
```

Common cases: `400` for validation (bad state, bad TTL format, cycle detected), `401` for missing/invalid token (hosted mode), `404` for unknown namespace/node, `402` for insufficient Legendum credits (hosted mode).

### CLI commands

```
depends init                            Scaffold depends.yml
depends push [--prune]                  Sync depends.yml to the server
depends pull                            Fetch namespace YAML from the server
depends show                            Print the current spec without saving
depends status [<node-id>]              Show node states (color-coded)
depends set [<ns>/]<node-id> <state>    Set a node's state
depends graph                           Print the dependency tree (ASCII)
depends events [<ns/node>]              Recent state changes
depends validate                        Check depends.yml for errors
depends delete                          Delete a namespace and all its data
depends usage                           Usage stats for current billing period
depends check [--dry-run]               Run meta.checks and update state
depends diff                            Show what would change on push
depends update                          Update to the latest CLI version
depends admin tokens                    List all tokens (server admin)
depends admin plan <email> [plan]       Show or set a plan for an email
```

### Webhook payload

When a node's effective state changes and a notification rule fires, depends.cc POSTs JSON to the rule's `url` (and/or sends an email). Payload shape:

```json
{
  "event": "effective_state_changed",
  "namespace": "myproject",
  "node_id": "api-server",
  "state": "red",
  "effective_state": "red",
  "previous_effective_state": "green",
  "reason": "health check failed: timeout",
  "solution": "check service health",
  "triggered_rule": "oncall",
  "timestamp": "2026-04-07T12:34:56.000Z",
  "title": "myproject/api-server is red",
  "body": "health check failed: timeout",
  "ack_url": "https://depends.cc/v1/ack/<token>"
}
```

`title` is always `"{namespace}/{node_id} is {state}"`. `body` is the node's `reason` if set, otherwise `"was {previous_state}"`. `ack_url` is only included when the rule has an ack token. If the rule has a `secret`, the request includes an `X-Signature` header containing the HMAC-SHA256 of the raw body. Email notifications use the same `title` and `body` for subject and content.

## End-to-end example

A complete walkthrough — five commands, one webhook, one ack — against a self-hosted server on `localhost:3000`.

```bash
# 1. Start the server (in another terminal)
depends serve

# 2. Write a depends.yml
cat > depends.yml <<'YAML'
namespace: demo
nodes:
  database:
    label: Postgres
  api:
    label: API
    depends_on: [database]
notifications:
  oncall:
    watch: api
    on: [red]
    url: https://webhook.site/your-uuid-here
    secret: hunter2
    ack: true
YAML

# 3. Push it
depends push

# 4. Mark the database red — this cascades: api's effective state goes red too
depends set demo/database red
```

What happens next, server-side:
- `database` flips `green → red`. Effective state recomputes for `database` and every node that transitively depends on it (here: `api`).
- `api`'s effective state goes from `green` to `red` (worst of its own `green` and the new `red` from `database`).
- The `oncall` rule matches (`watch: api`, `on: [red]`) and fires a single POST to the webhook URL:

```json
{
  "event": "effective_state_changed",
  "namespace": "demo",
  "node_id": "api",
  "state": "red",
  "effective_state": "red",
  "previous_effective_state": "green",
  "reason": null,
  "solution": null,
  "triggered_rule": "oncall",
  "timestamp": "2026-04-07T12:34:56.000Z",
  "title": "demo/api is red",
  "body": "was green",
  "ack_url": "http://localhost:3000/v1/ack/<token>"
}
```

The request includes `X-Signature: <hex hmac-sha256 of raw body using "hunter2">`. Because `ack: true`, the rule is now suppressed and will *not* fire again on further `api` transitions until someone GETs the `ack_url`.

```bash
# 5. Resolve and re-arm
depends set demo/database green   # api's effective state goes back to green (no fire — rule is suppressed)
curl http://localhost:3000/v1/ack/<token>   # un-suppress; rule is live again
```

## Invariants — "things that are NOT true"

A list of assumptions that look reasonable but are wrong. Each one is enforced by code somewhere in this repo; future-you should not try to "fix" them.

- **The server never polls anything.** `depends check` is a CLI subcommand you run from *your* cron — the server has no scheduler, no background jobs, no outbound fetcher. The only outbound HTTP the server itself makes is webhook delivery on state change.
- **State is never stored in `depends.yml`.** YAML describes structure (nodes, edges, notification rules); state is runtime-only and lives in SQLite. Importing a YAML never resets state — existing nodes keep their colors.
- **`ttl` is not set via the YAML import path.** Even though TTL is a per-node field, `src/graph/yaml.ts` does not read it. Set TTL via the API or per-node CLI commands.
- **TTL only escalates `green → yellow`.** A stale `yellow` or `red` node stays where it is. TTL is a liveness check on healthy nodes, not a generic timeout.
- **TTL has no background sweeper.** Expiry is computed lazily on read. A node can sit silently expired until something — a state write, a graph read, a `depends check` — causes evaluation. If you need timely TTL flips, run `depends check` from cron.
- **Tokens are per-account, not per-namespace.** One `dep_...` token grants access to every namespace owned by that account. There is no per-namespace scoping and no end-user rotation flow.
- **Cycles are rejected at import time.** Effective-state traversal therefore always terminates; you do not need to defend against cycles in graph code.
- **Self-hosted mode accepts any bearer (or none).** Don't add "auth" to a self-hosted code path — `isSelfHosted()` already maps every request to the well-known `LOCAL_TOKEN`. Adding checks will break the FOSS UX.
- **Acking does not change node state.** `ack_url` only clears a notification rule's `suppressed` flag; it doesn't touch any node's color.
- **Webhook signatures are over the raw body.** Don't re-serialize JSON before HMACing — the receiver compares against bytes-on-the-wire.

## Repo map

Where to look first when you need to understand a specific subsystem:

| To understand… | Read |
|---|---|
| Effective-state algorithm, TTL resolution, traversal | `src/graph/effective.ts` |
| Webhook & email dispatch, ack suppression, payload construction | `src/notify/dispatcher.ts` |
| Webhook delivery, retry, `X-Signature` HMAC | `src/notify/webhook.ts` |
| YAML import/export, cycle rejection, what fields are read | `src/graph/yaml.ts` |
| Node CRUD routes, TTL parsing, cycle detection on edge insert | `src/routes/nodes.ts` |
| Notification rule CRUD, ack-token issuance | `src/routes/notifications.ts` |
| Auth, `LOCAL_TOKEN`, hosted vs self-hosted bearer handling | `src/auth.ts`, `src/server/middleware.ts` |
| SQLite schema, `parseTtl`, migrations | `src/db.ts` |
| CLI entry point and command dispatch | `src/cli/main.ts` |
| `depends check` (HTTP health checks → state writes) | `src/cli/commands/check.ts` |
| Server bootstrap, mode detection, route mounting | `src/server.ts`, `src/server/routes/v1.ts` |

## Glossary

- **Namespace** — an isolated graph, identified by a string id (e.g. `myproject`). All nodes, edges, and notification rules live inside one namespace.
- **Node** — a thing being tracked. Has a stable id, a `state` (`green`/`yellow`/`red`), an optional `label`, optional `meta` (free-form JSON), optional `default_state`, and optional `ttl`.
- **Edge** — a `depends_on` relationship from one node to another. Directed. Cycles are rejected.
- **State** — the raw color you wrote, exactly as set via the API.
- **Effective state** — the *computed* color: the worst of the node's resolved state and the resolved state of every node it transitively depends on. This is what webhooks fire on.
- **Resolved state** — a node's state after applying TTL: normally just `state`, but `green` flips to `yellow` if `last_state_write` is older than `ttl`.
- **Notification rule** — a webhook + email definition (`watch`, `on`, `url`, `email`, `secret`, `ack`) that fires when an effective-state transition matches it.
- **Watch / on** — `watch` is the node id (or `"*"`) the rule listens to; `on` is the state(s) (string, array, or `"*"`) that trigger it.
- **Ack** — when a rule has `ack: true`, firing it sets `suppressed = 1` so it stops firing until someone GETs the `ack_url` from the payload, which clears the flag.
- **`LOCAL_TOKEN`** — the well-known string `dep_local`. In self-hosted mode every request is silently mapped to this token; auth is effectively bypassed.
- **Legendum** — the external billing backend used in hosted mode. depends.cc charges Legendum credits for node creation, state writes, and notification deliveries via the Legendum SDK. In self-hosted mode (`LEGENDUM_API_KEY` unset) all charge calls are no-ops. See [`src/lib/legendum.js`](src/lib/legendum.js).
- **Hosted mode / self-hosted mode** — auto-detected at startup based on whether `LEGENDUM_API_KEY` is set in the environment. Hosted = bearer auth + billing + email; self-hosted = neither.

## Common pitfalls

- **TTL didn't fire a webhook.** TTL is evaluated lazily — nothing happens until a read or write triggers re-evaluation. Run `depends check` (or any state write) from cron if you need timely TTL flips.
- **Webhook signature mismatch.** HMAC the raw request body bytes, not a re-serialized JSON object. Key ordering and whitespace matter.
- **YAML import "lost" my node states.** It didn't — YAML is structure-only. Check that your YAML hasn't deleted the node by name (use `--prune` only when you mean it).
- **`ttl: 10m` in `depends.yml` was ignored.** Correct — the YAML importer doesn't read `ttl`. Set it via `PUT /v1/nodes/{ns}/{id}` with `{"ttl": "10m"}`.
- **Self-hosted server "isn't checking my token".** That's by design. In self-hosted mode every bearer becomes `LOCAL_TOKEN`. If you want auth, set `LEGENDUM_API_KEY` to enter hosted mode.
- **Notification rule fired once and then went silent.** It probably has `ack: true`. GET the `ack_url` from the original webhook to re-arm it.
- **Adding a `depends_on` returns "Cycle detected".** Cycles are rejected on both YAML import and edge insertion. Restructure the graph.

## Running tests

```bash
bun install
bun test                    # full suite
bun test tests/check.test.ts   # one file
```

Tests use an in-memory SQLite via `createTestDb()` and a mocked Legendum client (see `tests/cli.test.ts` for the standard setup pattern).

## Billing (hosted mode)

depends.cc bills per action, in whole Legendum credits:

| Action | Cost |
|---|---|
| Node create | 1 credit |
| State write | 0.1 credit |
| Webhook delivery | 2 credits |
| Email delivery | 2 credits |

State writes accumulate locally and are flushed to Legendum as integer charges (one API call per ~20 writes), so there is no fractional billing traffic. Self-hosted mode skips all charges.

## Docs

| Doc | Description |
|-----|-------------|
| [docs/CONCEPT.md](docs/CONCEPT.md) | Full API, YAML format, schema, CLI spec, billing, examples |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Run locally, production deploy, environment variables |
| [docs/UPDATES.md](docs/UPDATES.md) | Upgrading CLI, server, and database migrations |

## Deploy

- **Local (self-hosted):** `depends serve` or `bun run dev` (default port 3000; set `PORT` to override).
- **Production (hosted):** Clone repo, `bun install`, set `LEGENDUM_API_KEY` and SMTP env vars, run `bun run src/server.ts`. Put nginx or Caddy in front for HTTPS.
- **Update:** `depends update` or `git pull && bun install`.

Database: SQLite in WAL mode — single file at `data/depends.db`, no extra infra. Backup with `cp data/depends.db data/depends.db.backup`.

Logs: structured JSON-line access and error logs in `log/YYYY-MM-DD.log` (webhook failures, email failures, and request access logs share the same file).

## Tech

- **Runtime:** Bun (TypeScript)
- **Framework:** Elysia
- **Database:** SQLite (WAL), schema and details in [docs/CONCEPT.md](docs/CONCEPT.md)
- **Templates:** Eta
- **Billing:** Legendum SDK (hosted mode only)
- **Email:** nodemailer over SMTP (hosted mode only)

## License

MIT — see [LICENSE](LICENSE).
