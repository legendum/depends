# depends.cc — Website and UX spec

The **website** at depends.cc is the main human-facing experience. It does two things: explain the product and get people started, and give existing users a simple way to view their status as YAML in the browser.

## What the website is

1. **Explainer and signup** — A normal website that says what depends.cc is, how it works, and how to sign up. No esoteric entry point; someone landing on depends.cc can read, understand, and sign up.
2. **Status view** — A route where you see your dependency graph as YAML in the browser, with Basic Auth. Same credentials you already have.

## Site content (explainer + signup)

The main pages should cover:

- **What depends.cc is** — A lightweight, API-first dependency state service. You push state in; depends.cc computes the graph and fires webhooks. No polling.
- **How it works** — Nodes (green/yellow/red), dependencies, effective state, namespaces, optional reason + solution, webhooks. Link to full docs (e.g. CONCEPT.md or api.depends.cc) for detail.
- **How to sign up** — How to create a namespace (e.g. via API `POST /namespaces` or a signup flow on the site), get your token, and start pushing state. Clear next steps.

## Status route: `/ns/<namespace>`

For viewing status in the browser:

- **URL** — `depends.cc/ns/<namespace>` (e.g. `https://depends.cc/ns/acme`, `https://depends.cc/ns/fitpass`). The path includes the namespace so the URL is clear and bookmarkable.
- **Auth** — HTTP Basic over HTTPS. Username = namespace, password = token. The website returns 401; the browser prompts for username and password.
- **Response** — The website fetches the graph (and optionally events) from the API for that namespace, then serves it to the browser as **YAML**. For this use-case only — sending YAML to a web browser for a human to read in the tab — the website must use **`Content-Type: text/plain`**. Otherwise the browser treats the response as a file and triggers a download. **API content types stay as they are;** we are not changing how the API responds.

Flow: open `depends.cc/ns/acme` → 401 → enter username `acme`, password (token) → see YAML in the tab.

### Auth details

- **Username** = namespace (must match the `<namespace>` in the path, or the server derives namespace from the path and accepts token as password).
- **Password** = the namespace token (e.g. `dps_abc123...`).
- **Transport** = HTTPS only.

Caveats:

- Browsers cache Basic Auth. “Log out” = close the tab, use a private window, or clear site data.
- Don’t use on a shared machine without logging out when done.

### What the website sends: status YAML

The website fetches the graph from the API for that namespace, then serves a single YAML document to the browser: the current graph with **state**, **effective_state**, **reason**, and **solution** per node. Example shape:

```yaml
namespace: acme
updated: "2026-03-14T12:00:00Z"

nodes:
  database:
    label: PostgreSQL Primary
    state: red
    effective_state: red
    reason: disk full on /var/data
    solution: Check disk usage (df -h), clear logs, expand volume.
    depends_on: []

  auth-service:
    label: Auth Service
    state: green
    effective_state: green
    reason: null
    solution: null
    depends_on: [database]

  api-server:
    label: API Server
    state: green
    effective_state: red
    reason: null
    solution: null
    depends_on: [database, auth-service]
```

Optionally, the website can also serve the last N events as YAML (e.g. at `depends.cc/ns/<namespace>/events` or via a query param) — again with `Content-Type: text/plain` so the browser displays it.

## Implementation: Elysia + HTMX

One server serves both the API and the website. No separate processes.

**Stack**

- **Elysia** — Single app, single port. Routing for API and website, static file serving, middleware (e.g. auth).
- **HTMX** — Real HTML with HTMX attributes for any interactivity on the explainer/signup pages (e.g. copy token, forms). No React, no big JS bundle.
- **Same DB and handlers** — Existing Bun SQLite and route handlers (nodes, state, graph, events, notifications, etc.) are reused. Elysia wires them to routes; API logic does not change.

**Route layout**

| Path | Served by | Notes |
|------|-----------|--------|
| `/v1/*` | API | Existing API: namespaces, nodes, state, graph, events, notifications, usage. Bearer (and optional Basic) auth. Unchanged behaviour. |
| `/` | Website | Static HTML (e.g. index, how-it-works, signup). Real HTML + HTMX. |
| `/ns/:namespace` | Website | Basic Auth (username = namespace, password = token). Fetches graph (and optionally events) for that namespace, returns YAML with `Content-Type: text/plain`. |

**Static site**

- HTML files live in a folder (e.g. `public/` or `website/`). Elysia serves them via its static plugin or a simple file handler.
- Pages are real HTML. Use HTMX for any dynamic behaviour (e.g. “Copy token”, inline form submission). No separate front-end build required unless you add it later.

**Auth**

- **API (`/v1/*`)** — Keep current Bearer token auth. Optionally allow Basic (namespace:token) for parity with the website.
- **Website (`/ns/:namespace`)** — Basic Auth only. Username must match the `:namespace` in the path; password = token. On success, server fetches from internal API or DB and returns YAML.

**DB and context**

- Same `createDb()` and DB instance. Pass it into Elysia (e.g. via context or a plugin) so both API routes and the `/ns/:namespace` handler can use it. The `/ns/:namespace` handler can call the same graph/event logic or hit the internal API; either way, one DB.

**Summary**

- One Elysia app = API + website.
- API at `/v1/*`, website at `/` and `/ns/:namespace`.
- Real HTML + HTMX for the site; YAML with `text/plain` for the status route only.

## Summary

| Aspect | Spec |
|--------|------|
| **Website** | Explainer (what it is, how it works) + signup (how to get started) + status route. |
| **Status URL** | `depends.cc/ns/<namespace>`. Bookmarkable, namespace in path. |
| **Auth** | HTTP Basic over HTTPS. Username = namespace, password = token. |
| **Response** | Website serves YAML with `Content-Type: text/plain` so the browser shows it in the tab. API content types unchanged. |
| **Implementation** | One Elysia app: API at `/v1/*`, static HTML/HTMX at `/`, YAML at `/ns/:namespace`. Same DB and handlers. |
| **Caveats** | Browser caches Basic Auth; “log out” = close tab / private window / clear site data. |
