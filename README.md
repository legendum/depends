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
bun install
bun run dev    # http://localhost:3000
```

Create a namespace and set state:

```bash
# Create namespace (token shown once — save it)
curl -s -X POST http://localhost:3000/v1/namespaces \
  -H "Content-Type: application/json" \
  -d '{"id": "myproject"}' | jq .

# Set state (state in path, no body)
curl -X PUT http://localhost:3000/v1/state/myproject/api-server/green \
  -H "Authorization: Bearer YOUR_TOKEN"
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
| [docs/PLAN.md](docs/PLAN.md) | Implementation status and roadmap |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Run locally, build binary, production deploy |
| [docs/examples/MIGRATION.md](docs/examples/MIGRATION.md) | Migrating from polling to push (e.g. status pages) |
| [docs/examples/fitpass.depends.yml](docs/examples/fitpass.depends.yml) | Example dependency graph |

## Deploy

- **Dev:** `bun run dev` or `bun run start` (default port 3000; set `PORT` to override).
- **Binary:** `bun build --compile src/server.ts --outfile depends-server` (optionally with `--target=bun-linux-x64` etc.).
- **Production:** Run the binary; it creates `depends.db` in the working directory. Put nginx or Caddy in front for HTTPS.

Database: SQLite in WAL mode — single file, no extra infra. Backup with `cp depends.db depends.db.backup`.

## Tech

- **Runtime:** Bun (TypeScript)
- **Database:** SQLite (WAL), schema and details in [docs/CONCEPT.md](docs/CONCEPT.md)

## License

See repository license.
