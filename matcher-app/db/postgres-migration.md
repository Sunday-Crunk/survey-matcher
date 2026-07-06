# SQLite to Postgres Migration

The current SQLite matcher database is the source of truth for the first Postgres migration. The migration must copy the existing data as-is; it must not rerun dedupe, regenerate candidates, or replace existing decisions.

## Prepare

Use the isolated dev data by default:

```powershell
npm run migration:prepare
```

For the current live local data, use an explicit source root and output folder:

```powershell
node scripts/migrate-sqlite-to-postgres.mjs --source-root web-data --out migration-output/live-preflight
```

This writes:

- `migration.sql` - transactional data load.
- `verify.sql` - count comparison query. It must return zero rows.
- `apply.sql` - schema, migration, and hard verification gate in one file.
- `source-counts.json` - source table counts used by verification.

## Apply

Apply only to the intended Postgres database:

```powershell
$env:DATABASE_URL = "postgres://..."
node scripts/migrate-sqlite-to-postgres.mjs --source-root web-data --out migration-output/live-apply --apply
```

The apply step requires the `psql` client. It runs the schema, loads the data in a transaction, and raises an error if any migrated table count differs from SQLite.

Do not point the app at Postgres until the apply step has passed or `verify.sql` returns zero rows when run against the target database.

## Local Docker Test

For testing the migration without installing Postgres locally, use the dedicated Docker Compose file. It starts a disposable Postgres database with no host port exposed and runs `psql` inside the container.

```powershell
npm run migration:prepare:web
npm run migration:docker:up
npm run migration:docker:apply
npm run migration:docker:verify
```

`migration:docker:verify` should return no rows. That means every table count matches the SQLite source counts exactly.

When finished:

```powershell
npm run migration:docker:down
```

The down command removes the test database volume. It does not touch app data.
