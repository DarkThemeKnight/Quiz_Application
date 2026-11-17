# Backup and restore

Backups contain your private questions, answers and account hash. **Store them outside the repository**
(e.g. `~/recall-backups`) and never commit them. `.gitignore` excludes `*.dump`, `*.backup` and `backups/`.

## Back up

Run from the project folder so `.env` provides `DATABASE_URL`:

```bash
set -a; . ./.env; set +a
mkdir -p ~/recall-backups
pg_dump --format=custom --file ~/recall-backups/recall-$(date +%F).dump "$DATABASE_URL"
```

Using Docker Compose without a local `pg_dump`:

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB" > ~/recall-backups/recall-$(date +%F).dump
```

Take a backup before upgrading (migrations are forward-only).

## Restore

Restore into an **empty** database (or one you are happy to overwrite). Stop the app first.

```bash
set -a; . ./.env; set +a
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" ~/recall-backups/recall-YYYY-MM-DD.dump
pnpm db:migrate        # brings an older backup up to the current schema
pnpm start
```

`--clean --if-exists` drops existing objects first. To restore side-by-side instead, create a new database,
point `DATABASE_URL` at it and restore there.

Plain-SQL alternative: `pg_dump "$DATABASE_URL" > backup.sql` and `psql "$DATABASE_URL" -f backup.sql`.

## JSON exports (portability, not full backups)

Settings → Data offers:

- **Question bank (JSON/CSV)** — re-importable via _Question bank → Import_ (`externalId` prevents duplicates).
- **Progress & history (JSON)** — every session with item snapshots and answers, plus the review schedule. This is
  an archive for your records; it is not re-importable. Use `pg_dump` for complete restores.
