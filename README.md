# depends.cc

A lightweight, API-first dependency state service. Track the status of things and what they depend on.

**depends.cc** is a passive receiver — services push their state in; depends.cc computes the dependency graph and fires webhooks out. No polling, no crawlers.

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
