# Deploying depends.cc

depends.cc runs in one of two modes, auto-detected at startup from the environment:

- **Self-hosted (default)** — no auth, no billing, no signup. Triggered when `LEGENDUM_API_KEY` is *not* set. This is the right mode for running depends.cc on your laptop, in a private network, or on infrastructure you already trust.
- **Hosted** — full bearer-token auth, per-account billing via Legendum, signup flow, SMTP email delivery. Triggered automatically when `LEGENDUM_API_KEY` *is* set.

The mode is detected once at process startup via `isByLegendum()` in `src/server/middleware.ts`. To switch modes, change the env and restart the server.

## Quick start (self-hosted, local)

```bash
bun install
bun run dev        # watches for changes
# or
bun run start      # production mode
# or
depends serve      # via the CLI
```

Server runs on `http://localhost:3000` by default. Set `PORT` to change.

In self-hosted mode any request is accepted; the `Authorization` header is optional and ignored. Namespaces are auto-created on first access.

## Production deploy (hosted)

1. Clone the repo to your server.
2. Run `bun install`.
3. Set the required environment variables (see below) — at minimum, `LEGENDUM_API_KEY` to enable hosted mode, plus `SMTP_*` if you want signup and notification emails to actually deliver.
4. Run `bun run src/server.ts` (or use the systemd unit below).
5. Put a reverse proxy (nginx/caddy) in front for HTTPS. depends.cc trusts `X-Forwarded-For` for rate-limiting, so make sure your proxy sets it.

### Nginx example

```nginx
server {
    listen 80;
    server_name depends.cc www.depends.cc;
    return 301 https://depends.cc$request_uri;
}

server {
    listen 443 ssl;
    server_name depends.cc www.depends.cc;

    ssl_certificate /etc/letsencrypt/live/depends.cc/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/depends.cc/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy example

```
depends.cc {
    reverse_proxy localhost:3000
}
```

### Systemd service

```ini
[Unit]
Description=depends.cc
After=network.target

[Service]
ExecStart=/usr/bin/bun run /opt/depends/src/server.ts
WorkingDirectory=/opt/depends
EnvironmentFile=/etc/depends/env
Restart=always
User=depends

[Install]
WantedBy=multi-user.target
```

Put your environment variables in `/etc/depends/env` (one `KEY=value` per line) rather than inlining them in the unit file, so you can rotate secrets without touching systemd.

## Database

- SQLite file at `data/depends.db` (created automatically on first run).
- WAL mode — safe for multiple readers, single writer.
- Backup: `cp data/depends.db data/depends.db.backup` (safe while the server is running, thanks to WAL).
- Schema is applied on startup via `CREATE TABLE IF NOT EXISTS` in `src/db.ts`. See [UPDATES.md](UPDATES.md) for the migration procedure when columns change.

## Logs

Structured JSON-line logs are written to `log/YYYY-MM-DD.log`. Every line is one JSON object. The same file holds:

- Request access logs (`method`, `path`, `status`, `ms`, `tid`).
- Webhook delivery failures (`kind: "webhook_failed"`, `url`, `namespace`, `node_id`, `status`, `error`).
- Email delivery failures (`kind: "email_failed"` / `"email_skipped"`, `to`, `type`).

Tail today's log:

```bash
tail -f log/$(date -u +%F).log
```

Filter for problems:

```bash
grep webhook_failed log/$(date -u +%F).log
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `LEGENDUM_API_KEY` | — | Presence switches the server into **hosted mode**. Absent = self-hosted (no auth, no billing). |
| `BASE_URL` | `https://depends.cc` | Base URL used when constructing `ack_url` links in notification payloads. Set to your public URL. |
| `SMTP_HOST` | — | SMTP server hostname. If unset, signup and notification emails are skipped (and logged as `email_skipped`). |
| `SMTP_PORT` | `465` | SMTP port (TLS assumed). |
| `SMTP_USER` | — | SMTP username. |
| `SMTP_PASS` | — | SMTP password. |
| `SMTP_FROM` | `notifications@depends.cc` | Envelope/from address for outgoing mail. |

CLI environment variables (used by `depends`, not the server):

| Variable | Description |
|---|---|
| `DEPENDS_TOKEN` | Bearer token for hosted-mode requests. Ignored in self-hosted mode. |
| `DEPENDS_NAMESPACE` | Default namespace (overrides `default_namespace` in `~/.config/depends/config.yml`). |
| `DEPENDS_API_URL` | API base URL, e.g. `http://localhost:3000/v1` for a self-hosted server. |
| `DEPENDS_CONFIG` | Path to a non-default CLI config file. |

The CLI also expands `${VAR}` and `${VAR:-default}` inside `depends.yml` on `push`, `validate`, `diff`, and `check`, sourcing values from `process.env`. An unset variable with no default is a hard error.
