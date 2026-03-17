# Deploying depends.cc

## Quick start (local)

```bash
bun install
bun run dev        # watches for changes
# or
bun run start      # production mode
# or
depends serve      # via the CLI
```

Server runs on `http://localhost:3000` by default. Set `PORT` env var to change.

## Production deploy

1. Clone the repo to your server
2. Run `bun install`
3. Run `PORT=3000 bun run src/server.ts`
4. Put a reverse proxy (nginx/caddy) in front for HTTPS

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
Environment=PORT=3000
Restart=always
User=depends

[Install]
WantedBy=multi-user.target
```

## Database

- SQLite file at `./data/depends.db`
- WAL mode — safe for multiple readers, single writer
- Backup: `cp data/depends.db data/depends.db.backup` (safe with WAL mode)
- The database is created automatically on first run with the full schema

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
