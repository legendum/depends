# Deploying depends.cc

## Quick start (local)

```bash
bun install
bun run dev        # watches for changes
# or
bun run start      # production mode
```

Server runs on `http://localhost:3000` by default. Set `PORT` env var to change.

## Build standalone binary

```bash
# For your current machine
bun build --compile src/server.ts --outfile depends-server

# Cross-compile
bun build --compile --target=bun-linux-x64 src/server.ts --outfile depends-server-linux-x64
bun build --compile --target=bun-linux-arm64 src/server.ts --outfile depends-server-linux-arm64
```

## Production deploy

1. Copy the binary to your server
2. Run it: `PORT=3000 ./depends-server`
3. It creates `depends.db` in the working directory on first run
4. Put a reverse proxy (nginx/caddy) in front for HTTPS

### Caddy example

```
api.depends.cc {
    reverse_proxy localhost:3000
}
```

### Systemd service

```ini
[Unit]
Description=depends.cc
After=network.target

[Service]
ExecStart=/opt/depends/depends-server
WorkingDirectory=/opt/depends
Environment=PORT=3000
Restart=always
User=depends

[Install]
WantedBy=multi-user.target
```

## Database

- SQLite file at `./depends.db`
- WAL mode — safe for multiple readers, single writer
- Backup: `cp depends.db depends.db.backup` (safe with WAL mode)
- The database is created automatically on first run with the full schema

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
