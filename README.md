# depends.cc

A lightweight, API-first dependency state service. Track the status of things and what they depend on.

**depends.cc** is a passive receiver — services push their state in; depends.cc computes the dependency graph and fires webhooks out. No polling, no crawlers.

## Core model

- **Nodes** are things (services, tasks, deploy steps) with a **state**: `green` (good), `yellow` (in progress / unknown), or `red` (error).
- **Edges** are dependencies. A node’s **effective state** is the worst of its own state and everything it depends on — so if a database goes red, every service that depends on it is effectively red too.
- **Namespaces** isolate graphs (e.g. per project or org).
- **Webhooks** fire when effective state changes; email notifications are supported as syntactic sugar.

## Quick start

```bash
# Install
curl -fsSL https://depends.cc/install.sh | sh

# Run locally (no signup needed)
depends serve

# In another terminal
depends init       # scaffold depends.yml
depends push       # sync to server
depends status     # see what's green, yellow, red
```

Or use the API directly:

```bash
# Sign up
curl -s -X POST http://localhost:3000/v1/signup

# Set state
curl -X PUT http://localhost:3000/v1/state/myproject/api-server/green \
  -H "Authorization: Bearer $DEPENDS_TOKEN"
```

## API overview

| Area | Endpoints |
|------|-----------|
| **Namespaces** | `POST /namespaces`, `DELETE /namespaces/{id}` |
| **Nodes** | `PUT/GET/DELETE /nodes/{ns}/{id}`, `GET /nodes/{ns}` |
| **State shorthand** | `PUT /state/{ns}/{id}/{state}` — state in path (no body). Optional headers: `X-Depends-Reason`, `X-Depends-Solution` |
| **Graph** | `GET /graph/{ns}`, subgraph, upstream, downstream, `?format=yaml` |
| **Events** | `GET /events/{ns}` — state transition history |
| **Notifications** | `PUT/GET/DELETE /notifications/{ns}` — webhooks and email rules |

Base path: `/v1`. Auth: Bearer token per namespace.

Define structure in a **`depends.yml`** file (nodes, `depends_on`, notifications); state is set at runtime via the API. Import/export: `PUT/GET /graph/{ns}` with `Content-Type: application/yaml`.

## Docs

| Doc | Description |
|-----|-------------|
| [docs/CONCEPT.md](docs/CONCEPT.md) | Full API, YAML format, schema, CLI spec, billing, examples |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Run locally, production deploy |
| [docs/UPDATES.md](docs/UPDATES.md) | Upgrading CLI, server, and database migrations |

## Deploy

- **Local:** `depends serve` or `bun run dev` (default port 3000; set `PORT` to override).
- **Production:** Clone repo, `bun install`, run `bun run src/server.ts`. Put nginx or Caddy in front for HTTPS.
- **Update:** `depends update` or `git pull && bun install`.

Database: SQLite in WAL mode — single file at `data/depends.db`, no extra infra. Backup with `cp data/depends.db data/depends.db.backup`.

## Tech

- **Runtime:** Bun (TypeScript)
- **Framework:** Elysia
- **Database:** SQLite (WAL), schema and details in [docs/CONCEPT.md](docs/CONCEPT.md)
- **Templates:** Eta

## License

MIT — see [LICENSE](LICENSE).
