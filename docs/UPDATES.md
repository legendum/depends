# Upgrading depends.cc

## For CLI users

If you installed via the install script:

```bash
depends update
```

This runs `git pull` + `bun install` in `~/.depends/src`. Since the CLI is symlinked via `bun link`, updates take effect immediately.

Alternatively, re-run the install script:

```bash
curl -fsSL https://depends.cc/install.sh | sh
```

## For self-hosted servers

```bash
cd /opt/depends          # or wherever you cloned the repo
git pull
bun install
# Restart the server (e.g. systemctl restart depends)
```

## Database migrations

depends.cc uses SQLite. The schema is applied on startup via `CREATE TABLE IF NOT EXISTS`, so new tables are added automatically.

However, **column additions or changes to existing tables require manual migration**. When an upgrade includes schema changes, they will be listed below.

### Migration procedure

1. Stop the server
2. Back up your database: `cp data/depends.db data/depends.db.backup`
3. Run the migration SQL against your database: `sqlite3 data/depends.db < migration.sql`
4. Pull the new code: `git pull && bun install`
5. Start the server

### Schema changes by version

#### v0.1.0 (initial release)

No migrations needed — this is the first version.

<!--
Template for future migrations:

#### v0.x.0

**What changed:** description of schema change

**Migration SQL:**
```sql
ALTER TABLE ... ADD COLUMN ...;
```

**Breaking changes:** list any API or CLI breaking changes
-->
